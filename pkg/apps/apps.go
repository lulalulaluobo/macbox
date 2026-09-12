package apps

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/luluen/mac-nas/pkg/docker"
	"github.com/luluen/mac-nas/pkg/vm"
	"gopkg.in/yaml.v3"
)

// App IDs are used as directory and Compose project components. Keep the
// grammar bounded and require an alphanumeric first character so every call
// site can safely construct paths and argv values from it.
var validAppID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)
var validEnvironmentKey = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)

const (
	maxInstallMapEntries = 128
	maxComposeYAMLBytes  = 8 << 20
	maxInstallPathBytes  = 4096
	maxEnvironmentBytes  = 4096
)

// normalizeInstallConfig validates values that are interpolated into a
// Compose document. The install endpoint is administrator-only, but it still
// must not accept malformed paths, ports, or environment keys that can change
// the meaning of the generated YAML or create unexpected host mounts.
func normalizeInstallConfig(input InstallCustomConfig) (InstallCustomConfig, error) {
	output := InstallCustomConfig{}
	if len(input.PortsMap) > maxInstallMapEntries {
		return output, fmt.Errorf("端口映射数量不能超过 %d", maxInstallMapEntries)
	}
	if len(input.VolumesMap) > maxInstallMapEntries {
		return output, fmt.Errorf("存储挂载数量不能超过 %d", maxInstallMapEntries)
	}
	if len(input.EnvMap) > maxInstallMapEntries {
		return output, fmt.Errorf("环境变量数量不能超过 %d", maxInstallMapEntries)
	}
	if len([]byte(input.CustomYaml)) > maxComposeYAMLBytes {
		return output, fmt.Errorf("Docker Compose YAML 内容不能超过 8 MB")
	}

	if len(input.PortsMap) > 0 {
		output.PortsMap = make(map[string]int, len(input.PortsMap))
		for rawContainerPort, hostPort := range input.PortsMap {
			containerPort, err := strconv.Atoi(strings.TrimSpace(rawContainerPort))
			if err != nil || containerPort < 1 || containerPort > 65535 {
				return InstallCustomConfig{}, fmt.Errorf("容器端口无效: %q", rawContainerPort)
			}
			if hostPort < 1 || hostPort > 65535 {
				return InstallCustomConfig{}, fmt.Errorf("宿主机端口无效: %d", hostPort)
			}
			key := strconv.Itoa(containerPort)
			if _, exists := output.PortsMap[key]; exists {
				return InstallCustomConfig{}, fmt.Errorf("容器端口重复: %d", containerPort)
			}
			output.PortsMap[key] = hostPort
		}
	}

	if len(input.VolumesMap) > 0 {
		output.VolumesMap = make(map[string]string, len(input.VolumesMap))
		for rawContainerPath, rawHostPath := range input.VolumesMap {
			containerPath, err := normalizeComposePath(rawContainerPath, false)
			if err != nil {
				return InstallCustomConfig{}, fmt.Errorf("容器挂载路径无效: %w", err)
			}
			hostPath, err := normalizeComposePath(rawHostPath, true)
			if err != nil {
				return InstallCustomConfig{}, fmt.Errorf("宿主机挂载路径无效: %w", err)
			}
			if _, exists := output.VolumesMap[containerPath]; exists {
				return InstallCustomConfig{}, fmt.Errorf("容器挂载路径重复: %s", containerPath)
			}
			output.VolumesMap[containerPath] = hostPath
		}
	}

	if len(input.EnvMap) > 0 {
		output.EnvMap = make(map[string]string, len(input.EnvMap))
		for rawKey, value := range input.EnvMap {
			key := strings.TrimSpace(rawKey)
			if !validEnvironmentKey.MatchString(key) {
				return InstallCustomConfig{}, fmt.Errorf("环境变量名无效: %q", rawKey)
			}
			if len([]byte(value)) > maxEnvironmentBytes || strings.IndexFunc(value, unicode.IsControl) >= 0 {
				return InstallCustomConfig{}, fmt.Errorf("环境变量 %s 内容过长或包含控制字符", key)
			}
			if _, exists := output.EnvMap[key]; exists {
				return InstallCustomConfig{}, fmt.Errorf("环境变量重复: %s", key)
			}
			output.EnvMap[key] = value
		}
	}

	output.CustomYaml = input.CustomYaml
	return output, nil
}

