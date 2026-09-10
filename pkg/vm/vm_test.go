package vm

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/luluen/mac-nas/pkg/config"
)

func TestGenerateConfigFile(t *testing.T) {
	cfg := config.DefaultConfig()
	mgr := NewManager(cfg)

	tmplPath := filepath.Join("..", "..", "templates", "vm", "macnas.yaml.tmpl")
	outputPath := filepath.Join(os.TempDir(), "test-macnas.yaml")

	err := mgr.GenerateConfigFile(tmplPath, outputPath)
	if err != nil {
		t.Fatalf("GenerateConfigFile error: %v", err)
	}

	content, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("read rendered yaml error: %v", err)
	}
	t.Logf("Rendered YAML:\n%s", string(content))

	cmd := exec.Command("limactl", "validate", outputPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("limactl validate error: %s (%v)", string(out), err)
	}
	t.Logf("Validation output: %s", string(out))
}
