package docker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

var validProjectName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

const (
	maxComposeYAMLBytes = 8 << 20
	userComposeRoot     = "/data/appdata/compose"
)

// ErrSystemComposeProject marks the built-in Compose projects whose files are
// owned by MacBox and therefore cannot be removed through the user project
// deletion API.
var ErrSystemComposeProject = errors.New("内置 Compose 项目不可删除编排配置")

type composePortService struct {
	Ports []interface{} `yaml:"ports"`
}

type composePortDocument struct {
	Services map[string]composePortService `yaml:"services"`
}

type composeLsItem struct {
	Name        string `json:"Name"`
	Status      string `json:"Status"`
	ConfigFiles string `json:"ConfigFiles"`
}

// publishedPortValue extracts the host-side port from either Compose's short
// or long port syntax. A bare container port is intentionally ignored because
// it does not publish anything on the host.
func publishedPortValue(value interface{}) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, v >= 1 && v <= 65535
	case int64:
		return int(v), v >= 1 && v <= 65535
	case uint64:
		return int(v), v >= 1 && v <= 65535
	case string:
		spec := strings.Trim(strings.TrimSpace(v), "\"'")
		if slash := strings.LastIndex(spec, "/"); slash >= 0 {
			spec = spec[:slash]
		}
		parts := strings.Split(spec, ":")
		if len(parts) < 2 {
			return 0, false
		}
		// Compose accepts [host_ip:]published:target. The published
		// port is therefore the field immediately before the target.
		value, err := strconv.Atoi(strings.TrimSpace(parts[len(parts)-2]))
		return value, err == nil && value >= 1 && value <= 65535
	case map[string]interface{}:
		for _, key := range []string{"published", "host_port"} {
			if port, ok := v[key]; ok {
				return publishedPortValue(port)
			}
		}
	case map[interface{}]interface{}:
		for _, key := range []string{"published", "host_port"} {
			if port, ok := v[key]; ok {
				return publishedPortValue(port)
			}
		}
	}
	return 0, false
}

// PublishedHostPorts returns the unique host ports published by a Compose
// document. MacBox forwards these ports through Lima so services are
// reachable from other devices on the configured LAN interface.
func PublishedHostPorts(content string) ([]int, error) {
	var document composePortDocument
	if err := yaml.Unmarshal([]byte(content), &document); err != nil {
		return nil, err
	}

	seen := make(map[int]struct{})
	ports := make([]int, 0)
	for _, service := range document.Services {
		for _, rawPort := range service.Ports {
			if port, ok := publishedPortValue(rawPort); ok {
				if _, exists := seen[port]; !exists {
					seen[port] = struct{}{}
					ports = append(ports, port)
				}
			}
		}
	}
	sort.Ints(ports)
	return ports, nil
}

func (c *Client) ListComposeProjects(ctx context.Context) ([]ComposeProject, error) {
	containers, err := c.ListContainersSummary(ctx)
	if err != nil {
		return nil, fmt.Errorf("读取 Compose 容器列表失败: %w", err)
	}
	return c.listComposeProjects(ctx, containers)
}

// ListComposeProjectsWithContainers builds the project list from a container
// snapshot that the caller already fetched. This avoids querying Docker for
// the same container data twice in overview requests.
func (c *Client) ListComposeProjectsWithContainers(ctx context.Context, containers []ContainerInfo) ([]ComposeProject, error) {
	return c.listComposeProjects(ctx, containers)
}