func normalizeComposePath(raw string, hostPath bool) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" || len([]byte(value)) > maxInstallPathBytes || strings.IndexFunc(value, unicode.IsControl) >= 0 {
		return "", fmt.Errorf("路径格式无效")
	}
	if !path.IsAbs(value) {
		return "", fmt.Errorf("路径必须为绝对路径")
	}
	if strings.ContainsAny(value, "\\\"'$") {
		return "", fmt.Errorf("路径包含不支持的特殊字符")
	}
	clean := path.Clean(value)
	if clean == "/" {
		return "", fmt.Errorf("不允许使用根路径")
	}
	if hostPath {
		// Application data belongs under the VM data root. The Docker socket is
		// the one intentional host-level exception used by management apps.
		if clean != "/var/run/docker.sock" && clean != "/data" && !strings.HasPrefix(clean, "/data/") {
			return "", fmt.Errorf("宿主机路径必须位于 /data 下")
		}
	}
	return clean, nil
}

func generateAppSecret() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate app secret: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// Keep this small package-local wrapper for existing tests and callers while
// sharing the parser with the Docker Compose deployment path.
func publishedHostPorts(content string) ([]int, error) {
	return docker.PublishedHostPorts(content)
}

func composeEnvironmentItem(key, value string) string {
	// Guided-form values are literals. Escape Compose's interpolation marker so
	// a value such as "$TOKEN" is not resolved from the VM environment.
	value = strings.ReplaceAll(value, "$", "$$")
	encoded, err := yaml.Marshal(key + "=" + value)
	if err != nil {
		return key + "=" + value
	}
	return strings.TrimSpace(string(encoded))
}

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

	var containers []docker.ContainerInfo
	if m.dockerClient != nil {
		var dockerErr error
		containers, dockerErr = m.dockerClient.ListContainersSummary(ctx)
		if dockerErr != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			// The catalog remains useful while the VM/Docker daemon is stopped;
			// retain it, but make the degraded state observable in server logs.
			log.Printf("[MacNAS Apps] Docker 状态暂不可用，应用状态将按未安装显示: %v", dockerErr)
		}
	}
	containerMap := make(map[string]docker.ContainerInfo)
	for _, c := range containers {
		containerMap[c.Names] = c
	}

	appMap := make(map[string]AppMetadata)

	// 1. Built-in Catalog
	catalog := GetBuiltinCatalog()
	for _, item := range catalog {
		meta := item.Metadata
		// Compose YAML is returned only by the administrator-protected config
		// endpoint. The catalog list is also visible to ordinary web users and
		// must not disclose credentials, host mounts, or other deployment data.
		meta.ComposeTemplate = ""
		appMap[meta.ID] = meta
	}

	// 2. Community Store Cache
	communityApps := m.communityMgr.GetApps()
	for _, item := range communityApps {
		meta := item.Metadata
		meta.ComposeTemplate = ""
		if _, exists := appMap[meta.ID]; !exists {
			meta.Source = "community"
			appMap[meta.ID] = meta
		}
	}

	// 3. Custom User Apps
	customApps, err := m.customMgr.List()
	if err != nil {
		return nil, fmt.Errorf("读取自定义应用配置失败: %w", err)
	}
	for _, item := range customApps {
		meta := item.Metadata
		meta.ComposeTemplate = ""
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

		// Check if container exists in Docker
		containerName := "macnas-" + id
		var matchedContainer *docker.ContainerInfo
		if c, exists := containerMap[containerName]; exists {
			cCopy := c
			matchedContainer = &cCopy
		} else if c, exists := containerMap[id]; exists {
			cCopy := c
			matchedContainer = &cCopy
		} else {
			for _, c := range containers {
				if c.Project == id || c.Project == "macnas-"+id || c.Names == containerName || strings.HasPrefix(c.Names, containerName+"-") {
					cCopy := c
					matchedContainer = &cCopy
					break
				}
			}
		}

		if matchedContainer != nil {
			appMeta.Installed = true
			if matchedContainer.State == "running" {
				appMeta.Status = "running"
			} else {
				appMeta.Status = "stopped"
			}
			// Update WebURL if actual port was found
			if len(matchedContainer.PortsMap) > 0 {
				appMeta.Port = matchedContainer.PortsMap[0].HostPort
				appMeta.WebURL = fmt.Sprintf("http://%s:%d", hostIP, appMeta.Port)
			}
		} else {
			// No container exists in Docker for this app -> Not installed!
			appMeta.Installed = false
			appMeta.Status = "not_installed"
		}

		results = append(results, appMeta)
	}
	sort.Slice(results, func(i, j int) bool {
		if results[i].Name == results[j].Name {
			return results[i].ID < results[j].ID
		}
		return results[i].Name < results[j].Name
	})

	return results, nil
}

