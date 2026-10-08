package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/buildinfo"
)

const releaseAPI = "https://api.github.com/repos/lulalulaluobo/macbox/releases/latest"
const maxDownloadBytes = 512 << 20

type Release struct {
	Version     string `json:"version"`
	Notes       string `json:"notes"`
	URL         string `json:"url"`
	PublishedAt string `json:"publishedAt"`
	Available   bool   `json:"available"`
	Asset       string `json:"asset"`
	DownloadURL string `json:"-"`
	ChecksumURL string `json:"-"`
	Digest      string `json:"-"`
}

type VersionInfo struct {
	Version string `json:"version"`
	Commit  string `json:"commit"`
	BuiltAt string `json:"builtAt"`
	Arch    string `json:"arch"`
	Managed bool   `json:"managed"`
	Message string `json:"message"`
}

func Info() VersionInfo {
	info := VersionInfo{Version: buildinfo.Version, Commit: buildinfo.Commit, BuiltAt: buildinfo.BuiltAt, Arch: runtime.GOARCH}
	exe, _ := os.Executable()
	home, _ := os.UserHomeDir()
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	info.Managed = runtime.GOOS == "darwin" && exe == home+"/.local/share/macbox/bin/macbox"
	if info.Managed {
		info.Message = "升级保留账号、设置、应用和文件"
	} else {
		info.Message = "请先安装发行包，再使用在线升级"
	}
	return info
}

func releaseClient() *http.Client {
	return &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 8 || !allowedDownloadURL(req.URL.String()) {
			return fmt.Errorf("更新下载重定向地址不受支持")
		}
		return nil
	}}
}

func allowedDownloadURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return false
	}
	switch u.Hostname() {
	case "api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com":
		return true
	}
	return false
}

func get(ctx context.Context, client *http.Client, raw string) (*http.Response, error) {
	if !allowedDownloadURL(raw) {
		return nil, fmt.Errorf("更新来源不是官方 GitHub 发行地址")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", raw, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "MacBox/"+buildinfo.Version)
	req.Header.Set("Accept", "application/vnd.github+json")
	response, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, fmt.Errorf("更新服务器返回 %d，请稍后重试", response.StatusCode)
	}
	return response, nil
}

func Check(ctx context.Context) (*Release, error) {
	response, err := get(ctx, releaseClient(), releaseAPI)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	var doc struct {
		Tag         string `json:"tag_name"`
		Notes       string `json:"body"`
		URL         string `json:"html_url"`
		PublishedAt string `json:"published_at"`
		Draft       bool   `json:"draft"`
		Prerelease  bool   `json:"prerelease"`
		Assets      []struct {
			Name   string `json:"name"`
			URL    string `json:"browser_download_url"`
			Digest string `json:"digest"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&doc); err != nil {
		return nil, err
	}
	version := strings.TrimPrefix(doc.Tag, "v")
	if _, err := versionParts(version); err != nil || doc.Draft || doc.Prerelease {
		return nil, fmt.Errorf("没有可用的稳定发行版本")
	}
	release := &Release{Version: version, Notes: doc.Notes, URL: doc.URL, PublishedAt: doc.PublishedAt}
	arch := "aarch64"
	if runtime.GOARCH == "amd64" {
		arch = "x86_64"
	}
	prefix := "MacBox_" + version + "_macos_" + arch
	for _, suffix := range []string{".tar.gz", ".dmg"} {
		for _, asset := range doc.Assets {
			if asset.Name == prefix+suffix && strings.HasPrefix(asset.URL, "https://github.com/lulalulaluobo/macbox/releases/download/") {
				release.Asset, release.DownloadURL, release.Digest = asset.Name, asset.URL, strings.TrimPrefix(asset.Digest, "sha256:")
			}
		}
		if release.Asset != "" {
			break
		}
	}
	for _, asset := range doc.Assets {
		if asset.Name == release.Asset+".sha256" {
			release.ChecksumURL = asset.URL
		}
	}
	release.Available = release.Asset != "" && Compare(version, buildinfo.Version) > 0
	return release, nil
}

func versionParts(raw string) ([]int, error) {
	core := strings.SplitN(strings.SplitN(strings.TrimPrefix(raw, "v"), "+", 2)[0], "-", 2)[0]
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("无效版本号: %s", raw)
	}
	values := make([]int, 3)
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 || strconv.Itoa(n) != p {
			return nil, fmt.Errorf("无效版本号")
		}
		values[i] = n
	}
	return values, nil
}

func Compare(a, b string) int {
	ap, ae := versionParts(a)
	bp, be := versionParts(b)
	if ae != nil || be != nil {
		return 0
	}
	for i := range ap {
		if ap[i] < bp[i] {
			return -1
		}
		if ap[i] > bp[i] {
			return 1
		}
	}
	pre := func(s string) string {
		p := strings.SplitN(strings.SplitN(s, "+", 2)[0], "-", 2)
		if len(p) == 2 {
			return p[1]
		}
		return ""
	}
	x, y := pre(a), pre(b)
	if x == y {
		return 0
	}
	if x == "" {
		return 1
	}
	if y == "" {
		return -1
	}
	xp, yp := strings.Split(x, "."), strings.Split(y, ".")
	for i := 0; i < len(xp) && i < len(yp); i++ {
		if xp[i] == yp[i] {
			continue
		}
		xn, xe := strconv.Atoi(xp[i])
		yn, ye := strconv.Atoi(yp[i])
		if xe == nil && ye == nil {
			if xn < yn {
				return -1
			}
			return 1
		}
		if xe == nil {
			return -1
		}
		if ye == nil {
			return 1
		}
		if xp[i] < yp[i] {
			return -1
		}
		return 1
	}
	if len(xp) < len(yp) {
		return -1
	}
	return 1
}

func download(ctx context.Context, release *Release, destination string) error {
	client := releaseClient()
	client.Timeout = 15 * time.Minute
	return downloadWithClient(ctx, client, release, destination)
}

func downloadWithClient(ctx context.Context, client *http.Client, release *Release, destination string) error {
	digest := release.Digest
	if len(digest) != 64 {
		if release.ChecksumURL == "" {
			return fmt.Errorf("发行包缺少 SHA-256，未执行升级")
		}
		response, err := get(ctx, client, release.ChecksumURL)
		if err != nil {
			return err
		}
		data, err := io.ReadAll(io.LimitReader(response.Body, 4096))
		response.Body.Close()
		if err != nil {
			return err
		}
		fields := strings.Fields(string(data))
		if len(fields) == 0 {
			return fmt.Errorf("无效校验文件")
		}
		digest = fields[0]
	}
	if decoded, err := hex.DecodeString(digest); err != nil || len(decoded) != 32 {
		return fmt.Errorf("无效 SHA-256")
	}
	response, err := get(ctx, client, release.DownloadURL)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, maxDownloadBytes+1))
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if n > maxDownloadBytes {
		return fmt.Errorf("更新包超过大小限制")
	}
	if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), digest) {
		os.Remove(destination)
		return fmt.Errorf("更新包校验失败，当前版本保留")
	}
	return nil
}