func (c *Client) listComposeProjects(ctx context.Context, containers []ContainerInfo) ([]ComposeProject, error) {
	// 1. Run docker compose ls -a
	out, err := c.runDockerCmd(ctx, "compose", "ls", "-a", "--format", "json")
	var lsItems []composeLsItem
	if err == nil && len(out) > 0 {
		if err := json.Unmarshal(out, &lsItems); err != nil {
			return nil, fmt.Errorf("解析 Compose 项目列表失败: %w", err)
		}
	} else if err != nil {
		return nil, fmt.Errorf("读取 Compose 项目列表失败: %w", err)
	}

	projectMap := make(map[string]*ComposeProject)
	for _, it := range lsItems {
		name := strings.TrimSpace(it.Name)
		if name == "" {
			continue
		}
		status := strings.ToLower(it.Status)
		state := "running"
		if strings.Contains(status, "exited") || strings.Contains(status, "stopped") {
			state = "stopped"
		} else if strings.Contains(status, "partially") {
			state = "partially_running"
		}

		workingDir := ""
		if it.ConfigFiles != "" {
			firstFile := strings.Split(it.ConfigFiles, ",")[0]
			workingDir = filepath.Dir(firstFile)
		}

		isSystem := !strings.Contains(workingDir, "/data/appdata/compose/")

		projectMap[name] = &ComposeProject{
			Name:          name,
			Status:        state,
			ConfigFiles:   it.ConfigFiles,
			WorkingDir:    workingDir,
			Containers:    []string{},
			IsSystemApp:   isSystem,
			ServicesCount: 0,
		}
	}

	// 2. Discover offline projects in /data/appdata/compose/
	// A fresh MacBox data volume has no user Compose projects yet. Keep the
	// discovery command successful for that empty state instead of marking a
	// healthy Docker daemon as degraded because find cannot open a missing
	// optional directory.
	findScript := "if [ -d " + userComposeRoot + " ]; then find " + userComposeRoot + " -maxdepth 2 -type f \\( -name compose.yaml -o -name docker-compose.yml \\); fi"
	findOut, err := c.vmMgr.Exec(ctx, "sh", "-c", findScript)
	if err != nil {
		return nil, fmt.Errorf("扫描 Compose 配置目录失败: %w", err)
	}
	for _, line := range discoveredComposeConfigPaths(findOut) {
		dir := filepath.Dir(line)
		name := filepath.Base(dir)
		if _, exists := projectMap[name]; !exists {
			projectMap[name] = &ComposeProject{
				Name:          name,
				Status:        "stopped",
				ConfigFiles:   line,
				WorkingDir:    dir,
				Containers:    []string{},
				IsSystemApp:   false,
				ServicesCount: 0,
			}
		}
	}

	// 3. Associate containers and count services
	for _, container := range containers {
		if container.Project != "" {
			if proj, ok := projectMap[container.Project]; ok {
				proj.Containers = append(proj.Containers, container.Names)
			}
		}
	}

	var results []ComposeProject
	for _, proj := range projectMap {
		proj.ServicesCount = len(proj.Containers)
		results = append(results, *proj)
	}

	return results, nil
}

// composeConfigPaths returns the supported filenames in canonical order. If a
// project directory contains both files, compose.yaml wins and the legacy
// docker-compose.yml is ignored for that project.
func composeConfigPaths(root, name string) []string {
	projectDir := path.Join(root, name)
	return []string{
		path.Join(projectDir, "compose.yaml"),
		path.Join(projectDir, "docker-compose.yml"),
	}
}

func isUserComposeConfigPath(filePath string) bool {
	cleanPath := path.Clean(filePath)
	root := path.Clean(userComposeRoot)
	return strings.HasPrefix(cleanPath, root+"/")
}

func discoveredComposeConfigPaths(output string) []string {
	seen := make(map[string]struct{})
	paths := make([]string, 0)
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		cleanPath := path.Clean(line)
		base := path.Base(cleanPath)
		if !isUserComposeConfigPath(cleanPath) || (base != "compose.yaml" && base != "docker-compose.yml") {
			continue
		}
		if _, exists := seen[cleanPath]; exists {
			continue
		}
		seen[cleanPath] = struct{}{}
		paths = append(paths, cleanPath)
	}
	return paths
}

func composeProjectDeleteTargets(filePath string) ([]string, error) {
	cleanPath := path.Clean(filePath)
	if !isUserComposeConfigPath(cleanPath) {
		return nil, ErrSystemComposeProject
	}
	dir := path.Dir(cleanPath)
	// Remove only the two supported Compose filenames. This prevents a legacy
	// docker-compose.yml from making a deleted project reappear while leaving
	// every other user-managed file in the directory untouched.
	return []string{
		path.Join(dir, "compose.yaml"),
		path.Join(dir, "docker-compose.yml"),
	}, nil
}

func composeDownArgs(filePath string, deleteVolumes bool) []string {
	args := []string{"compose", "-f", filePath, "down"}
	if deleteVolumes {
		args = append(args, "-v")
	}
	return args
}

func (c *Client) resolveExistingComposeFile(ctx context.Context, name string) (string, error) {
	name = strings.TrimSpace(name)
	if !validProjectName.MatchString(name) {
		return "", fmt.Errorf("项目名称只能包含英文字母、数字、下划线或连字符")
	}

	// Check user compose directory first. compose.yaml is canonical when both
	// supported filenames exist in the same project directory.
	for _, userPath := range composeConfigPaths(userComposeRoot, name) {
		if _, err := c.vmMgr.Exec(ctx, "test", "-f", userPath); err == nil {
			return userPath, nil
		}
	}

	// Check system appdata directory
	sysPath := path.Join("/data/appdata", name, "compose.yaml")
	if _, err := c.vmMgr.Exec(ctx, "test", "-f", sysPath); err == nil {
		return sysPath, nil
	}

	return "", fmt.Errorf("找不到项目 %s 的 compose 配置文件", name)
}

