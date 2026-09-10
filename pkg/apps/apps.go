package apps

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/luluen/mac-nas/pkg/docker"
	"github.com/luluen/mac-nas/pkg/vm"
)

type Manager struct {
	vmMgr        *vm.Manager
	dockerClient *docker.Client
	projectRoot  string
	customMgr    *CustomAppManager
	communityMgr *CommunityStoreManager
}

func NewManager(vmMgr *vm.Manager, dockerClient *docker.Client, projectRoot string, dataDir ...string) *Manager {
	dir := ""
	if len(dataDir) > 0 {
		dir = dataDir[0]
	}
	if dir == "" {
		home, _ := os.UserHomeDir()
		dir = filepath.Join(home, "Library", "Application Support", "MacNAS")
	}

	return &Manager{
		vmMgr:        vmMgr,
		dockerClient: dockerClient,
		projectRoot:  projectRoot,
		customMgr:    NewCustomAppManager(dir),
		communityMgr: NewCommunityStoreManager(dir),
	}
}

func (m *Manager) ListApps(ctx context.Context, hostIP string) ([]AppMetadata, error) {
	if hostIP == "" {
		hostIP = "localhost"
	}

	containers, _ := m.dockerClient.ListContainers(ctx)
	containerMap := make(map[string]docker.ContainerInfo)
	for _, c := range containers {
		containerMap[c.Names] = c
	}

	appMap := make(map[string]AppMetadata)

	// 1. Built-in Catalog
	catalog := GetBuiltinCatalog()
	for _, item := range catalog {
		meta := item.Metadata
		meta.ComposeTemplate = item.YAML
		appMap[meta.ID] = meta
	}

	// 2. Community Store Cache
	communityApps := m.communityMgr.GetApps()
	for _, item := range communityApps {
		meta := item.Metadata
		meta.ComposeTemplate = item.YAML
		if _, exists := appMap[meta.ID]; !exists {
			meta.Source = "community"
			appMap[meta.ID] = meta
		}
	}

	// 3. Custom User Apps
	customApps, _ := m.customMgr.List()
	for _, item := range customApps {
		meta := item.Metadata
		meta.ComposeTemplate = item.YAML
		meta.Source = "custom"
		appMap[meta.ID] = meta
	}

	var results []AppMetadata
	for id, appMeta := range appMap {
		// Fill WebURL
		if appMeta.Port > 0 && appMeta.WebURL == "" {
			appMeta.WebURL = fmt.Sprintf("http://%s:%d", hostIP, appMeta.Port)
		} else {
			appMeta.WebURL = strings.ReplaceAll(appMeta.WebURL, "{{.HostIP}}", hostIP)
		}

		// Check if container exists
		containerName := "macnas-" + id
		if c, exists := containerMap[containerName]; exists {
			appMeta.Installed = true
			if c.State == "running" {
				appMeta.Status = "running"
			} else {
				appMeta.Status = "stopped"
			}
			// Update WebURL if actual port was found
			if len(c.PortsMap) > 0 {
				appMeta.Port = c.PortsMap[0].HostPort
				appMeta.WebURL = fmt.Sprintf("http://%s:%d", hostIP, appMeta.Port)
			}
		} else {
			// Check if compose file exists inside VM
			checkCmd := fmt.Sprintf("[ -f /data/appdata/%s/compose.yaml ] && echo 'exists'", id)
			out, _ := m.vmMgr.Exec(ctx, "bash", "-c", checkCmd)
			if strings.Contains(out, "exists") {
				appMeta.Installed = true
				appMeta.Status = "stopped"
			} else {
				appMeta.Installed = false
				appMeta.Status = "not_installed"
			}
		}

		results = append(results, appMeta)
	}

	return results, nil
}

func (m *Manager) GetAppConfig(ctx context.Context, id string) (*AppMetadata, error) {
	// 1. Check custom apps
	if rec, err := m.customMgr.Get(id); err == nil {
		meta := rec.Metadata
		meta.ComposeTemplate = rec.YAML
		return &meta, nil
	}

	// 2. Check built-in catalog
	for _, item := range GetBuiltinCatalog() {
		if item.Metadata.ID == id {
			meta := item.Metadata
			meta.ComposeTemplate = item.YAML
			return &meta, nil
		}
	}

	// 3. Check community store
	for _, item := range m.communityMgr.GetApps() {
		if item.Metadata.ID == id {
			meta := item.Metadata
			meta.ComposeTemplate = item.YAML
			return &meta, nil
		}
	}

	// 4. Fallback to local templates folder
	metaPath := filepath.Join(m.projectRoot, "templates", "apps", id, "app.json")
	if data, err := os.ReadFile(metaPath); err == nil {
		var meta AppMetadata
		if err := json.Unmarshal(data, &meta); err == nil {
			yamlPath := filepath.Join(m.projectRoot, "templates", "apps", id, "compose.yaml")
			if yData, err := os.ReadFile(yamlPath); err == nil {
				meta.ComposeTemplate = string(yData)
			}
			return &meta, nil
		}
	}

	return nil, fmt.Errorf("未找到应用 %s 的模板定义", id)
}