func (m *Manager) GetAppConfig(ctx context.Context, id string) (*AppMetadata, error) {
	id = strings.TrimSpace(id)
	if !validAppID.MatchString(id) {
		return nil, fmt.Errorf("应用标识格式无效")
	}

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
	id = strings.TrimSpace(id)
	if !validAppID.MatchString(id) {
		return fmt.Errorf("应用标识格式无效")
	}
	var err error
	cfg, err = normalizeInstallConfig(cfg)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "🚀 [MacNAS AppStore] 开始准备部署应用: %s\n", id)

	meta, err := m.GetAppConfig(ctx, id)
	if err != nil {
		fmt.Fprintf(out, "❌ 加载应用配置失败: %v\n", err)
		return err
	}

	var finalYAML string
	var aria2Secret string
	var baiduVNCPassword string
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
			oldPortPatt := regexp.MustCompile(fmt.Sprintf(`["']?\d+:%d(?:/\w+)?["']?`, cPort))
			newPortStr := fmt.Sprintf(`"%d:%d"`, hPort, cPort)
			finalYAML = oldPortPatt.ReplaceAllStringFunc(finalYAML, func(string) string { return newPortStr })
			fmt.Fprintf(out, "⚙️ 定制端口映射: %d -> %d\n", hPort, cPort)
		}

		// 2. Apply volume customizations
		for cPath, hPath := range cfg.VolumesMap {
			if cPath != "" && hPath != "" {
				// Replace host directory mapping to cPath
				volPatt := regexp.MustCompile(fmt.Sprintf(`["']?[^:"'\s]+:%s(?:[:][a-z,]+)?["']?`, regexp.QuoteMeta(cPath)))
				newVolStr := fmt.Sprintf(`"%s:%s"`, hPath, cPath)
				finalYAML = volPatt.ReplaceAllStringFunc(finalYAML, func(string) string { return newVolStr })
				fmt.Fprintf(out, "📁 定制数据目录挂载: %s -> %s\n", hPath, cPath)
			}
		}

		// 3. Apply environment customizations
		for k, v := range cfg.EnvMap {
			envPatt := regexp.MustCompile(fmt.Sprintf(`(?m)^\s*-\s*%s=.*$`, regexp.QuoteMeta(k)))
			newEnvLine := "      - " + composeEnvironmentItem(k, v)
			if envPatt.MatchString(finalYAML) {
				finalYAML = envPatt.ReplaceAllStringFunc(finalYAML, func(string) string { return newEnvLine })
				fmt.Fprintf(out, "🔧 定制环境变量: %s 已更新\n", k)
			}
		}

		// The catalog used a public RPC secret. Generate a per-installation
		// secret and show it only in this installation stream so AriaNg can be
		// configured without shipping a reusable credential.
		if id == "aria2-pro" && strings.Contains(finalYAML, "RPC_SECRET=") {
			aria2Secret, err = generateAppSecret()
			if err != nil {
				return err
			}
			finalYAML = regexp.MustCompile(`(?m)^\s*-\s*RPC_SECRET=.*$`).ReplaceAllStringFunc(finalYAML, func(string) string {
				return "      - RPC_SECRET=" + aria2Secret
			})
		}
	}
	// The Baidu Netdisk image has a known fallback VNC password. Replace the
	// catalog marker with a fresh short secret for every guided installation,
	// including an untouched copy submitted from advanced YAML mode.
	if id == "baidunetdisk" && strings.Contains(finalYAML, "VNC_SERVER_PASSWD=macnas-change-me") {
		secret, secretErr := generateAppSecret()
		if secretErr != nil {
			return secretErr
		}
		baiduVNCPassword = secret[:8]
		finalYAML = strings.ReplaceAll(finalYAML, "VNC_SERVER_PASSWD=macnas-change-me", "VNC_SERVER_PASSWD="+baiduVNCPassword)
	}
	if len([]byte(finalYAML)) > maxComposeYAMLBytes {
		return fmt.Errorf("最终 Docker Compose YAML 内容不能超过 8 MB")
	}
	forwardedPorts, err := publishedHostPorts(finalYAML)
	if err != nil {
		return fmt.Errorf("解析 Compose 配置失败: %w", err)
	}

	// 1. Create all needed directories inside VM
	appDataDir := path.Join("/data/appdata", id)
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
	for _, dir := range dirsToCreate {
		if _, err := m.vmMgr.Exec(ctx, "mkdir", "-p", dir); err != nil {
			fmt.Fprintf(out, "⚠️ 创建宿主机目录提示 (%s): %v\n", dir, err)
		}
	}

	// 2. Stream compose.yaml through stdin so YAML cannot be interpreted as shell code.
	fmt.Fprintf(out, "📝 [2/3] 写入项目配置文件: %s/compose.yaml ...\n", appDataDir)
	composePath := path.Join(appDataDir, "compose.yaml")
	if _, err := m.vmMgr.ExecWithInput(ctx, strings.NewReader(finalYAML), "sudo", "tee", composePath); err != nil {
		fmt.Fprintf(out, "❌ 写入 compose.yaml 失败: %v\n", err)
		return fmt.Errorf("write compose.yaml failed: %w", err)
	}

	// 3. Pull image with stream
	fmt.Fprintf(out, "📦 正在拉取 Docker 镜像 (实时进度流):\n")
	if err := m.vmMgr.ExecStream(ctx, out, "docker", "compose", "-f", composePath, "pull"); err != nil {
		fmt.Fprintf(out, "\n⚠️ pull 提示已跳过，正在尝试直接启动容器...\n")
	}

	// 4. Start container
	fmt.Fprintf(out, "\n⚡ [3/3] 启动 Docker 容器...\n")
	if err := m.vmMgr.ExecStream(ctx, out, "docker", "compose", "-f", composePath, "up", "-d", "--remove-orphans"); err != nil {
		fmt.Fprintf(out, "❌ 启动容器失败: %v\n", err)
		return fmt.Errorf("docker compose up failed: %w", err)
	}
	portsChanged := false
	if len(forwardedPorts) > 0 {
		var err error
		portsChanged, err = m.vmMgr.AddForwardedPortsChanged(forwardedPorts...)
		if err != nil {
			fmt.Fprintf(out, "❌ 应用已启动，但记录局域网端口失败: %v\n", err)
			return fmt.Errorf("记录应用端口转发失败: %w", err)
		}
		if portsChanged {
			fmt.Fprintf(out, "🔌 检测到并登记局域网端口: %v\n", forwardedPorts)
		}
		// A previous deployment may have persisted a forwarding entry without
		// restarting the running VM. Treat that pending configuration as a
		// reason to apply it now as well.
		portsChanged = portsChanged || m.vmMgr.IsConfigDirty()
	}

	// Special post-install setups
	if id == "alist" {
		alistPassword, secretErr := generateAppSecret()
		if secretErr != nil {
			return secretErr
		}
		fmt.Fprintf(out, "🔑 Alist 管理员账号：admin；初始密码（仅显示一次）：%s\n", alistPassword)
		timer := time.NewTimer(2 * time.Second)
		select {
		case <-timer.C:
		case <-ctx.Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			return ctx.Err()
		}
		if _, err := m.vmMgr.Exec(ctx, "docker", "exec", "macnas-alist", "./alist", "admin", "set", alistPassword); err != nil {
			return fmt.Errorf("初始化 Alist 管理员密码失败: %w", err)
		}
	}
	if aria2Secret != "" {
		fmt.Fprintf(out, "🔑 Aria2 RPC 密钥（仅显示一次）：%s\n", aria2Secret)
	}
	if baiduVNCPassword != "" {
		fmt.Fprintf(out, "🔑 百度网盘 VNC 密码（仅显示一次）：%s\n", baiduVNCPassword)
	}
	if portsChanged {
		fmt.Fprintln(out, "🔄 正在重启虚拟机以启用局域网访问...")
		if err := m.vmMgr.RestartForPortForwarding(ctx, m.projectRoot); err != nil {
			fmt.Fprintf(out, "❌ 应用已启动，但局域网端口尚未生效: %v\n", err)
			return fmt.Errorf("启用应用局域网端口失败: %w", err)
		}
		fmt.Fprintln(out, "✅ 新端口已绑定到局域网地址")
	}

	fmt.Fprintf(out, "\n🎉 应用 [%s] 部署完成并已成功上线运行！\n", id)
	return nil
}

