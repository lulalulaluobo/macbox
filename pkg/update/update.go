package update

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/buildinfo"
)

type State struct {
	ProcessID       int       `json:"processID,omitempty"`
	ID              string    `json:"id"`
	Version         string    `json:"version"`
	PreviousVersion string    `json:"previousVersion"`
	Status          string    `json:"status"`
	Stage           string    `json:"stage"`
	Message         string    `json:"message"`
	Error           string    `json:"error,omitempty"`
	UpdatedAt       time.Time `json:"updatedAt"`
	CanRollback     bool      `json:"canRollback"`
}

type Plan struct {
	ID              string   `json:"id"`
	Version         string   `json:"version"`
	PreviousVersion string   `json:"previousVersion"`
	Home            string   `json:"home"`
	Root            string   `json:"root"`
	Stage           string   `json:"stage"`
	Backup          string   `json:"backup"`
	MenuStage       string   `json:"menuStage"`
	MenuTarget      string   `json:"menuTarget"`
	MenuBackup      string   `json:"menuBackup"`
	PID             int      `json:"pid"`
	Args            []string `json:"args"`
	Port            int      `json:"port"`
	AgentLoaded     bool     `json:"agentLoaded"`
	RestoreSnapshot string   `json:"restoreSnapshot,omitempty"`
}

type Manager struct {
	mu   sync.Mutex
	home string
	port int
	args []string
}

func NewManager(port int, args []string) *Manager {
	home, _ := os.UserHomeDir()
	return &Manager{home: home, port: port, args: append([]string(nil), args...)}
}
func (m *Manager) dir() string { return filepath.Join(m.home, ".macbox", "updates") }

func readState(dir string) (State, error) {
	var state State
	data, err := os.ReadFile(filepath.Join(dir, "state.json"))
	if err != nil {
		return state, err
	}
	err = json.Unmarshal(data, &state)
	return state, err
}
func writeJSON(path string, value interface{}) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".state-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
func stateAt(plan Plan, status, stage, message string, taskErr error) {
	state := State{ProcessID: os.Getpid(), ID: plan.ID, Version: plan.Version, PreviousVersion: plan.PreviousVersion, Status: status, Stage: stage, Message: message, UpdatedAt: time.Now()}
	if taskErr != nil {
		state.Error = taskErr.Error()
	}
	if status == "succeeded" && plan.RestoreSnapshot == "" {
		_, err := os.Stat(plan.Backup)
		state.CanRollback = err == nil
	}
	_ = writeJSON(filepath.Join(plan.Home, ".macbox", "updates", plan.ID, "state.json"), state)
}
func (m *Manager) History() []State {
	entries, _ := os.ReadDir(m.dir())
	states := []State{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		state, err := readState(filepath.Join(m.dir(), entry.Name()))
		if err == nil {
			if state.Status == "running" && state.ProcessID > 1 && syscall.Kill(state.ProcessID, 0) == syscall.ESRCH {
				state.Status = "failed"
				state.Stage = "interrupted"
				state.Error = "更新助手已退出，请查看日志和恢复目录"
				state.Message = "更新中断"
				state.UpdatedAt = time.Now()
				_ = writeJSON(filepath.Join(m.dir(), entry.Name(), "state.json"), state)
			}
			if state.Version != buildinfo.Version {
				state.CanRollback = false
			}
			states = append(states, state)
		}
	}
	sort.Slice(states, func(i, j int) bool { return states[i].UpdatedAt.After(states[j].UpdatedAt) })
	if len(states) > 20 {
		states = states[:20]
	}
	return states
}
func (m *Manager) Active() bool {
	for _, state := range m.History() {
		if state.Status == "running" {
			return true
		}
	}
	return false
}

func (m *Manager) Start(release *Release, rollback bool) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !Info().Managed {
		return "", fmt.Errorf("当前安装方式不支持在线替换，请先安装发行包")
	}
	if m.Active() {
		return "", fmt.Errorf("已有升级或恢复任务正在执行")
	}
	var prior Plan
	if rollback {
		for _, state := range m.History() {
			if state.Status == "succeeded" && state.CanRollback {
				data, err := os.ReadFile(filepath.Join(m.dir(), state.ID, "plan.json"))
				if err != nil {
					return "", err
				}
				if err = json.Unmarshal(data, &prior); err != nil {
					return "", err
				}
				break
			}
		}
		if prior.ID == "" {
			return "", fmt.Errorf("没有可恢复的上一版本")
		}
	} else if release == nil || !release.Available || Compare(release.Version, buildinfo.Version) <= 0 {
		return "", fmt.Errorf("没有可升级的稳定版本")
	}
	var random [12]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", err
	}
	id := hex.EncodeToString(random[:])
	root := filepath.Join(m.home, ".local", "share", "macbox")
	plan := Plan{ID: id, Home: m.home, Root: root, Stage: filepath.Join(filepath.Dir(root), ".macbox-update-"+id), Backup: filepath.Join(filepath.Dir(root), ".macbox-previous-"+id), PID: os.Getpid(), Args: m.args, Port: m.port, PreviousVersion: buildinfo.Version}
	if rollback {
		plan.Version = prior.PreviousVersion
		plan.RestoreSnapshot = filepath.Join(m.dir(), prior.ID, "snapshot")
	} else {
		plan.Version = release.Version
	}
	stateAt(plan, "running", "preparing", "正在准备升级，现有数据保留", nil)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
		defer cancel()
		if err := m.prepare(ctx, plan, release, prior, rollback); err != nil {
			stateAt(plan, "failed", "failed", "准备失败，当前版本继续运行", err)
			os.RemoveAll(plan.Stage)
		}
	}()
	return id, nil
}

