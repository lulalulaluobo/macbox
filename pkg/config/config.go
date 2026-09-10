package config

import (
	"os"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Port    int           `yaml:"port"`
	VM      VMConfig      `yaml:"vm"`
	Storage StorageConfig `yaml:"storage"`
	Samba   SambaConfig   `yaml:"samba"`
	System  SystemConfig  `yaml:"system"`
}

type SystemConfig struct {
	PreventSleep bool `yaml:"preventSleep"` // 24h keep-awake with caffeinate
	AutoStart    bool `yaml:"autoStart"`    // macOS LaunchAgent autostart on boot
}

type VMConfig struct {
	Name         string `yaml:"name"`
	CPUs         int    `yaml:"cpus"`
	Memory       int    `yaml:"memory"`   // GiB
	DiskSize     int    `yaml:"diskSize"` // GiB rootfs
	DataDiskName string `yaml:"dataDiskName"`
}

type LocalMount struct {
	ID          string `json:"id" yaml:"id"`
	Name        string `json:"name" yaml:"name"`
	HostPath    string `json:"hostPath" yaml:"hostPath"`
	GuestTarget string `json:"guestTarget" yaml:"guestTarget"` // Target directory under /data
	Writable    bool   `json:"writable" yaml:"writable"`       // Read-only by default
	Enabled     bool   `json:"enabled" yaml:"enabled"`
	Category    string `json:"category" yaml:"category"`       // media, downloads, pictures, custom
	Description string `json:"description" yaml:"description"`
}

type StorageConfig struct {
	SelectedDisk string       `yaml:"selectedDisk"` // e.g. /dev/disk4
	MountPoint   string       `yaml:"mountPoint"`   // Host mount point if any
	DataPath     string       `yaml:"dataPath"`     // Host path holding data or managed disk
	LocalMounts  []LocalMount `yaml:"localMounts"`  // VirtioFS direct folder mounts from Mac
}

type SambaConfig struct {
	ShareName string `yaml:"shareName"`
	Port      int    `yaml:"port"`
	User      string `yaml:"user"`
	Password  string `yaml:"password"`
}

func DefaultConfig() *Config {
	return &Config{
		Port: 19808,
		VM: VMConfig{
			Name:         "macnas",
			CPUs:         2,
			Memory:       4,
			DiskSize:     20,
			DataDiskName: "macnas-data",
		},
		Storage: StorageConfig{
			SelectedDisk: "",
			MountPoint:   "",
			DataPath:     "",
		},
		Samba: SambaConfig{
			ShareName: "MacNAS",
			Port:      4455, // default non-conflicting host port on macOS
			User:      "macnas",
			Password:  "macnas123",
		},
		System: SystemConfig{
			PreventSleep: true, // Default enabled for Mac mini NAS server
			AutoStart:    false,
		},
	}
}

func ConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".macnas")
	if err := os.MkdirAll(dir, 0755); err != nil {
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

func LoadConfig() (*Config, error) {
	path, err := ConfigFilePath()
	if err != nil {
		return DefaultConfig(), err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			cfg := DefaultConfig()
			_ = SaveConfig(cfg)
			return cfg, nil
		}
		return DefaultConfig(), err
	}

	cfg := DefaultConfig()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return DefaultConfig(), err
	}
	if cfg.Port <= 0 {
		cfg.Port = 19808
	}
	if cfg.VM.Name == "" {
		cfg.VM.Name = "macnas"
	}
	if cfg.VM.CPUs <= 0 {
		cfg.VM.CPUs = 2
	}
	if cfg.VM.Memory <= 0 {
		cfg.VM.Memory = 4
	}
	if cfg.VM.DiskSize <= 0 {
		cfg.VM.DiskSize = 20
	}
	if cfg.VM.DataDiskName == "" {
		cfg.VM.DataDiskName = "macnas-data"
	}
	if cfg.Samba.Port <= 0 {
		cfg.Samba.Port = 4455
	}
	if cfg.Samba.ShareName == "" {
		cfg.Samba.ShareName = "MacNAS"
	}
	if cfg.Samba.User == "" {
		cfg.Samba.User = "macnas"
	}
	if cfg.Samba.Password == "" {
		cfg.Samba.Password = "macnas123"
	}
	return cfg, nil
}

func SaveConfig(cfg *Config) error {
	path, err := ConfigFilePath()
	if err != nil {
		return err
	}
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
