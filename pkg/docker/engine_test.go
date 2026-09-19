package docker

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTranslateBindPathsOnlyRewritesHostSide(t *testing.T) {
	hostRoot := "/Users/tester/MacBox/data"
	content := strings.Join([]string{
		`services:`,
		`  alist:`,
		`    volumes:`,
		`      - /data/appdata/alist/data:/opt/alist/data`,
		`      - "/data/appdata/vaultwarden/data:/data"`,
		`      - '/data/media:/music:ro'`,
		`      - "/data/appdata/filebrowser/database.db:/database/filebrowser.db"`,
		`    environment:`,
		`      - DOCKGE_STACKS_DIR=/data/appdata`,
		`      - TOKEN=/proc/1/data/not-a-mount`,
	}, "\n")

	got := TranslateBindPaths(content, hostRoot)
	checks := map[string]bool{
		hostRoot + "/appdata/alist/data:/opt/alist/data":                       true,
		`"` + hostRoot + `/appdata/vaultwarden/data:/data"`:                    true,
		`'` + hostRoot + `/media:/music:ro'`:                                   true,
		hostRoot + "/appdata/filebrowser/database.db:/database/filebrowser.db": true,
		"DOCKGE_STACKS_DIR=" + hostRoot + "/appdata":                           true,
	}
	for want, exists := range checks {
		if contains := strings.Contains(got, want); contains != exists {
			t.Fatalf("translated YAML contains %q = %v, want %v:\n%s", want, contains, exists, got)
		}
	}
	// Container-side paths must be untouched: the vaultwarden mount keeps its
	// literal /data target.
	if !strings.Contains(got, "/vaultwarden/data:/data") {
		t.Fatalf("container-side /data target was rewritten:\n%s", got)
	}
	// Paths embedded mid-token are not mount sources.
	if !strings.Contains(got, "TOKEN=/proc/1/data/not-a-mount") {
		t.Fatalf("non-mount token was rewritten:\n%s", got)
	}
}

func TestHostComposeConfigPaths(t *testing.T) {
	root := filepath.Join(t.TempDir(), "compose")
	if err := os.MkdirAll(filepath.Join(root, "demo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "legacy"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "demo", "compose.yaml"), []byte("services: {}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "legacy", "docker-compose.yml"), []byte("services: {}"), 0o600); err != nil {
		t.Fatal(err)
	}

	got := hostComposeConfigPaths(root)
	want := []string{
		filepath.Join(root, "demo", "compose.yaml"),
		filepath.Join(root, "legacy", "docker-compose.yml"),
	}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("hostComposeConfigPaths() = %v, want %v", got, want)
	}
	if none := hostComposeConfigPaths(filepath.Join(root, "missing")); none != nil {
		t.Fatalf("missing root should return nil, got %v", none)
	}
}

func TestComposeProjectDeleteTargetsInHostRoot(t *testing.T) {
	root := "/Users/tester/MacBox/data/appdata/compose"
	filePath := root + "/demo/compose.yaml"
	targets, err := composeProjectDeleteTargetsIn(root, filePath)
	if err != nil {
		t.Fatalf("host project delete failed: %v", err)
	}
	if len(targets) != 2 || targets[0] != root+"/demo/compose.yaml" {
		t.Fatalf("unexpected targets: %v", targets)
	}
	if _, err := composeProjectDeleteTargetsIn(root, "/Users/tester/MacBox/data/appdata/alist/compose.yaml"); err == nil {
		t.Fatal("system app files must stay protected")
	}
}

func TestComposeCLIFromContext(t *testing.T) {
	c := NewClient(nil)

	plain := context.Background()
	if _, ok := composeCLIFromContext(plain); ok {
		t.Fatal("plain context must not carry a compose CLI override")
	}
	if c.ComposeOnHost(plain) {
		t.Fatal("ComposeOnHost should be false without an override (probe path excluded)")
	}

	ctx := WithComposeCLI(plain, "/opt/homebrew/bin/mocker")
	cli, ok := composeCLIFromContext(ctx)
	if !ok || cli != "/opt/homebrew/bin/mocker" {
		t.Fatalf("override lost: cli=%q ok=%v", cli, ok)
	}
	if !c.ComposeOnHost(ctx) {
		t.Fatal("ComposeOnHost must be true under the override")
	}
	// Host semantics must apply without probing real engines.
	if !c.HostEngineActive(ctx) {
		t.Fatal("HostEngineActive must be true under the override")
	}
	if got, want := c.AppDataRoot(ctx), filepath.Join(HostDataDir(), "appdata"); got != want {
		t.Fatalf("AppDataRoot() = %q, want %q", got, want)
	}
	if got, want := c.DataRoot(ctx), HostDataDir(); got != want {
		t.Fatalf("DataRoot() = %q, want %q", got, want)
	}
	if got, want := c.ComposeProjectsRoot(ctx), filepath.Join(HostDataDir(), "appdata", "compose"); got != want {
		t.Fatalf("ComposeProjectsRoot() = %q, want %q", got, want)
	}
}

func TestTranslateComposeForEngineUnderMockerKeepsDockerSock(t *testing.T) {
	c := NewClient(nil)
	ctx := WithComposeCLI(context.Background(), "/opt/homebrew/bin/mocker")
	content := strings.Join([]string{
		`services:`,
		`  dockersock:`,
		`    volumes:`,
		`      - /var/run/docker.sock:/var/run/docker.sock`,
		`      - /data/appdata/demo:/data/demo`,
	}, "\n")

	got := c.TranslateComposeForEngine(ctx, content)
	if !strings.Contains(got, "- /var/run/docker.sock:/var/run/docker.sock") {
		t.Fatalf("docker.sock mount must stay untouched under mocker:\n%s", got)
	}
	if want := filepath.Join(HostDataDir(), "appdata", "demo") + ":/data/demo"; !strings.Contains(got, want) {
		t.Fatalf("bind source not translated to host data root, want %q:\n%s", want, got)
	}
}

func TestComposeStatusFromContainers(t *testing.T) {
	cases := []struct {
		states []string
		want   string
	}{
		{nil, "stopped"},
		{[]string{"exited", "created"}, "stopped"},
		{[]string{"running", "running"}, "running"},
		{[]string{"running", "exited"}, "partially_running"},
	}
	for _, tc := range cases {
		if got := composeStatusFromContainers(tc.states); got != tc.want {
			t.Fatalf("composeStatusFromContainers(%v) = %q, want %q", tc.states, got, tc.want)
		}
	}
}
