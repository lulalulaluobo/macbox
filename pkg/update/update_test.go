package update

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fixtureTransport func(*http.Request) (*http.Response, error)

func (f fixtureTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestDownloadVerifiesChecksumBeforeActivation(t *testing.T) {
	for _, tampered := range []bool{false, true} {
		payload := "official-package"
		digest := sha256.Sum256([]byte(payload))
		if tampered {
			payload = "modified-package"
		}
		client := &http.Client{Transport: fixtureTransport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(payload))}, nil
		})}
		destination := filepath.Join(t.TempDir(), "package")
		release := &Release{Digest: hex.EncodeToString(digest[:]), DownloadURL: "https://github.com/lulalulaluobo/macbox/releases/download/v0.1.3/package"}
		err := downloadWithClient(context.Background(), client, release, destination)
		if (err != nil) != tampered {
			t.Fatalf("tampered %v: %v", tampered, err)
		}
		if tampered {
			if _, err := os.Stat(destination); !os.IsNotExist(err) {
				t.Fatal("corrupt package retained")
			}
		}
	}
}

func TestVersionOrdering(t *testing.T) {
	for _, pair := range [][2]string{{"0.1.9", "0.1.10"}, {"0.1.3-rc.9", "0.1.3-rc.10"}, {"0.1.3-rc.1", "0.1.3"}, {"0.1.3", "0.2.0"}} {
		if Compare(pair[0], pair[1]) != -1 || Compare(pair[1], pair[0]) != 1 {
			t.Fatalf("invalid version order: %v", pair)
		}
	}
	if Compare("0.1.3+local", "0.1.3") != 0 {
		t.Fatal("build metadata changes ordering")
	}
}

// 可选的官方源连通性检查；常规测试不依赖外网。
func TestOfficialReleaseCatalog(t *testing.T) {
	if os.Getenv("MACBOX_INTEGRATION") != "1" {
		t.Skip("set MACBOX_INTEGRATION=1 to check the official release API")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	release, err := Check(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if release.Asset == "" || !strings.HasPrefix(release.DownloadURL, "https://github.com/lulalulaluobo/macbox/releases/download/") {
		t.Fatal("missing official platform package")
	}
	if len(release.Digest) != 64 && release.ChecksumURL == "" {
		t.Fatal("missing release checksum")
	}
	t.Logf("official stable version: %s; asset: %s", release.Version, release.Asset)
}

func TestDownloadSources(t *testing.T) {
	for _, raw := range []string{"http://github.com/file", "https://github.com.evil.test/file", "https://user@github.com/file", "https://github.com:443/file", "https://127.0.0.1/file"} {
		if allowedDownloadURL(raw) {
			t.Fatalf("accepted unsafe source %s", raw)
		}
	}
	if !allowedDownloadURL("https://release-assets.githubusercontent.com/file") {
		t.Fatal("release asset redirect rejected")
	}
}

func TestRuntimeActivationRetainsDataAndRestoresFailure(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "failure"}[fail], func(t *testing.T) {
			dir := t.TempDir()
			root, stage, backup := filepath.Join(dir, "runtime"), filepath.Join(dir, "stage"), filepath.Join(dir, "previous")
			for path, value := range map[string]string{root: "old", stage: "new", filepath.Join(dir, "data"): "user-data"} {
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(path, "value"), []byte(value), 0600); err != nil {
					t.Fatal(err)
				}
			}
			err := activateRuntime(stage, root, backup, func() error {
				data, _ := os.ReadFile(filepath.Join(root, "value"))
				if string(data) != "new" {
					t.Fatal("new program not activated")
				}
				if fail {
					return errors.New("startup failed")
				}
				return nil
			})
			if (err != nil) != fail {
				t.Fatalf("unexpected result: %v", err)
			}
			want := "new"
			if fail {
				want = "old"
			}
			data, _ := os.ReadFile(filepath.Join(root, "value"))
			if string(data) != want {
				t.Fatalf("runtime = %s", data)
			}
			data, _ = os.ReadFile(filepath.Join(dir, "data", "value"))
			if string(data) != "user-data" {
				t.Fatal("user data changed")
			}
			if !fail {
				data, _ = os.ReadFile(filepath.Join(backup, "value"))
				if string(data) != "old" {
					t.Fatal("old runtime not retained")
				}
			}
		})
	}
}

func TestArchiveRejectsTraversalAndLinks(t *testing.T) {
	for _, header := range []*tar.Header{{Name: "../escape", Typeflag: tar.TypeReg, Mode: 0644}, {Name: "/absolute", Typeflag: tar.TypeReg, Mode: 0644}, {Name: "link", Typeflag: tar.TypeSymlink, Linkname: "../../escape"}} {
		t.Run(header.Name, func(t *testing.T) {
			dir := t.TempDir()
			archive := filepath.Join(dir, "release.tar.gz")
			file, err := os.Create(archive)
			if err != nil {
				t.Fatal(err)
			}
			gz := gzip.NewWriter(file)
			writer := tar.NewWriter(gz)
			if err := writer.WriteHeader(header); err != nil {
				t.Fatal(err)
			}
			writer.Close()
			gz.Close()
			file.Close()
			if err := extractTar(archive, filepath.Join(dir, "target")); err == nil {
				t.Fatal("unsafe archive accepted")
			}
		})
	}
}
