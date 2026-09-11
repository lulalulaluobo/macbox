package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

var validProjectName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

const maxComposeYAMLBytes = 8 << 20

type composeLsItem struct {
	Name        string `json:"Name"`
	Status      string `json:"Status"`
	ConfigFiles string `json:"ConfigFiles"`
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
	// A fresh NAS data volume has no user Compose projects yet. Keep the
	// discovery command successful for that empty state instead of marking a
	// healthy Docker daemon as degraded because find cannot open a missing
	// optional directory.
	findScript := "if [ -d /data/appdata/compose ]; then find /data/appdata/compose -maxdepth 2 -type f -name compose.yaml -o -name docker-compose.yml; fi"
	findOut, err := c.vmMgr.Exec(ctx, "sh", "-c", findScript)
	if err != nil {
		return nil, fmt.Errorf("扫描 Compose 配置目录失败: %w", err)
	}
	lines := strings.Split(findOut, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
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

func (c *Client) resolveExistingComposeFile(ctx context.Context, name string) (string, error) {
	name = strings.TrimSpace(name)
	if !validProjectName.MatchString(name) {
		return "", fmt.Errorf("项目名称只能包含英文字母、数字、下划线或连字符")
	}

	// Check user compose directory first
	userPath := path.Join("/data/appdata/compose", name, "compose.yaml")
	if _, err := c.vmMgr.Exec(ctx, "test", "-f", userPath); err == nil {
		return userPath, nil
	}

	userPathYml := path.Join("/data/appdata/compose", name, "docker-compose.yml")
	if _, err := c.vmMgr.Exec(ctx, "test", "-f", userPathYml); err == nil {
		return userPathYml, nil
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

	fmt.Fprintf(out, "🚀 开始部署 Docker Compose 项目: %s\n", name)

	// 1. Prepare directory in VM
	projectDir := path.Join("/data/appdata/compose", name)
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
	var composeAction string
	switch action {
	case "start":
		composeAction = "start"
		fmt.Fprintf(out, "▶️ 正在启动项目 [%s]...\n", name)
	case "stop":
		composeAction = "stop"
		fmt.Fprintf(out, "⏹️ 正在停止项目 [%s]...\n", name)
	case "restart":
		composeAction = "restart"
		fmt.Fprintf(out, "🔄 正在重启项目 [%s]...\n", name)
	case "down":
		composeAction = "down"
		fmt.Fprintf(out, "🔻 正在停止并下线服务 [%s]...\n", name)
	case "pull":
		composeAction = "pull"
		fmt.Fprintf(out, "📦 正在拉取项目最新镜像 [%s]...\n", name)
	default:
		return fmt.Errorf("不支持的项目动作: %s", action)
	}

	if err := c.vmMgr.ExecStream(ctx, out, "docker", "compose", "-f", filePath, composeAction); err != nil {
		fmt.Fprintf(out, "❌ 操作失败: %v\n", err)
		return err
	}
	fmt.Fprintf(out, "✅ 操作 [%s] 成功完成\n", action)
	return nil
}

func (c *Client) DeleteComposeProject(ctx context.Context, name string, deleteVolumes bool) error {
	filePath, err := c.ensureComposeFile(ctx, name)
	if err != nil {
		return err
	}
	workDir := path.Dir(filePath)

	// Down containers
	downArgs := []string{"compose", "-f", filePath, "down"}
	if deleteVolumes {
		downArgs = append(downArgs, "-v")
	}
	dockerArgs := append([]string{"docker"}, downArgs...)
	if out, err := c.vmMgr.Exec(ctx, dockerArgs...); err != nil {
		return fmt.Errorf("停止 Compose 项目失败: %s (%w)", out, err)
	}

	// Remove only the compose file we resolved. A project directory may contain
	// user-managed files, so recursive deletion is intentionally not used.
	if strings.HasPrefix(workDir, "/data/appdata/compose/") {
		if out, err := c.vmMgr.Exec(ctx, "rm", "-f", filePath); err != nil {
			return fmt.Errorf("删除 Compose 配置文件失败: %s (%w)", out, err)
		}
		// Keep the directory only when it still contains user files. rmdir is
		// non-recursive; failure here is safe and does not invalidate the delete.
		_, _ = c.vmMgr.Exec(ctx, "rmdir", workDir)
	}

	return nil
}