func (m *Manager) Install(ctx context.Context, id string) error {
	return m.InstallStreamCustom(ctx, id, InstallCustomConfig{}, io.Discard)
}

func (m *Manager) Start(ctx context.Context, id string) error {
	if !validAppID.MatchString(strings.TrimSpace(id)) {
		return fmt.Errorf("应用标识格式无效")
	}
	composePath := path.Join("/data/appdata", strings.TrimSpace(id), "compose.yaml")
	out, err := m.vmMgr.Exec(ctx, "docker", "compose", "-f", composePath, "start")
	if err != nil {
		return fmt.Errorf("docker compose start failed: %s (%w)", out, err)
	}
	return nil
}

func (m *Manager) Stop(ctx context.Context, id string) error {
	if !validAppID.MatchString(strings.TrimSpace(id)) {
		return fmt.Errorf("应用标识格式无效")
	}
	composePath := path.Join("/data/appdata", strings.TrimSpace(id), "compose.yaml")
	out, err := m.vmMgr.Exec(ctx, "docker", "compose", "-f", composePath, "stop")
	if err != nil {
		return fmt.Errorf("docker compose stop failed: %s (%w)", out, err)
	}
	return nil
}

func (m *Manager) Restart(ctx context.Context, id string) error {
	if !validAppID.MatchString(strings.TrimSpace(id)) {
		return fmt.Errorf("应用标识格式无效")
	}
	composePath := path.Join("/data/appdata", strings.TrimSpace(id), "compose.yaml")
	out, err := m.vmMgr.Exec(ctx, "docker", "compose", "-f", composePath, "restart")
	if err != nil {
		return fmt.Errorf("docker compose restart failed: %s (%w)", out, err)
	}
	return nil
}