// ensureComposeFile may materialize a bundled template for state-changing
// Compose operations. Read-only requests must use GetComposeYaml, which never
// writes to the VM.
func (c *Client) ensureComposeFile(ctx context.Context, name string) (string, error) {
	filePath, err := c.resolveExistingComposeFile(ctx, name)
	if err == nil {
		return filePath, nil
	}
	name = strings.TrimSpace(name)
	if !validProjectName.MatchString(name) {
		return "", fmt.Errorf("项目名称只能包含英文字母、数字、下划线或连字符")
	}

	// Check if this is a built-in app template from projectRoot.
	if c.projectRoot != "" {
		tmplPath := filepath.Join(c.projectRoot, "templates", "apps", name, "compose.yaml")
		if data, err := os.ReadFile(tmplPath); err == nil {
			if len(data) > maxComposeYAMLBytes {
				return "", fmt.Errorf("Compose 模板超过 8 MB 限制")
			}
			// Auto sync template compose file into VM /data/appdata/<name>/compose.yaml
			appDir := path.Join("/data/appdata", name)
			sysPath := path.Join(appDir, "compose.yaml")
			if _, mkdirErr := c.vmMgr.Exec(ctx, "mkdir", "-p", appDir); mkdirErr != nil {
				return "", fmt.Errorf("同步项目目录失败: %w", mkdirErr)
			}
			if _, err := c.vmMgr.ExecWithInput(ctx, strings.NewReader(string(data)), "sudo", "tee", sysPath); err != nil {
				return "", fmt.Errorf("同步项目配置失败: %w", err)
			}
			return sysPath, nil
		}
	}

	return "", fmt.Errorf("找不到项目 %s 的 compose 配置文件", name)
}

func (c *Client) GetComposeYaml(ctx context.Context, name string) (string, error) {
	filePath, err := c.resolveExistingComposeFile(ctx, name)
	if err == nil {
		out, readErr := c.vmMgr.Exec(ctx, "cat", filePath)
		if readErr != nil {
			return "", fmt.Errorf("读取 compose 文件失败: %w", readErr)
		}
		return out, nil
	}

	name = strings.TrimSpace(name)
	if !validProjectName.MatchString(name) {
		return "", fmt.Errorf("项目名称只能包含英文字母、数字、下划线或连字符")
	}
	if c.projectRoot != "" {
		tmplPath := filepath.Join(c.projectRoot, "templates", "apps", name, "compose.yaml")
		data, readErr := os.ReadFile(tmplPath)
		if readErr == nil {
			if len(data) > maxComposeYAMLBytes {
				return "", fmt.Errorf("Compose 模板超过 8 MB 限制")
			}
			return string(data), nil
		}
	}
	return "", err
}

func (c *Client) DeployCompose(ctx context.Context, name string, yamlContent string, out io.Writer) error {
	name = strings.TrimSpace(name)
	if !validProjectName.MatchString(name) {
		return fmt.Errorf("项目名称只能包含英文字母、数字、下划线或连字符")
	}

	yamlContent = strings.TrimSpace(yamlContent)
	if yamlContent == "" {
		return fmt.Errorf("Compose 配置内容不能为空")
	}
	if len([]byte(yamlContent)) > maxComposeYAMLBytes {
		return fmt.Errorf("Compose 配置内容不能超过 8 MB")
	}
	if _, err := PublishedHostPorts(yamlContent); err != nil {
		return fmt.Errorf("解析 Compose 端口失败: %w", err)
	}

	fmt.Fprintf(out, "🚀 开始部署 Docker Compose 项目: %s\n", name)

	// 1. Repair the shared root as well as creating the project directory. Older
	// VM images created the compose directory as root:root/0755, which prevents
	// the fixed Lima management account (a member of the macbox group) from
	// creating custom projects. install updates existing directory metadata, so
	// this also migrates already-provisioned VMs without rebuilding them.
	if repairOut, err := c.vmMgr.Exec(ctx, "sudo", "install", "-d", "-o", "macbox", "-g", "macbox", "-m", "2770", userComposeRoot); err != nil {
		fmt.Fprintf(out, "❌ 修复 Compose 项目目录权限失败: %s\n", strings.TrimSpace(repairOut))
		return fmt.Errorf("修复 Compose 项目目录权限失败: %w", err)
	}
	projectDir := path.Join(userComposeRoot, name)
	if _, err := c.vmMgr.Exec(ctx, "mkdir", "-p", projectDir); err != nil {
		fmt.Fprintf(out, "❌ 创建项目目录失败: %v\n", err)
		return err
	}

	// 2. Stream the YAML as stdin so content cannot be interpreted as shell code.
	composePath := path.Join(projectDir, "compose.yaml")
	if _, err := c.vmMgr.ExecWithInput(ctx, strings.NewReader(yamlContent), "sudo", "tee", composePath); err != nil {
		fmt.Fprintf(out, "❌ 写入 compose.yaml 失败: %v\n", err)
		return err
	}
	fmt.Fprintf(out, "📝 已写入项目配置文件: %s/compose.yaml\n", projectDir)

	// 3. Run docker compose up -d with streaming logs
	fmt.Fprintln(out, "⚙️ 正在执行 docker compose up -d ...")
	if err := c.vmMgr.ExecStream(ctx, out, "docker", "compose", "-f", composePath, "up", "-d", "--remove-orphans"); err != nil {
		fmt.Fprintf(out, "❌ 部署执行失败: %v\n", err)
		return err
	}

	fmt.Fprintf(out, "✅ Docker Compose 项目 [%s] 部署完成并已启动！\n", name)
	return nil
}

