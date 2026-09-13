package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Port          int               `yaml:"port"`
	ListenAddress string            `yaml:"listenAddress"`
	VM            VMConfig          `yaml:"vm"`
	Storage       StorageConfig     `yaml:"storage"`
	Cloud         CloudConfig       `yaml:"cloud"`
	Terminal      TerminalConfig    `yaml:"terminal"`
	Samba         SambaConfig       `yaml:"samba"`
	System        SystemConfig      `yaml:"system"`
	ServiceNav    []ServiceShortcut `yaml:"serviceNav"`
}

type TerminalConfig struct {
	AISkillsEnabled  bool   `yaml:"aiSkillsEnabled"`
	AISkillsHostPath string `yaml:"aiSkillsHostPath"`
}

type SystemConfig struct {
	PreventSleep            bool `yaml:"preventSleep"`            // 24h keep-awake with caffeinate
	AutoStart               bool `yaml:"autoStart"`               // macOS LaunchAgent autostart on boot
	InitializationCompleted bool `yaml:"initializationCompleted"` // first-run VM/SSH bootstrap completed
}

// ServiceShortcut is a homepage link. Docker shortcuts carry container
// identity so the UI can show live status; manual shortcuts are deliberately
// independent from Docker and only open the configured URL.
type ServiceShortcut struct {
	ID            string `json:"id" yaml:"id"`
	Source        string `json:"source" yaml:"source"` // docker or manual
	ContainerID   string `json:"containerId,omitempty" yaml:"containerId,omitempty"`
	ContainerName string `json:"containerName,omitempty" yaml:"containerName,omitempty"`
	Name          string `json:"name" yaml:"name"`
	URL           string `json:"url" yaml:"url"`
	Icon          string `json:"icon" yaml:"icon"`
	Description   string `json:"description,omitempty" yaml:"description,omitempty"`
	Enabled       bool   `json:"enabled" yaml:"enabled"`
}

type VMConfig struct {
	Name           string `yaml:"name"`
	CPUs           int    `yaml:"cpus"`
	Memory         int    `yaml:"memory"`   // GiB
	DiskSize       int    `yaml:"diskSize"` // GiB rootfs
	DataDiskName   string `yaml:"dataDiskName"`
	ForwardedPorts []int  `yaml:"forwardedPorts"`
}

type LocalMount struct {
	ID          string `json:"id" yaml:"id"`
	Name        string `json:"name" yaml:"name"`
	HostPath    string `json:"hostPath" yaml:"hostPath"`
	GuestTarget string `json:"guestTarget" yaml:"guestTarget"` // Target directory under /data
	Writable    bool   `json:"writable" yaml:"writable"`       // Read-only by default
	Enabled     bool   `json:"enabled" yaml:"enabled"`
	Category    string `json:"category" yaml:"category"` // media, downloads, pictures, custom
	Description string `json:"description" yaml:"description"`
}

type StorageConfig struct {
	SelectedDisk   string       `yaml:"selectedDisk"`   // e.g. /dev/disk4 (Primary MacBox Data Disk)
	MountPoint     string       `yaml:"mountPoint"`     // Host mount point if any
	DataPath       string       `yaml:"dataPath"`       // Host path holding data or managed disk
	SecondaryDisk  string       `yaml:"secondaryDisk"`  // e.g. disk0 (Secondary / High-Speed SSD Pool)
	SecondaryMount string       `yaml:"secondaryMount"` // Host path on secondary disk
	LocalMounts    []LocalMount `yaml:"localMounts"`    // VirtioFS direct folder mounts from Mac
}

// CloudConfig stores remote-drive connections managed by the Web file
// manager. Credentials are kept in the mode-0600 MacBox config file and are
// never serialized through the JSON API.
type CloudConfig struct {
	Mounts []CloudMount `yaml:"mounts"`
}