func (m *Manager) InstallStreamCustom(ctx context.Context, id string, cfg InstallCustomConfig, out io.Writer) error {
	fmt.Fprintf(out, "🚀 [MacNAS AppStore] 开始准备部署应用: %s\n", id)

	meta, err := m.GetAppConfig(ctx, id)
	if err != nil {
		fmt.Fprintf(out, "❌ 加载应用配置失败: %v\n", err)
		return err
	}

	var finalYAML string
	if strings.TrimSpace(cfg.CustomYaml) != "" {
		finalYAML = cfg.CustomYaml
		fmt.Fprintln(out, "📝 使用用户自定义的高级 Compose YAML 配置")
	} else {
		finalYAML = meta.ComposeTemplate
		if finalYAML == "" {
			fmt.Fprintf(out, "❌ 无法获取应用的 Compose YAML 模板\n")
			return fmt.Errorf("empty compose template")
		}

		// 1. Apply port customizations
		for cPortStr, hPort := range cfg.PortsMap {
			cPort, _ := strconv.Atoi(cPortStr)
			if cPort > 0 && hPort > 0 {
				oldPortPatt := regexp.MustCompile(fmt.Sprintf(`["']?\d+:%d(?:/\w+)?["']?`, cPort))
				newPortStr := fmt.Sprintf(`"%d:%d"`, hPort, cPort)
				finalYAML = oldPortPatt.ReplaceAllString(finalYAML, newPortStr)
				fmt.Fprintf(out, "⚙️ 定制端口映射: %d -> %d\n", hPort, cPort)
			}
		}

		// 2. Apply volume customizations
		for cPath, hPath := range cfg.VolumesMap {
			if cPath != "" && hPath != "" {
				// Replace host directory mapping to cPath
				volPatt := regexp.MustCompile(fmt.Sprintf(`["']?[^:"'\s]+:%s(?:[:][a-z,]+)?["']?`, regexp.QuoteMeta(cPath)))
				newVolStr := fmt.Sprintf(`"%s:%s"`, hPath, cPath)
				finalYAML = volPatt.ReplaceAllString(finalYAML, newVolStr)
				fmt.Fprintf(out, "📁 定制数据目录挂载: %s -> %s\n", hPath, cPath)
			}
		}

		// 3. Apply environment customizations
		for k, v := range cfg.EnvMap {
			envPatt := regexp.MustCompile(fmt.Sprintf(`(?m)^\s*-\s*%s=.*$`, regexp.QuoteMeta(k)))
			newEnvLine := fmt.Sprintf("      - %s=%s", k, v)
			if envPatt.MatchString(finalYAML) {
				finalYAML = envPatt.ReplaceAllString(finalYAML, newEnvLine)
				fmt.Fprintf(out, "🔧 定制环境变量: %s=%s\n", k, v)
			}
		}
	}

	// 1. Create all needed directories inside VM
	appDataDir := fmt.Sprintf("/data/appdata/%s", id)
	dirsToCreate := []string{appDataDir, "/data/media", "/data/files", "/data/downloads"}

	for _, hPath := range cfg.VolumesMap {
		if strings.HasPrefix(hPath, "/") {
			// If it's a file with extension like .db or .json, get dirname
			if strings.Contains(filepath.Base(hPath), ".") {
				dirsToCreate = append(dirsToCreate, filepath.Dir(hPath))
			} else {
				dirsToCreate = append(dirsToCreate, hPath)
			}
		}
	}

	fmt.Fprintf(out, "📁 [1/3] 正在检查并创建宿主机持久化目录...\n")
	mkdirCmd := fmt.Sprintf("mkdir -p %s", strings.Join(dirsToCreate, " "))
	if _, err := m.vmMgr.Exec(ctx, "bash", "-c", mkdirCmd); err != nil {
		fmt.Fprintf(out, "⚠️ 创建宿主机目录提示: %v\n", err)
	}

	// 2. Safely write compose.yaml via base64
	fmt.Fprintf(out, "📝 [2/3] 写入项目配置文件: %s/compose.yaml ...\n", appDataDir)
	encoded := base64.StdEncoding.EncodeToString([]byte(finalYAML))
	writeCmd := fmt.Sprintf("echo '%s' | base64 -d > %s/compose.yaml", encoded, appDataDir)
	if _, err := m.vmMgr.Exec(ctx, "bash", "-c", writeCmd); err != nil {
		fmt.Fprintf(out, "❌ 写入 compose.yaml 失败: %v\n", err)
		return fmt.Errorf("write compose.yaml failed: %w", err)
	}

	// 3. Pull image with stream
	fmt.Fprintf(out, "📦 正在拉取 Docker 镜像 (实时进度流):\n")
	pullCmd := fmt.Sprintf("cd %s && docker compose pull", appDataDir)
	if err := m.vmMgr.ExecStream(ctx, out, "bash", "-c", pullCmd); err != nil {
		fmt.Fprintf(out, "\n⚠️ pull 提示已跳过，正在尝试直接启动容器...\n")
	}

	// 4. Start container
	fmt.Fprintf(out, "\n⚡ [3/3] 启动 Docker 容器...\n")
	upCmd := fmt.Sprintf("cd %s && docker compose up -d --remove-orphans", appDataDir)
	if err := m.vmMgr.ExecStream(ctx, out, "bash", "-c", upCmd); err != nil {
		fmt.Fprintf(out, "❌ 启动容器失败: %v\n", err)
		return fmt.Errorf("docker compose up failed: %w", err)
	}

	// Special post-install setups
	if id == "alist" {
		fmt.Fprintf(out, "🔑 初始化 Alist 管理员密码为 adminadmin123 ...\n")
		time.Sleep(2 * time.Second)
		_, _ = m.vmMgr.Exec(ctx, "bash", "-c", "docker exec macnas-alist ./alist admin set adminadmin123")
	}

	fmt.Fprintf(out, "\n🎉 应用 [%s] 部署完成并已成功上线运行！\n", id)
	return nil
}