func (m *Manager) prepare(ctx context.Context, plan Plan, release *Release, prior Plan, rollback bool) error {
	taskDir := filepath.Join(m.dir(), plan.ID)
	if err := os.Mkdir(plan.Stage, 0700); err != nil {
		return err
	}
	var app string
	if rollback {
		if err := copyTree(prior.Backup, plan.Stage, nil); err != nil {
			return err
		}
		if prior.MenuBackup != "" {
			app = filepath.Join(taskDir, "new-menu.app")
			if err := copyTree(prior.MenuBackup, app, nil); err != nil {
				return err
			}
		}
	} else {
		stateAt(plan, "running", "downloading", "正在下载并校验官方发行包", nil)
		archive := filepath.Join(taskDir, release.Asset)
		if err := download(ctx, release, archive); err != nil {
			return err
		}
		stateAt(plan, "running", "verifying", "正在验证程序组件与 CPU 架构", nil)
		var err error
		app, err = unpack(ctx, release, archive, taskDir, plan.Stage)
		if err != nil {
			return err
		}
	}
	stateAt(plan, "running", "backup", "正在保存旧程序和配置恢复点", nil)
	snapshot := filepath.Join(taskDir, "snapshot")
	if err := copyTree(filepath.Join(m.home, ".macbox"), filepath.Join(snapshot, "config"), map[string]bool{"updates": true, "macbox.log": true, "jobs.json": true, "macbox.menu.pid": true}); err != nil {
		return fmt.Errorf("配置快照失败: %w", err)
	}
	definitions := filepath.Join(m.home, "Library", "Application Support", "MacBox")
	if _, err := os.Stat(definitions); err == nil {
		if err := copyTree(definitions, filepath.Join(snapshot, "definitions"), nil); err != nil {
			return err
		}
	}
	if app != "" {
		for _, target := range []string{filepath.Join(m.home, "Applications", "MacBoxMemu.app"), "/Applications/MacBoxMemu.app"} {
			if _, err := os.Stat(target); err != nil {
				continue
			}
			identifier, err := exec.CommandContext(ctx, "/usr/libexec/PlistBuddy", "-c", "Print :CFBundleIdentifier", filepath.Join(target, "Contents", "Info.plist")).Output()
			if err != nil || !strings.Contains(string(identifier), "macbox.menu") {
				return fmt.Errorf("现有菜单栏 App 身份无法确认")
			}
			probe, err := os.CreateTemp(filepath.Dir(target), ".macbox-write-*")
			if err != nil {
				return fmt.Errorf("菜单栏应用目录不可写，请先在 Mac 本机完成应用目录授权")
			}
			probe.Close()
			os.Remove(probe.Name())
			// Keep the staged app outside the runtime directory being activated.
			if strings.HasPrefix(app, plan.Stage+string(filepath.Separator)) {
				copy := filepath.Join(taskDir, "new-menu.app")
				if err := copyTree(app, copy, nil); err != nil {
					return err
				}
				app = copy
			}
			plan.MenuStage, plan.MenuTarget, plan.MenuBackup = app, target, filepath.Join(filepath.Dir(target), ".MacBox-previous-"+plan.ID+".app")
			break
		}
	}
	label := "gui/" + strconv.Itoa(os.Getuid()) + "/com.macbox.server"
	plan.AgentLoaded = exec.CommandContext(ctx, "/bin/launchctl", "print", label).Run() == nil
	if err := writeJSON(filepath.Join(taskDir, "plan.json"), plan); err != nil {
		return err
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	helper := filepath.Join(taskDir, "updater")
	if err := copyFile(exe, helper, 0700); err != nil {
		return err
	}
	log, err := os.OpenFile(filepath.Join(taskDir, "updater.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer log.Close()
	command := exec.Command(helper, "--apply-update", filepath.Join(taskDir, "plan.json"))
	command.Stdout, command.Stderr = log, log
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := command.Start(); err != nil {
		return err
	}
	_ = command.Process.Release()
	return nil
}

func validatePlan(plan Plan, path string) error {
	home, _ := os.UserHomeDir()
	if plan.Home != home || len(plan.ID) != 24 {
		return fmt.Errorf("无效升级任务")
	}
	if _, err := hex.DecodeString(plan.ID); err != nil {
		return err
	}
	root := filepath.Join(home, ".local", "share", "macbox")
	if plan.Root != root || plan.Stage != filepath.Join(filepath.Dir(root), ".macbox-update-"+plan.ID) || plan.Backup != filepath.Join(filepath.Dir(root), ".macbox-previous-"+plan.ID) || path != filepath.Join(home, ".macbox", "updates", plan.ID, "plan.json") {
		return fmt.Errorf("升级路径不受支持")
	}
	for _, p := range []string{filepath.Dir(root), root, plan.Stage} {
		if info, err := os.Lstat(p); err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return fmt.Errorf("升级路径不可用")
		}
	}
	if plan.Port < 1 || plan.Port > 65535 || plan.PID <= 1 || plan.PID == os.Getpid() {
		return fmt.Errorf("无效进程或服务端口")
	}
	if plan.MenuTarget != "" {
		if plan.MenuTarget != "/Applications/MacBoxMemu.app" && plan.MenuTarget != filepath.Join(home, "Applications", "MacBoxMemu.app") {
			return fmt.Errorf("无效应用安装位置")
		}
		if plan.MenuStage != filepath.Join(home, ".macbox", "updates", plan.ID, "new-menu.app") || plan.MenuBackup != filepath.Join(filepath.Dir(plan.MenuTarget), ".MacBox-previous-"+plan.ID+".app") {
			return fmt.Errorf("无效应用升级路径")
		}
	}
	if plan.RestoreSnapshot != "" {
		relative, err := filepath.Rel(filepath.Join(home, ".macbox", "updates"), plan.RestoreSnapshot)
		parts := strings.Split(relative, string(filepath.Separator))
		if err != nil || len(parts) != 2 || len(parts[0]) != 24 || parts[1] != "snapshot" {
			return fmt.Errorf("无效恢复快照")
		}
	}
	return nil
}

// activateRuntime retains the old directory until the caller verifies the
// running service. A failed verification restores the exact old files.
func activateRuntime(stage, root, backup string, verify func() error) error {
	if _, err := os.Lstat(backup); !os.IsNotExist(err) {
		return fmt.Errorf("恢复目录已存在或不可用")
	}
	if err := os.Rename(root, backup); err != nil {
		return err
	}
	if err := os.Rename(stage, root); err != nil {
		restore := os.Rename(backup, root)
		if restore != nil {
			return fmt.Errorf("切换失败: %v；恢复失败: %w", err, restore)
		}
		return err
	}
	if err := verify(); err != nil {
		if moveErr := os.Rename(root, stage); moveErr != nil {
			return fmt.Errorf("新版本验证失败: %v；保留新程序失败: %w", err, moveErr)
		}
		if restoreErr := os.Rename(backup, root); restoreErr != nil {
			return fmt.Errorf("新版本验证失败: %v；恢复旧程序失败: %w", err, restoreErr)
		}
		return err
	}
	return nil
}

func signalBackend(pid int, root string) error {
	out, err := exec.Command("/bin/ps", "-p", strconv.Itoa(pid), "-o", "comm=").Output()
	if err != nil {
		return nil
	}
	if strings.TrimSpace(string(out)) != filepath.Join(root, "bin", "macbox") {
		return fmt.Errorf("后台进程身份已改变，停止升级")
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Signal(syscall.SIGTERM)
}

func Run(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var plan Plan
	if err = json.Unmarshal(data, &plan); err != nil {
		return err
	}
	if err = validatePlan(plan, path); err != nil {
		return err
	}
	time.Sleep(2 * time.Second) // Let the initiating response reach the browser.
	stateAt(plan, "running", "restarting", "正在切换程序，管理页面即将重新连接", nil)
	agentDomain := "gui/" + strconv.Itoa(os.Getuid())
	plist := filepath.Join(plan.Home, "Library", "LaunchAgents", "com.macbox.server.plist")
	if plan.AgentLoaded {
		if out, err := exec.Command("/bin/launchctl", "bootout", agentDomain, plist).CombinedOutput(); err != nil {
			stateAt(plan, "failed", "failed", "原后台未停止，未切换程序", fmt.Errorf("%s: %w", out, err))
			return err
		}
	} else if err = signalBackend(plan.PID, plan.Root); err != nil {
		stateAt(plan, "failed", "failed", "原后台未停止，未切换程序", err)
		return err
	}
	for i := 0; i < 40; i++ {
		if exec.Command("/bin/kill", "-0", strconv.Itoa(plan.PID)).Run() != nil {
			break
		}
		time.Sleep(250 * time.Millisecond)
	}
	if exec.Command("/bin/kill", "-0", strconv.Itoa(plan.PID)).Run() == nil {
		err := fmt.Errorf("旧后台未在规定时间退出，未替换程序")
		if plan.AgentLoaded {
			_ = exec.Command("/bin/launchctl", "bootstrap", agentDomain, plist).Run()
		}
		stateAt(plan, "failed", "failed", err.Error(), err)
		return err
	}
	menuChanged := false
	start := func() error {
		if plan.AgentLoaded {
			out, err := exec.Command("/bin/launchctl", "bootstrap", agentDomain, plist).CombinedOutput()
			if err != nil {
				return fmt.Errorf("重新启动后台失败: %s (%w)", out, err)
			}
			return nil
		}
		log, err := os.OpenFile(filepath.Join(plan.Home, ".macbox", "macbox.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		defer log.Close()
		cmd := exec.Command(filepath.Join(plan.Root, "bin", "macbox"), plan.Args...)
		cmd.Dir = plan.Root
		cmd.Stdout, cmd.Stderr = log, log
		cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
		if err = cmd.Start(); err != nil {
			return err
		}
		return cmd.Process.Release()
	}
	stopNew := func() {
		if plan.AgentLoaded {
			_ = exec.Command("/bin/launchctl", "bootout", agentDomain, plist).Run()
		} else {
			out, _ := exec.Command("/usr/sbin/lsof", "-nP", "-tiTCP:"+strconv.Itoa(plan.Port), "-sTCP:LISTEN").Output()
			for _, token := range strings.Fields(string(out)) {
				pid, _ := strconv.Atoi(token)
				if pid > 1 && pid != os.Getpid() {
					_ = signalBackend(pid, plan.Root)
				}
			}
		}
	}
	verify := func() error {
		if plan.MenuTarget != "" {
			if err := os.Rename(plan.MenuTarget, plan.MenuBackup); err != nil {
				return err
			}
			if err := os.Rename(plan.MenuStage, plan.MenuTarget); err != nil {
				_ = os.Rename(plan.MenuBackup, plan.MenuTarget)
				return err
			}
			menuChanged = true
		}
		if plan.RestoreSnapshot != "" {
			if err := restoreSnapshot(plan.Home, plan.RestoreSnapshot); err != nil {
				return err
			}
		}
		if err := start(); err != nil {
			return err
		}
		if err := waitHealthy(plan.Port, plan.Version, plan.RestoreSnapshot != ""); err != nil {
			stopNew()
			return err
		}
		return nil
	}
	err = activateRuntime(plan.Stage, plan.Root, plan.Backup, verify)
	if err != nil {
		stopNew()
		if menuChanged {
			_ = os.Rename(plan.MenuTarget, plan.MenuStage)
			_ = os.Rename(plan.MenuBackup, plan.MenuTarget)
		}
		restoreErr := restoreSnapshot(plan.Home, filepath.Join(plan.Home, ".macbox", "updates", plan.ID, "snapshot"))
		startErr := start()
		if restoreErr != nil || startErr != nil {
			err = fmt.Errorf("%v；配置恢复: %v；后台恢复: %v", err, restoreErr, startErr)
		}
		stateAt(plan, "failed", "rolled-back", "升级失败，已尝试恢复旧程序。\n请查看恢复结果。", err)
		return err
	}
	stateAt(plan, "succeeded", "completed", "版本切换完成，配置与应用数据已保留", nil)
	return nil
}

func restoreSnapshot(home, snapshot string) error {
	if err := copyTree(filepath.Join(snapshot, "config"), filepath.Join(home, ".macbox"), nil); err != nil {
		return err
	}
	definitions := filepath.Join(snapshot, "definitions")
	if _, err := os.Stat(definitions); err == nil {
		return copyTree(definitions, filepath.Join(home, "Library", "Application Support", "MacBox"), nil)
	}
	return nil
}

func waitHealthy(port int, version string, legacy bool) error {
	client := &http.Client{Timeout: 2 * time.Second}
	base := "http://" + net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	for i := 0; i < 90; i++ {
		response, err := client.Get(base + "/api/health")
		if err == nil {
			var info struct {
				Version string `json:"version"`
			}
			decodeErr := json.NewDecoder(response.Body).Decode(&info)
			response.Body.Close()
			if response.StatusCode == 200 && decodeErr == nil && info.Version == version {
				return nil
			}
		}
		if legacy {
			response, err := client.Get(base + "/api/auth/status")
			if err == nil {
				response.Body.Close()
				if response.StatusCode == 200 {
					return nil
				}
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("新后台未通过启动验证")
}
