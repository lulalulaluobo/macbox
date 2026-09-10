package docker

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var validProjectName = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

type composeLsItem struct {
	Name        string `json:"Name"`
	Status      string `json:"Status"`
	ConfigFiles string `json:"ConfigFiles"`
}

func (c *Client) ListComposeProjects(ctx context.Context) ([]ComposeProject, error) {
	// 1. Run docker compose ls -a
	out, err := c.runDockerCmd(ctx, "compose", "ls", "-a", "--format", "json")
	var lsItems []composeLsItem
	if err == nil && len(out) > 0 {
		_ = json.Unmarshal(out, &lsItems)
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
	findCmd := "find /data/appdata/compose -maxdepth 2 -name 'compose.yaml' -o -name 'docker-compose.yml' 2>/dev/null"
	findOut, _ := c.vmMgr.Exec(ctx, "bash", "-c", findCmd)
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
	containers, _ := c.ListContainers(ctx)
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

func (c *Client) resolveComposeFile(ctx context.Context, name string) (string, error) {
	// Check user compose directory first
	userPath := fmt.Sprintf("/data/appdata/compose/%s/compose.yaml", name)
	checkCmd := fmt.Sprintf("[ -f %s ] && echo 'exists'", userPath)
	out, _ := c.vmMgr.Exec(ctx, "bash", "-c", checkCmd)
	if strings.Contains(out, "exists") {
		return userPath, nil
	}

	userPathYml := fmt.Sprintf("/data/appdata/compose/%s/docker-compose.yml", name)
	checkCmd2 := fmt.Sprintf("[ -f %s ] && echo 'exists'", userPathYml)
	out2, _ := c.vmMgr.Exec(ctx, "bash", "-c", checkCmd2)
	if strings.Contains(out2, "exists") {
		return userPathYml, nil
	}

	// Check system appdata directory
	sysPath := fmt.Sprintf("/data/appdata/%s/compose.yaml", name)
	checkCmd3 := fmt.Sprintf("[ -f %s ] && echo 'exists'", sysPath)
	out3, _ := c.vmMgr.Exec(ctx, "bash", "-c", checkCmd3)
	if strings.Contains(out3, "exists") {
		return sysPath, nil
	}

	// Check if this is a built-in app template from projectRoot
	if c.projectRoot != "" {
		tmplPath := filepath.Join(c.projectRoot, "templates", "apps", name, "compose.yaml")
		if data, err := os.ReadFile(tmplPath); err == nil {
			// Auto sync template compose file into VM /data/appdata/<name>/compose.yaml
			appDir := fmt.Sprintf("/data/appdata/%s", name)
			encodedYAML := strings.ReplaceAll(string(data), "'", "'\\''")
			syncCmd := fmt.Sprintf("mkdir -p %s && cat <<'EOF' > %s/compose.yaml\n%s\nEOF", appDir, appDir, encodedYAML)
			_, _ = c.vmMgr.Exec(ctx, "bash", "-c", syncCmd)
			return sysPath, nil
		}
	}

	return "", fmt.Errorf("找不到项目 %s 的 compose 配置文件", name)
}

func (c *Client) GetComposeYaml(ctx context.Context, name string) (string, error) {
	filePath, err := c.resolveComposeFile(ctx, name)
	if err != nil {
		return "", err
	}

	catCmd := fmt.Sprintf("cat %s", filePath)
	out, err := c.vmMgr.Exec(ctx, "bash", "-c", catCmd)
	if err != nil {
		return "", fmt.Errorf("读取 compose 文件失败: %w", err)
	}
	return out, nil
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

	fmt.Fprintf(out, "🚀 开始部署 Docker Compose 项目: %s\n", name)

	// 1. Prepare directory in VM
	projectDir := fmt.Sprintf("/data/appdata/compose/%s", name)
	mkdirCmd := fmt.Sprintf("mkdir -p %s", projectDir)
	if _, err := c.vmMgr.Exec(ctx, "bash", "-c", mkdirCmd); err != nil {
		fmt.Fprintf(out, "❌ 创建项目目录失败: %v\n", err)
		return err
	}

	// 2. Write compose.yaml safely via base64
	encoded := base64.StdEncoding.EncodeToString([]byte(yamlContent))
	writeCmd := fmt.Sprintf("echo '%s' | base64 -d > %s/compose.yaml", encoded, projectDir)
	if _, err := c.vmMgr.Exec(ctx, "bash", "-c", writeCmd); err != nil {
		fmt.Fprintf(out, "❌ 写入 compose.yaml 失败: %v\n", err)
		return err
	}
	fmt.Fprintf(out, "📝 已写入项目配置文件: %s/compose.yaml\n", projectDir)

	// 3. Run docker compose up -d with streaming logs
	fmt.Fprintln(out, "⚙️ 正在执行 docker compose up -d ...")
	execCmd := fmt.Sprintf("cd %s && docker compose up -d --remove-orphans", projectDir)
	if err := c.vmMgr.ExecStream(ctx, out, "bash", "-c", execCmd); err != nil {
		fmt.Fprintf(out, "❌ 部署执行失败: %v\n", err)
		return err
	}

	fmt.Fprintf(out, "✅ Docker Compose 项目 [%s] 部署完成并已启动！\n", name)
	return nil
}

func (c *Client) ComposeAction(ctx context.Context, name string, action string, out io.Writer) error {
	filePath, err := c.resolveComposeFile(ctx, name)
	if err != nil {
		return err
	}
	workDir := filepath.Dir(filePath)

	var cmd string
	switch action {
	case "start":
		cmd = fmt.Sprintf("cd %s && docker compose start", workDir)
		fmt.Fprintf(out, "▶️ 正在启动项目 [%s]...\n", name)
	case "stop":
		cmd = fmt.Sprintf("cd %s && docker compose stop", workDir)
		fmt.Fprintf(out, "⏹️ 正在停止项目 [%s]...\n", name)
	case "restart":
		cmd = fmt.Sprintf("cd %s && docker compose restart", workDir)
		fmt.Fprintf(out, "🔄 正在重启项目 [%s]...\n", name)
	case "down":
		cmd = fmt.Sprintf("cd %s && docker compose down", workDir)
		fmt.Fprintf(out, "🔻 正在停止并下线服务 [%s]...\n", name)
	case "pull":
		cmd = fmt.Sprintf("cd %s && docker compose pull", workDir)
		fmt.Fprintf(out, "📦 正在拉取项目最新镜像 [%s]...\n", name)
	default:
		return fmt.Errorf("不支持的项目动作: %s", action)
	}

	if err := c.vmMgr.ExecStream(ctx, out, "bash", "-c", cmd); err != nil {
		fmt.Fprintf(out, "❌ 操作失败: %v\n", err)
		return err
	}
	fmt.Fprintf(out, "✅ 操作 [%s] 成功完成\n", action)
	return nil
}

func (c *Client) DeleteComposeProject(ctx context.Context, name string, deleteVolumes bool) error {
	filePath, err := c.resolveComposeFile(ctx, name)
	if err != nil {
		return err
	}
	workDir := filepath.Dir(filePath)

	// Down containers
	downCmd := fmt.Sprintf("cd %s && docker compose down", workDir)
	if deleteVolumes {
		downCmd += " -v"
	}
	_, _ = c.vmMgr.Exec(ctx, "bash", "-c", downCmd)

	// If it's a user compose project in /data/appdata/compose/, delete folder
	if strings.HasPrefix(workDir, "/data/appdata/compose/") {
		delCmd := fmt.Sprintf("rm -rf %s", workDir)
		_, _ = c.vmMgr.Exec(ctx, "bash", "-c", delCmd)
	}

	return nil
}
