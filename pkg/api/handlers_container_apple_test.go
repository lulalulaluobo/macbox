package api

import (
	"encoding/json"
	"testing"

	"github.com/lulalulaluobo/macbox/pkg/containerapple"
)

func TestConvertAppleContainer(t *testing.T) {
	raw := []byte(`{
		"id": "open-notebook-surrealdb",
		"configuration": {
			"id": "open-notebook-surrealdb",
			"creationDate": "2026-07-17T15:31:36Z",
			"labels": {"com.icontainu.compose.project": "open-notebook", "com.icontainu.compose.service": "surrealdb"},
			"image": {"reference": "docker.io/surrealdb/surrealdb:v2"}
		},
		"status": {"state": "stopped", "networks": []}
	}`)
	var c containerapple.Container
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	info := convertAppleContainer(c)
	if info.ID != "open-notebook-surrealdb" || info.State != "stopped" {
		t.Fatalf("unexpected %+v", info)
	}
	if info.Project != "open-notebook" {
		t.Fatalf("project = %q", info.Project)
	}
	if info.Image != "docker.io/surrealdb/surrealdb:v2" {
		t.Fatalf("image = %q", info.Image)
	}
}

func TestConvertAppleContainerMissingFields(t *testing.T) {
	var c containerapple.Container
	c.ID = "lonely"
	info := convertAppleContainer(c)
	if info.State != "unknown" || info.Image != "<none>" || info.Project != "" {
		t.Fatalf("unexpected %+v", info)
	}
}

func TestSplitAppleImageName(t *testing.T) {
	cases := []struct{ name, repo, tag string }{
		{"docker.io/lfnovo/open_notebook:v1-latest", "docker.io/lfnovo/open_notebook", "v1-latest"},
		{"ghcr.io/foo/bar", "ghcr.io/foo/bar", "latest"},
		{"localhost:5000/app:2", "localhost:5000/app", "2"},
		{"", "<none>", "<none>"},
	}
	for _, tc := range cases {
		repo, tag := splitAppleImageName(tc.name)
		if repo != tc.repo || tag != tc.tag {
			t.Errorf("splitAppleImageName(%q) = %q,%q want %q,%q", tc.name, repo, tag, tc.repo, tc.tag)
		}
	}
}

func TestAppleContainerIDPattern(t *testing.T) {
	for _, id := range []string{"open-notebook-open_notebook", "mcp.inspector1"} {
		if !appleContainerIDPattern.MatchString(id) {
			t.Errorf("rejects valid id %q", id)
		}
	}
	for _, id := range []string{"", "-rf", "bad id", "$(reboot)", "a/b"} {
		if appleContainerIDPattern.MatchString(id) {
			t.Errorf("accepts invalid id %q", id)
		}
	}
}