// Backward-compatible InstallStream
func (m *Manager) InstallStream(ctx context.Context, id string, portOverride int, out io.Writer) error {
	cfg := InstallCustomConfig{}
	if portOverride > 0 {
		meta, err := m.GetAppConfig(ctx, id)
		if err == nil && meta.Port > 0 {
			cfg.PortsMap = map[string]int{
				strconv.Itoa(meta.Port): portOverride,
			}
		}
	}
	return m.InstallStreamCustom(ctx, id, cfg, out)
}

func (m *Manager) Install(ctx context.Context, id string) error {
	return m.InstallStreamCustom(ctx, id, InstallCustomConfig{}, io.Discard)
}

func (m *Manager) Start(ctx context.Context, id string) error {
	appDataDir := fmt.Sprintf("/data/appdata/%s", id)
	upCmd := fmt.Sprintf("cd %s && docker compose start", appDataDir)
	out, err := m.vmMgr.Exec(ctx, "bash", "-c", upCmd)
	if err != nil {
		return fmt.Errorf("docker compose start failed: %s (%w)", out, err)
	}
	return nil
}

func (m *Manager) Stop(ctx context.Context, id string) error {
	appDataDir := fmt.Sprintf("/data/appdata/%s", id)
	upCmd := fmt.Sprintf("cd %s && docker compose stop", appDataDir)
	out, err := m.vmMgr.Exec(ctx, "bash", "-c", upCmd)
	if err != nil {
		return fmt.Errorf("docker compose stop failed: %s (%w)", out, err)
	}
	return nil
}

func (m *Manager) Restart(ctx context.Context, id string) error {
	appDataDir := fmt.Sprintf("/data/appdata/%s", id)
	upCmd := fmt.Sprintf("cd %s && docker compose restart", appDataDir)
	out, err := m.vmMgr.Exec(ctx, "bash", "-c", upCmd)
	if err != nil {
		return fmt.Errorf("docker compose restart failed: %s (%w)", out, err)
	}
	return nil
}

func (m *Manager) Uninstall(ctx context.Context, id string) error {
	appDataDir := fmt.Sprintf("/data/appdata/%s", id)
	downCmd := fmt.Sprintf("cd %s && docker compose down -v", appDataDir)
	out, err := m.vmMgr.Exec(ctx, "bash", "-c", downCmd)
	if err != nil {
		return fmt.Errorf("docker compose down failed: %s (%w)", out, err)
	}
	return nil
}

func (m *Manager) GetLogs(ctx context.Context, id string, tail int) (string, error) {
	if tail <= 0 {
		tail = 100
	}
	appDataDir := fmt.Sprintf("/data/appdata/%s", id)
	logsCmd := fmt.Sprintf("cd %s && docker compose logs --tail=%d", appDataDir, tail)
	return m.vmMgr.Exec(ctx, "bash", "-c", logsCmd)
}

func (m *Manager) AddCustomApp(input CustomAppInput) (*AppMetadata, error) {
	return m.customMgr.Save(input)
}

func (m *Manager) DeleteCustomApp(id string) error {
	return m.customMgr.Delete(id)
}

func (m *Manager) SyncCommunityStore(ctx context.Context) (int, error) {
	return m.communityMgr.Sync(ctx)
}