func (c *Client) ComposeAction(ctx context.Context, name string, action string, out io.Writer) error {
	filePath, err := c.ensureComposeFile(ctx, name)
	if err != nil {
		return err
	}
	var composeArgs []string
	switch action {
	case "start":
		// `compose start` only works while stopped containers still exist. An
		// offline project discovered from its YAML may have no containers (for
		// example after a failed first deployment), so use the idempotent `up`
		// path that creates missing containers as well as starting existing ones.
		composeArgs = []string{"up", "-d", "--remove-orphans"}
		fmt.Fprintf(out, "▶️ 正在启动项目 [%s]...\n", name)
	case "stop":
		composeArgs = []string{"stop"}
		fmt.Fprintf(out, "⏹️ 正在停止项目 [%s]...\n", name)
	case "restart":
		// Recreate from the declared configuration so restart also repairs a
		// project whose container disappeared while its Compose file remained.
		composeArgs = []string{"up", "-d", "--force-recreate", "--remove-orphans"}
		fmt.Fprintf(out, "🔄 正在重启项目 [%s]...\n", name)
	case "down":
		composeArgs = []string{"down"}
		fmt.Fprintf(out, "🔻 正在停止并下线服务 [%s]...\n", name)
	case "pull":
		composeArgs = []string{"pull"}
		fmt.Fprintf(out, "📦 正在拉取项目最新镜像 [%s]...\n", name)
	default:
		return fmt.Errorf("不支持的项目动作: %s", action)
	}

	commandArgs := append([]string{"docker", "compose", "-f", filePath}, composeArgs...)
	if err := c.vmMgr.ExecStream(ctx, out, commandArgs...); err != nil {
		fmt.Fprintf(out, "❌ 操作失败: %v\n", err)
		return err
	}
	fmt.Fprintf(out, "✅ 操作 [%s] 成功完成\n", action)
	return nil
}

func (c *Client) DeleteComposeProject(ctx context.Context, name string, deleteVolumes bool) error {
	filePath, err := c.resolveExistingComposeFile(ctx, name)
	if err != nil {
		return err
	}
	resolvedFilePath := filePath
	deletePaths, err := composeProjectDeleteTargets(resolvedFilePath)
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(name))
	}
	workDir := path.Dir(resolvedFilePath)

	// This is the explicitly destructive project-level operation. Unlike
	// ComposeAction("down") and RemoveContainer, it also removes compose.yaml.
	// Keep those operations separate so users can delete/recreate containers
	// while retaining the configuration for the next deployment.
	// Down containers
	dockerArgs := append([]string{"docker"}, composeDownArgs(resolvedFilePath, deleteVolumes)...)
	if out, err := c.vmMgr.Exec(ctx, dockerArgs...); err != nil {
		return fmt.Errorf("停止 Compose 项目失败: %s (%w)", out, err)
	}

	// Remove only the compose file we resolved. A project directory may contain
	// user-managed files, so recursive deletion is intentionally not used.
	if isUserComposeConfigPath(resolvedFilePath) {
		for _, deletePath := range deletePaths {
			if out, err := c.vmMgr.Exec(ctx, "rm", "-f", deletePath); err != nil {
				return fmt.Errorf("删除 Compose 配置文件失败: %s (%w)", out, err)
			}
		}
		// Keep the directory only when it still contains user files. rmdir is
		// non-recursive; failure here is safe and does not invalidate the delete.
		_, _ = c.vmMgr.Exec(ctx, "rmdir", workDir)
	}

	return nil
}