type CloudMount struct {
	ID          string    `json:"id" yaml:"id"`
	Provider    string    `json:"provider" yaml:"provider"`
	Name        string    `json:"name" yaml:"name"`
	Cookie      string    `json:"-" yaml:"cookie"`
	RootFid     string    `json:"rootFid" yaml:"rootFid"`
	Account     string    `json:"account,omitempty" yaml:"account,omitempty"`
	Status      string    `json:"status" yaml:"status"`
	Message     string    `json:"message,omitempty" yaml:"message,omitempty"`
	LastChecked time.Time `json:"lastChecked,omitempty" yaml:"lastChecked,omitempty"`
}

type SMBShare struct {
	ID         string `json:"id" yaml:"id"`
	Name       string `json:"name" yaml:"name"`
	Path       string `json:"path" yaml:"path"`
	Comment    string `json:"comment" yaml:"comment"`
	Writable   bool   `json:"writable" yaml:"writable"`     // true = 读写, false = 只读
	GuestOk    bool   `json:"guestOk" yaml:"guestOk"`       // true = 允许访客免密
	Enabled    bool   `json:"enabled" yaml:"enabled"`       // true = 开启共享
	DiskSource string `json:"diskSource" yaml:"diskSource"` // "primary", "secondary", "passthrough", "custom"
}

type SambaConfig struct {
	ShareName string     `yaml:"shareName"`
	Port      int        `yaml:"port"`
	User      string     `yaml:"user"`
	Shares    []SMBShare `yaml:"shares"`
}

func DefaultConfig() *Config {
	return &Config{
		Port:          19808,
		ListenAddress: "127.0.0.1",
		VM: VMConfig{
			Name:         "macbox",
			CPUs:         2,
			Memory:       4,
			DiskSize:     20,
			DataDiskName: "macbox-data",
			// Only forward ports used by the built-in web applications. New
			// application ports are added explicitly during installation.
			ForwardedPorts: []int{5244, 8082, 8085},
		},
		Storage: StorageConfig{
			SelectedDisk: "",
			MountPoint:   "",
			DataPath:     "",
		},
		Cloud: CloudConfig{Mounts: []CloudMount{}},
		Samba: SambaConfig{
			ShareName: "MacBox",
			Port:      4455, // default non-conflicting host port on macOS
			User:      "macbox",
		},
		System: SystemConfig{
			PreventSleep: true, // Default enabled for the MacBox home server
			AutoStart:    false,
		},
		ServiceNav: []ServiceShortcut{},
	}
}

// NormalizeForwardedPorts removes duplicates and rejects invalid TCP ports
// before they reach the Lima configuration template.
func NormalizeForwardedPorts(ports []int) []int {
	seen := make(map[int]struct{}, len(ports))
	clean := make([]int, 0, len(ports))
	for _, port := range ports {
		if port < 1 || port > 65535 {
			continue
		}
		if _, exists := seen[port]; exists {
			continue
		}
		seen[port] = struct{}{}
		clean = append(clean, port)
	}
	sort.Ints(clean)
	return clean
}

const (
	minSambaPasswordBytes = 8
	maxSambaPasswordBytes = 256
)

