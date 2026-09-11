package terminal

import (
	"fmt"
	"strings"
	"testing"
)

// 文件沙箱分为两层：normalizeRequestedPath 在词法层拒绝畸形输入，
// resolveAllowedPathContext 再通过 VM 内 realpath + commonpath 把路径限制在
// /data 之内。本文件只测试纯函数层；依赖 limactl 的部分不允许在单测中执行，
// 以免触碰真实虚拟机（见 docs/backend-code-review-2026-09-11.md P0-5）。

func TestNormalizeRequestedPathAcceptsValidDataPaths(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"data root", "/data", "/data"},
		{"plain subdir", "/data/media", "/data/media"},
		{"trailing slash cleaned", "/data/media/", "/data/media"},
		{"inner dot cleaned", "/data/media/../files", "/data/files"},
		{"double slash cleaned", "//data//media", "/data/media"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeRequestedPath(tc.in)
			if err != nil {
				t.Fatalf("normalizeRequestedPath(%q) unexpected error: %v", tc.in, err)
			}
			if got != tc.want {
				t.Fatalf("normalizeRequestedPath(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestNormalizeRequestedPathRejectsMalformedInput(t *testing.T) {
	invalid := map[string]string{
		"empty":           "",
		"whitespace only": "   ",
		"relative path":   "data/media",
		"dot relative":    "./data",
		"parent relative": "../data",
		"newline":         "/data/a\nb",
		"carriage return": "/data/a\rb",
		"nul byte":        "/data/a\x00b",
		"tab":             "/data/a\tb",
		"escape sequence": "/data/a\x1bb",
		"over 4096 bytes": "/data/" + strings.Repeat("a", 4100),
	}
	// U+2028（行分隔符）不属于 unicode.IsControl 的 Cc 类，词法层放行；
	// 参数数组式执行保证它只是数据，不会改变命令结构。
	for name, input := range invalid {
		t.Run(name, func(t *testing.T) {
			if got, err := normalizeRequestedPath(input); err == nil {
				t.Fatalf("normalizeRequestedPath(%q) = %q, want error", input, got)
			}
		})
	}
}

// 词法层只做规范化，不做范围判定：穿越形式会被清理成目标路径原样通过，
// 拦截发生在 VM 侧 realpath 检查。固定该分层行为，防止有人误删第二层防线。
func TestNormalizeRequestedPathLexicalLayerDoesNotEnforceScope(t *testing.T) {
	cases := map[string]string{
		"/data/../etc/passwd":   "/etc/passwd",
		"/../etc":               "/etc",
		"/data/media/../../../": "/",
	}
	for input, want := range cases {
		got, err := normalizeRequestedPath(input)
		if err != nil {
			t.Fatalf("normalizeRequestedPath(%q) unexpected error: %v", input, err)
		}
		if got != want {
			t.Fatalf("normalizeRequestedPath(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestIsSystemProtectedDir(t *testing.T) {
	protected := []string{
		"/",
		"/data",
		"/data/",
		"/bin",
		"/boot",
		"/dev",
		"/etc",
		"/lib",
		"/proc",
		"/root",
		"/sys",
		"/usr",
		"/var",
		"/home",
		"/data/.trash",
		"/data/.trash/",
		"/data/.trash/xyz",
	}
	for _, p := range protected {
		if !isSystemProtectedDir(p) {
			t.Errorf("isSystemProtectedDir(%q) = false, want true", p)
		}
	}

	// 系统目录的后代在此层不拦截（该职责在路径沙箱层），
	// 这里必须保留 false 以免与沙箱语义混淆。
	notProtected := []string{
		"/data/media",
		"/data/appdata",
		"/etc/passwd",
		"/usr/bin/env",
		"/home/macnas/file.txt",
	}
	for _, p := range notProtected {
		if isSystemProtectedDir(p) {
			t.Errorf("isSystemProtectedDir(%q) = true, want false", p)
		}
	}
}

func TestNormalizeTrashIDs(t *testing.T) {
	// 内部含控制字符的标识整体拒绝；首尾空白先被裁剪，属正常规范化。
	if ids, err := normalizeTrashIDs([]string{" a ", "b\tc", "d"}); err == nil {
		t.Fatalf("inner control character should be rejected, got %v", ids)
	}

	if _, err := normalizeTrashIDs(nil); err != nil {
		t.Fatalf("empty input should be allowed, got error: %v", err)
	}

	tooMany := make([]string, maxTrashItemsPerOperation+1)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf("id-%d", i)
	}
	if _, err := normalizeTrashIDs(tooMany); err == nil {
		t.Fatalf("normalizeTrashIDs accepted %d items, want rejection", len(tooMany))
	}

	long := strings.Repeat("a", 513)
	if _, err := normalizeTrashIDs([]string{long}); err == nil {
		t.Fatal("normalizeTrashIDs accepted over-long id, want rejection")
	}

	trimmed, err := normalizeTrashIDs([]string{"  id-1  "})
	if err != nil {
		t.Fatalf("normalizeTrashIDs unexpected error: %v", err)
	}
	if trimmed[0] != "id-1" {
		t.Fatalf("id not trimmed: %q", trimmed[0])
	}
}

func TestParseRange(t *testing.T) {
	const size = int64(1000)
	cases := []struct {
		name   string
		header string
		start  int64
		end    int64
		ok     bool
	}{
		{"basic", "bytes=0-499", 0, 499, true},
		{"open ended", "bytes=500-", 500, 999, true},
		{"suffix", "bytes=-500", 500, 999, true},
		{"suffix larger than file clamped", "bytes=-2000", 0, 999, true},
		{"end beyond file clamped", "bytes=0-2000", 0, 999, true},
		{"last byte", "bytes=999-999", 999, 999, true},
		{"start at file size", "bytes=1000-", 0, 0, false},
		{"end before start", "bytes=900-100", 0, 0, false},
		{"both empty", "bytes=-", 0, 0, false},
		{"not a range", "bytes=abc-def", 0, 0, false},
		{"multi range unsupported", "bytes=0-1,5-9", 0, 0, false},
		{"wrong unit", "chunks=0-499", 0, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			start, end, ok := parseRange(tc.header, size)
			if ok != tc.ok {
				t.Fatalf("parseRange(%q) ok = %v, want %v", tc.header, ok, tc.ok)
			}
			if ok && (start != tc.start || end != tc.end) {
				t.Fatalf("parseRange(%q) = (%d, %d), want (%d, %d)", tc.header, start, end, tc.start, tc.end)
			}
		})
	}

	if _, _, ok := parseRange("bytes=0-499", 0); ok {
		t.Fatal("parseRange with zero-length file should be invalid")
	}
}

func TestFormatBytes(t *testing.T) {
	cases := map[int64]string{
		0:             "0 B",
		512:           "512 B",
		1024:          "1.0 KB",
		1536:          "1.5 KB",
		1048576:       "1.0 MB",
		536870912:     "512.0 MB",
		1073741824:    "1.0 GB",
		1099511627776: "1.0 TB",
	}
	for in, want := range cases {
		if got := formatBytes(in); got != want {
			t.Errorf("formatBytes(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestGetMimeType(t *testing.T) {
	cases := map[string]string{
		"mp4":  "video/mp4",
		"mkv":  "video/x-matroska",
		"MOV":  "video/quicktime",
		"jpg":  "image/jpeg",
		"jpeg": "image/jpeg",
		"png":  "image/png",
		"svg":  "image/svg+xml",
		"mp3":  "audio/mpeg",
		"flac": "audio/flac",
		"pdf":  "application/pdf",
		"xyz":  "application/octet-stream",
		"":     "application/octet-stream",
	}
	for ext, want := range cases {
		if got := getMimeType(ext); got != want {
			t.Errorf("getMimeType(%q) = %q, want %q", ext, got, want)
		}
	}
}

func TestUploadStreamErrorMapsSizeLimit(t *testing.T) {
	tooLarge := fmt.Errorf("http: request body too large (%d bytes)", maxUploadSizeBytes)
	mapped := uploadStreamError(tooLarge)
	if !strings.Contains(mapped.Error(), "request body too large") {
		t.Fatalf("size-limit error not preserved: %v", mapped)
	}

	plain := fmt.Errorf("some other failure")
	if got := uploadStreamError(plain); !strings.Contains(got.Error(), "读取上传内容失败") {
		t.Fatalf("generic read failure not wrapped: %v", got)
	}
}
