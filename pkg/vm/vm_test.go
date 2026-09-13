package vm

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lulalulaluobo/macbox/pkg/config"
)

func TestGenerateConfigFile(t *testing.T) {
	// GenerateConfigFile mirrors an existing ~/.lima/<instance>/lima.yaml.
	// Isolate HOME so validation never overwrites a real VM config.
	testHome, err := os.MkdirTemp("/tmp", "macbox-home-")
	if err != nil {
		t.Fatalf("create short temporary home: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(testHome) })
	t.Setenv("HOME", testHome)

	cfg := config.DefaultConfig()
	mgr := NewManager(cfg)

	tmplPath := filepath.Join("..", "..", "templates", "vm", "macbox.yaml.tmpl")
	// Lima's hostSocket validation has a 104-character limit. Keep the
	// temporary render path short enough for the template's socket path.
	tmpDir, err := os.MkdirTemp("/tmp", "macbox-")
	if err != nil {
		t.Fatalf("create short temporary directory: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(tmpDir) })
	outputPath := filepath.Join(tmpDir, "test-macbox.yaml")

	err = mgr.GenerateConfigFile(tmplPath, outputPath)
	if err != nil {
		t.Fatalf("GenerateConfigFile error: %v", err)
	}

	content, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("read rendered yaml error: %v", err)
	}
	if strings.Contains(string(content), "guestPortRange") || strings.Contains(string(content), "hostPortRange") {
		t.Fatal("rendered VM config must not expose a broad port range")
	}
	if !strings.Contains(string(content), "guestPort: 5244") {
		t.Fatal("rendered VM config is missing the default Alist port forward")
	}
	if !strings.Contains(string(content), "name: macboxctl") || strings.Contains(string(content), os.Getenv("USER")+".guest") {
		t.Fatal("rendered VM config must use the fixed internal Lima management user")
	}
	if !strings.Contains(string(content), "usermod -aG \"$group\" macboxctl") {
		t.Fatal("rendered VM config must grant the management user Docker and MacBox data access")
	}
	if strings.Contains(string(content), "After=cloud-init.target cloud-final.service") || strings.Contains(string(content), "Wants=cloud-final.service") {
		t.Fatal("rendered VM config must not create a cloud-init/multi-user boot dependency cycle")
	}

	if os.Getenv("MACBOX_INTEGRATION") != "1" {
		t.Skip("limactl validation is an integration test; set MACBOX_INTEGRATION=1 to run it")
	}

	cmd := exec.Command("limactl", "validate", outputPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("limactl validate error: %s (%v)", string(out), err)
	}
}

func TestGenerateConfigRejectsUnsafeTemplateValues(t *testing.T) {
	testHome := t.TempDir()
	t.Setenv("HOME", testHome)
	tmplPath := filepath.Join("..", "..", "templates", "vm", "macbox.yaml.tmpl")
	outputPath := filepath.Join(t.TempDir(), "unsafe.yaml")

	cfg := config.DefaultConfig()
	cfg.VM.DataDiskName = "../../etc"
	if err := NewManager(cfg).GenerateConfigFile(tmplPath, outputPath); err == nil {
		t.Fatal("GenerateConfigFile accepted an unsafe data disk name")
	}

	cfg = config.DefaultConfig()
	cfg.Storage.LocalMounts = []config.LocalMount{{
		ID:          "unsafe",
		Name:        "Unsafe",
		HostPath:    t.TempDir(),
		GuestTarget: "../../etc",
	}}
	if err := NewManager(cfg).GenerateConfigFile(tmplPath, outputPath); err == nil {
		t.Fatal("GenerateConfigFile accepted an unsafe guest mount target")
	}
}

func TestGenerateConfigUsesRaceSafeLocalMountScript(t *testing.T) {
	testHome := t.TempDir()
	t.Setenv("HOME", testHome)
	tmplPath := filepath.Join("..", "..", "templates", "vm", "macbox.yaml.tmpl")
	outputPath := filepath.Join(t.TempDir(), "local-mount.yaml")

	cfg := config.DefaultConfig()
	cfg.Storage.LocalMounts = []config.LocalMount{{
		ID:          "downloads",
		Name:        "Downloads",
		HostPath:    filepath.Join(testHome, "Downloads"),
		GuestTarget: "downloads/MacDownloads",
		Enabled:     true,
	}}
	if err := NewManager(cfg).GenerateConfigFile(tmplPath, outputPath); err != nil {
		t.Fatalf("GenerateConfigFile error: %v", err)
	}

	content, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("read rendered yaml error: %v", err)
	}
	rendered := string(content)
	t.Logf("rendered mounts: %s", rendered[strings.Index(rendered, "mountType:"):strings.Index(rendered, "containerd:")])
	for _, expected := range []string{
		"mountpoint -q \"$SOURCE_PATH\"",
		"umount \"$TARGET_DIR\"",
		"mount --bind \"$SOURCE_PATH\" \"$TARGET_DIR\"",
	} {
		if !strings.Contains(rendered, expected) {
			t.Errorf("rendered VM config is missing race-safe mount step %q", expected)
		}
	}
}

func TestGenerateConfigIncludesAISkillsMapping(t *testing.T) {
	testHome := t.TempDir()
	t.Setenv("HOME", testHome)
	tmplPath := filepath.Join("..", "..", "templates", "vm", "macbox.yaml.tmpl")
	outputPath := filepath.Join(t.TempDir(), "ai-skills.yaml")
	skillsPath := filepath.Join(testHome, ".agents", "skills")
	if err := os.MkdirAll(skillsPath, 0700); err != nil {
		t.Fatalf("create skills directory: %v", err)
	}

	cfg := config.DefaultConfig()
	cfg.Terminal.AISkillsEnabled = true
	cfg.Terminal.AISkillsHostPath = skillsPath
	if err := NewManager(cfg).GenerateConfigFile(tmplPath, outputPath); err != nil {
		t.Fatalf("GenerateConfigFile error: %v", err)
	}

	content, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("read rendered yaml error: %v", err)
	}
	rendered := string(content)
	if !strings.Contains(rendered, `mountPoint: "/mnt/macbox-ai-skills"`) {
		t.Fatal("rendered VM config is missing the AI skills mount point")
	}
	if !strings.Contains(rendered, skillsPath) {
		t.Fatal("rendered VM config is missing the selected AI skills host path")
	}
	if !strings.Contains(rendered, "/home/macboxctl/.agents") || !strings.Contains(rendered, "/root/.agents") {
		t.Fatal("rendered VM config is missing the per-user AI skills directories")
	}
}

func TestValidateDataDiskContext(t *testing.T) {
	testHome := t.TempDir()
	t.Setenv("HOME", testHome)
	mgr := NewManager(config.DefaultConfig())

	// A brand-new instance is allowed to have no data disk yet; Start creates it.
	if err := mgr.ValidateDataDiskContext(nil); err != nil {
		t.Fatalf("new instance should not require a data disk: %v", err)
	}

	instanceDir := filepath.Join(testHome, ".lima", "macbox")
	diskDir := filepath.Join(testHome, ".lima", "_disks", "macbox-data")
	if err := os.MkdirAll(diskDir, 0700); err != nil {
		t.Fatalf("create fake Lima directories: %v", err)
	}
	if err := os.MkdirAll(instanceDir, 0700); err != nil {
		t.Fatalf("create fake instance directory: %v", err)
	}

	diskPath := filepath.Join(diskDir, "datadisk")
	if err := os.Symlink(filepath.Join(testHome, "missing.img"), diskPath); err != nil {
		t.Fatalf("create broken data disk link: %v", err)
	}
	if err := mgr.ValidateDataDiskContext(nil); err == nil || !strings.Contains(err.Error(), "外接数据盘镜像不存在") {
		t.Fatalf("broken data disk should return an actionable error, got: %v", err)
	}

	if err := os.Remove(diskPath); err != nil {
		t.Fatalf("remove broken data disk link: %v", err)
	}
	if err := os.WriteFile(diskPath, []byte("test"), 0600); err != nil {
		t.Fatalf("create regular data disk: %v", err)
	}
	if err := mgr.ValidateDataDiskContext(nil); err != nil {
		t.Fatalf("regular data disk should be accepted: %v", err)
	}
}

func TestVMActionsAreSerialized(t *testing.T) {
	mgr := NewManager(config.DefaultConfig())
	if !mgr.BeginVMAction("starting") {
		t.Fatal("first VM action should acquire the reservation")
	}
	if mgr.BeginVMAction("restarting") {
		t.Fatal("a second VM action must be rejected while the first is active")
	}
	if got := mgr.GetVMAction(); got != "starting" {
		t.Fatalf("active VM action = %q, want starting", got)
	}
	mgr.EndVMAction()
	if mgr.GetVMAction() != "" {
		t.Fatal("ending a VM action should release the reservation")
	}
	if !mgr.BeginVMAction("stopping") {
		t.Fatal("a new VM action should be accepted after release")
	}
	mgr.EndVMAction()
}

func TestCappedCommandOutput(t *testing.T) {
	var output cappedCommandOutput
	input := bytes.Repeat([]byte("x"), maxVMCommandOutputBytes+1)
	if n, err := output.Write(input); err != nil || n != len(input) {
		t.Fatalf("capped output write = (%d, %v), want (%d, nil)", n, err, len(input))
	}
	result := output.String()
	if len(result) <= maxVMCommandOutputBytes || !strings.Contains(result, "命令输出已截断") {
		t.Fatalf("capped output did not include bounded diagnostic marker: len=%d", len(result))
	}
	if strings.Count(result, "命令输出已截断") != 1 {
		t.Fatalf("capped output marker should appear once: %q", result[len(result)-100:])
	}
}
