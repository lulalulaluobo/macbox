package vm

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/luluen/mac-nas/pkg/config"
)

func TestGenerateConfigFile(t *testing.T) {
	// GenerateConfigFile mirrors an existing ~/.lima/<instance>/lima.yaml.
	// Isolate HOME so validation never overwrites a real VM config.
	testHome, err := os.MkdirTemp("/tmp", "macnas-home-")
	if err != nil {
		t.Fatalf("create short temporary home: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(testHome) })
	t.Setenv("HOME", testHome)

	cfg := config.DefaultConfig()
	mgr := NewManager(cfg)

	tmplPath := filepath.Join("..", "..", "templates", "vm", "macnas.yaml.tmpl")
	// Lima's hostSocket validation has a 104-character limit. Keep the
	// temporary render path short enough for the template's socket path.
	tmpDir, err := os.MkdirTemp("/tmp", "macnas-")
	if err != nil {
		t.Fatalf("create short temporary directory: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(tmpDir) })
	outputPath := filepath.Join(tmpDir, "test-macnas.yaml")

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

	if os.Getenv("MACNAS_INTEGRATION") != "1" {
		t.Skip("limactl validation is an integration test; set MACNAS_INTEGRATION=1 to run it")
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
	tmplPath := filepath.Join("..", "..", "templates", "vm", "macnas.yaml.tmpl")
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