func (m *Manager) Uninstall(ctx context.Context, id string) error {
	if !validAppID.MatchString(strings.TrimSpace(id)) {
		return fmt.Errorf("应用标识格式无效")
	}
	appDataDir := path.Join("/data/appdata", strings.TrimSpace(id))
	composePath := path.Join(appDataDir, "compose.yaml")
	// Keep named volumes by default. Removing an application must not silently
	// delete its persistent data; an explicit data cleanup flow can be added
	// separately when the UI has a second confirmation step.
	out, err := m.vmMgr.Exec(ctx, "docker", "compose", "-f", composePath, "down")
	if err != nil {
		return fmt.Errorf("docker compose down failed: %s (%w)", out, err)
	}
	if _, err := m.vmMgr.Exec(ctx, "rm", "-f", composePath); err != nil {
		return fmt.Errorf("remove compose.yaml failed: %w", err)
	}
	return nil
}

func (m *Manager) GetLogs(ctx context.Context, id string, tail int) (string, error) {
	tail = docker.NormalizeLogTail(tail)
	if !validAppID.MatchString(strings.TrimSpace(id)) {
		return "", fmt.Errorf("应用标识格式无效")
	}
	composePath := path.Join("/data/appdata", strings.TrimSpace(id), "compose.yaml")
	return m.vmMgr.Exec(ctx, "docker", "compose", "-f", composePath, "logs", fmt.Sprintf("--tail=%d", tail))
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