var (
	dataDiskNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
	localMountIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
	cloudMountIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)
	vmNamePattern       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
	serviceNavIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$`)
)

// NormalizeDataDiskName validates the name that is interpolated into both
// Lima YAML and guest mount paths. Disk names are identifiers, not paths.
func NormalizeDataDiskName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "macbox-data", nil
	}
	if !dataDiskNamePattern.MatchString(name) {
		return "", fmt.Errorf("数据盘名称格式无效")
	}
	return name, nil
}

// NormalizeLocalMountID validates the identifier used in generated mount
// paths and API route parameters.
func NormalizeLocalMountID(id string) (string, error) {
	id = strings.TrimSpace(id)
	if !localMountIDPattern.MatchString(id) {
		return "", fmt.Errorf("本地挂载 ID 格式无效")
	}
	return id, nil
}

func NormalizeCloudMountID(id string) (string, error) {
	id = strings.TrimSpace(id)
	if !cloudMountIDPattern.MatchString(id) {
		return "", fmt.Errorf("云盘挂载 ID 格式无效")
	}
	return id, nil
}

func ValidateCloudMount(mount CloudMount) error {
	if _, err := NormalizeCloudMountID(mount.ID); err != nil {
		return err
	}
	if mount.Provider != "quark" {
		return fmt.Errorf("暂不支持云盘类型 %q", mount.Provider)
	}
	if strings.TrimSpace(mount.Name) == "" || len(mount.Name) > 128 || strings.IndexFunc(mount.Name, unicode.IsControl) >= 0 {
		return fmt.Errorf("云盘名称无效")
	}
	if strings.TrimSpace(mount.Cookie) == "" || len(mount.Cookie) > 16384 || strings.IndexFunc(mount.Cookie, unicode.IsControl) >= 0 {
		return fmt.Errorf("夸克登录 Cookie 无效")
	}
	return nil
}

// NormalizeVMName validates the identifier used in ~/.lima and limactl
// arguments. It must never be allowed to contain path separators.
func NormalizeVMName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "macbox", nil
	}
	if !vmNamePattern.MatchString(name) {
		return "", fmt.Errorf("虚拟机名称格式无效")
	}
	return name, nil
}

// NormalizeAISkillsHostPath validates a host directory that will be exposed
// to the Linux VM through Lima. It deliberately keeps the path absolute and
// does not resolve symlinks so a removable volume can be reattached later.
func NormalizeAISkillsHostPath(hostPath string) (string, error) {
	if strings.IndexFunc(hostPath, unicode.IsControl) >= 0 {
		return "", fmt.Errorf("AI Skill 目录必须是有效的本机绝对路径")
	}
	hostPath = strings.TrimSpace(hostPath)
	if hostPath == "" {
		return "", nil
	}
	if !filepath.IsAbs(hostPath) || len(hostPath) > 4096 {
		return "", fmt.Errorf("AI Skill 目录必须是有效的本机绝对路径")
	}
	clean := filepath.Clean(hostPath)
	if clean == string(filepath.Separator) {
		return "", fmt.Errorf("不能将本机根目录映射给 AI CLI")
	}
	return clean, nil
}

// NormalizeGuestTarget keeps a local mount target relative to /data. It is
// used at the API boundary and again while rendering VM configuration so a
// hand-edited config cannot escape the MacBox data root.
func NormalizeGuestTarget(target string) (string, error) {
	target = strings.TrimSpace(target)
	if target == "" {
		return "", fmt.Errorf("挂载目标不能为空")
	}
	if len(target) > 512 || strings.Contains(target, `\`) || strings.IndexFunc(target, unicode.IsControl) >= 0 {
		return "", fmt.Errorf("挂载目标包含非法字符")
	}
	for _, part := range strings.Split(target, "/") {
		if part == ".." {
			return "", fmt.Errorf("挂载目标不能包含 ..")
		}
	}

	target = strings.TrimPrefix(target, "/data/")
	if target == "/data" || target == "data" {
		return "", fmt.Errorf("挂载目标不能是 /data 根目录")
	}
	target = strings.TrimPrefix(target, "/")
	if strings.HasPrefix(target, "data/") {
		target = strings.TrimPrefix(target, "data/")
	}
	clean := path.Clean(target)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("挂载目标必须位于 /data 下")
	}
	return clean, nil
}

// ValidateLocalMount validates fields that are later embedded in the Lima
// template or the guest mount script. HostPath itself remains user-selectable;
// it is intentionally validated for shape here and for existence by storage.
func ValidateLocalMount(mount LocalMount) error {
	if _, err := NormalizeLocalMountID(mount.ID); err != nil {
		return err
	}
	if len(mount.Name) > 256 || strings.IndexFunc(mount.Name, unicode.IsControl) >= 0 {
		return fmt.Errorf("本地挂载名称包含非法字符")
	}
	if mount.HostPath == "" || !filepath.IsAbs(mount.HostPath) || len(mount.HostPath) > 4096 || strings.IndexFunc(mount.HostPath, unicode.IsControl) >= 0 {
		return fmt.Errorf("本地挂载路径无效")
	}
	_, err := NormalizeGuestTarget(mount.GuestTarget)
	return err
}

// ValidateSambaPassword validates the transient Web administrator password
// before it is sent directly to Samba. The original password is never written
// to config.yaml.
func ValidateSambaPassword(password string) error {
	if len([]byte(password)) < minSambaPasswordBytes {
		return fmt.Errorf("Samba 密码长度至少为 %d 个字节", minSambaPasswordBytes)
	}
	if len([]byte(password)) > maxSambaPasswordBytes || strings.IndexFunc(password, unicode.IsControl) >= 0 {
		return fmt.Errorf("Samba 密码长度不能超过 %d 个字节且不能包含控制字符", maxSambaPasswordBytes)
	}
	return nil
}

// ValidateSambaUsername validates the Web username when it is also used as
// the SMB client username. The value is written to Samba's username map, so
// separators and comment characters must not be allowed to reach that file.
func ValidateSambaUsername(username string) error {
	username = strings.TrimSpace(username)
	if len([]byte(username)) < 3 || len([]byte(username)) > 128 {
		return errors.New("SMB 用户名长度必须在 3 到 128 个字节之间")
	}
	if strings.IndexFunc(username, func(r rune) bool {
		return unicode.IsControl(r) || unicode.IsSpace(r)
	}) >= 0 {
		return errors.New("SMB 用户名不能包含空白或控制字符")
	}
	if strings.ContainsAny(username, "=#") {
		return errors.New("SMB 用户名不能包含 = 或 #")
	}
	return nil
}

// ValidateServiceShortcut protects the persisted homepage navigation from
// malformed links and control characters. URLs are opened by the browser;
// MacBox never fetches them server-side.
func ValidateServiceShortcut(shortcut ServiceShortcut) error {
	shortcut.ID = strings.TrimSpace(shortcut.ID)
	if !serviceNavIDPattern.MatchString(shortcut.ID) {
		return fmt.Errorf("服务导航 ID 无效")
	}
	shortcut.Source = strings.ToLower(strings.TrimSpace(shortcut.Source))
	if shortcut.Source != "docker" && shortcut.Source != "manual" {
		return fmt.Errorf("服务导航来源无效")
	}
	if strings.TrimSpace(shortcut.Name) == "" || len([]byte(shortcut.Name)) > 128 || strings.IndexFunc(shortcut.Name, unicode.IsControl) >= 0 {
		return fmt.Errorf("服务名称无效")
	}
	trimmedURL := strings.TrimSpace(shortcut.URL)
	if len([]byte(trimmedURL)) == 0 || len([]byte(trimmedURL)) > 2048 || strings.IndexFunc(trimmedURL, unicode.IsControl) >= 0 {
		return fmt.Errorf("服务访问地址无效")
	}
	parsed, err := url.Parse(trimmedURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
		return fmt.Errorf("服务访问地址必须是 http 或 https 地址")
	}
	if strings.TrimSpace(shortcut.Icon) == "" || len([]byte(shortcut.Icon)) > 64 || strings.IndexFunc(shortcut.Icon, unicode.IsControl) >= 0 {
		return fmt.Errorf("服务图标无效")
	}
	if len([]byte(shortcut.Description)) > 256 || strings.IndexFunc(shortcut.Description, unicode.IsControl) >= 0 {
		return fmt.Errorf("服务说明无效")
	}
	if shortcut.Source == "docker" && strings.TrimSpace(shortcut.ContainerID) == "" && strings.TrimSpace(shortcut.ContainerName) == "" {
		return fmt.Errorf("Docker 服务缺少容器标识")
	}
	if shortcut.Source == "manual" && (strings.TrimSpace(shortcut.ContainerID) != "" || strings.TrimSpace(shortcut.ContainerName) != "") {
		return fmt.Errorf("手动服务不能绑定 Docker 容器")
	}
	return nil
}

// NormalizeListenAddress accepts only literal IP addresses. Binding to
// loopback is the safe default; LAN exposure must be an explicit configuration
// choice such as 0.0.0.0 or a specific interface address.
func NormalizeListenAddress(address string) string {
	address = strings.TrimSpace(address)
	if address == "localhost" {
		return "127.0.0.1"
	}
	if net.ParseIP(address) != nil {
		return address
	}
	return "127.0.0.1"
}

func ConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".macbox")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	if err := os.Chmod(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}

func ConfigFilePath() (string, error) {
	dir, err := ConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.yaml"), nil
}

// Parse validates a serialized configuration without reading or writing the
// live configuration file. Backup restore uses this boundary before it
// replaces the running server's configuration.
func Parse(data []byte) (*Config, error) {
	cfg := DefaultConfig()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return DefaultConfig(), err
	}

	if cfg.Port < 1 || cfg.Port > 65535 {
		cfg.Port = 19808
	}
	cfg.ListenAddress = NormalizeListenAddress(cfg.ListenAddress)
	vmName, err := NormalizeVMName(cfg.VM.Name)
	if err != nil {
		return cfg, err
	}
	cfg.VM.Name = vmName
	if cfg.VM.CPUs <= 0 {
		cfg.VM.CPUs = 2
	}
	if cfg.VM.Memory <= 0 {
		cfg.VM.Memory = 4
	}
	if cfg.VM.DiskSize <= 0 {
		cfg.VM.DiskSize = 20
	}
	dataDiskName, err := NormalizeDataDiskName(cfg.VM.DataDiskName)
	if err != nil {
		return cfg, err
	}
	cfg.VM.DataDiskName = dataDiskName
	aiSkillsPath, err := NormalizeAISkillsHostPath(cfg.Terminal.AISkillsHostPath)
	if err != nil {
		return cfg, err
	}
	cfg.Terminal.AISkillsHostPath = aiSkillsPath
	if cfg.Terminal.AISkillsEnabled && aiSkillsPath == "" {
		return cfg, fmt.Errorf("AI Skill 映射已启用但未配置本机目录")
	}
	for i := range cfg.Storage.LocalMounts {
		target, err := NormalizeGuestTarget(cfg.Storage.LocalMounts[i].GuestTarget)
		if err != nil {
			return cfg, fmt.Errorf("本地挂载 %q 配置无效: %w", cfg.Storage.LocalMounts[i].ID, err)
		}
		cfg.Storage.LocalMounts[i].GuestTarget = target
		if err := ValidateLocalMount(cfg.Storage.LocalMounts[i]); err != nil {
			return cfg, fmt.Errorf("本地挂载 %q 配置无效: %w", cfg.Storage.LocalMounts[i].ID, err)
		}
	}
	for i := range cfg.Cloud.Mounts {
		mount := &cfg.Cloud.Mounts[i]
		if mount.RootFid == "" {
			mount.RootFid = "0"
		}
		if err := ValidateCloudMount(*mount); err != nil {
			return cfg, fmt.Errorf("云盘挂载 %q 配置无效: %w", mount.ID, err)
		}
	}
	seenServiceIDs := make(map[string]struct{}, len(cfg.ServiceNav))
	for i := range cfg.ServiceNav {
		shortcut := &cfg.ServiceNav[i]
		shortcut.ID = strings.TrimSpace(shortcut.ID)
		shortcut.Source = strings.ToLower(strings.TrimSpace(shortcut.Source))
		shortcut.Name = strings.TrimSpace(shortcut.Name)
		shortcut.URL = strings.TrimSpace(shortcut.URL)
		shortcut.Icon = strings.TrimSpace(shortcut.Icon)
		shortcut.Description = strings.TrimSpace(shortcut.Description)
		if _, exists := seenServiceIDs[shortcut.ID]; exists {
			return cfg, fmt.Errorf("服务导航 ID 重复: %s", shortcut.ID)
		}
		seenServiceIDs[shortcut.ID] = struct{}{}
		if err := ValidateServiceShortcut(*shortcut); err != nil {
			return cfg, fmt.Errorf("服务导航 %q 配置无效: %w", shortcut.ID, err)
		}
	}
	if cfg.VM.ForwardedPorts == nil {
		cfg.VM.ForwardedPorts = append([]int(nil), DefaultConfig().VM.ForwardedPorts...)
	}
	cfg.VM.ForwardedPorts = NormalizeForwardedPorts(cfg.VM.ForwardedPorts)
	if cfg.Samba.Port < 1 || cfg.Samba.Port > 65535 {
		cfg.Samba.Port = 4455
	}
	if cfg.Samba.ShareName == "" {
		cfg.Samba.ShareName = "MacBox"
	}
	if cfg.Samba.User == "" {
		cfg.Samba.User = "macbox"
	}
	return cfg, nil
}

func LoadConfig() (*Config, error) {
	path, err := ConfigFilePath()
	if err != nil {
		return DefaultConfig(), err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			cfg := DefaultConfig()
			if err := SaveConfig(cfg); err != nil {
				return cfg, fmt.Errorf("保存初始配置失败: %w", err)
			}
			return cfg, nil
		}
		return DefaultConfig(), err
	}
	if err := os.Chmod(path, 0600); err != nil {
		return DefaultConfig(), fmt.Errorf("保护配置文件失败: %w", err)
	}

	// Releases before 2026-09-12 stored the SMB password in plaintext. Read
	// only enough of the old shape to detect and remove that field on load.
	var legacy struct {
		Samba struct {
			Password string `yaml:"password"`
		} `yaml:"samba"`
	}
	legacyPasswordPresent := yaml.Unmarshal(data, &legacy) == nil && legacy.Samba.Password != ""

	cfg, err := Parse(data)
	if err != nil {
		return cfg, err
	}
	if legacyPasswordPresent {
		if err := SaveConfig(cfg); err != nil {
			return cfg, fmt.Errorf("移除旧版明文 Samba 密码失败: %w", err)
		}
	}
	return cfg, nil
}

var configMu sync.Mutex

func SaveConfig(cfg *Config) error {
	if cfg == nil {
		return errors.New("配置不能为空")
	}
	configMu.Lock()
	defer configMu.Unlock()
	return saveConfigLocked(cfg)
}

// Update applies a configuration mutation and persists it as one serialized
// transaction. The in-memory value is restored when validation, serialization,
// or the atomic file replacement fails, so concurrent domain managers cannot
// overwrite one another with a partially saved configuration.
func Update(cfg *Config, mutate func(*Config) error) error {
	if cfg == nil {
		return errors.New("配置不能为空")
	}
	if mutate == nil {
		return errors.New("配置更新函数不能为空")
	}

	configMu.Lock()
	defer configMu.Unlock()

	before, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	restore := func() error {
		var snapshot Config
		if err := yaml.Unmarshal(before, &snapshot); err != nil {
			return err
		}
		*cfg = snapshot
		return nil
	}

	if err := mutate(cfg); err != nil {
		if restoreErr := restore(); restoreErr != nil {
			return fmt.Errorf("配置更新失败: %v；回滚内存配置失败: %w", err, restoreErr)
		}
		return err
	}
	if err := saveConfigLocked(cfg); err != nil {
		if restoreErr := restore(); restoreErr != nil {
			return fmt.Errorf("保存配置失败: %v；回滚内存配置失败: %w", err, restoreErr)
		}
		return err
	}
	return nil
}

// Snapshot returns a deep, serialized copy of the configuration. Domain
// managers use it for read-heavy work so a concurrent Update cannot expose a
// partially mutated slice or nested value.
func Snapshot(cfg *Config) (*Config, error) {
	if cfg == nil {
		return nil, errors.New("配置不能为空")
	}
	configMu.Lock()
	defer configMu.Unlock()

	data, err := yaml.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	var snapshot Config
	if err := yaml.Unmarshal(data, &snapshot); err != nil {
		return nil, err
	}
	return &snapshot, nil
}

func saveConfigLocked(cfg *Config) error {

	path, err := ConfigFilePath()
	if err != nil {
		return err
	}
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}

	tmpFile, err := os.CreateTemp(filepath.Dir(path), ".config.yaml-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if err := tmpFile.Chmod(0600); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	return os.Chmod(path, 0600)
}
