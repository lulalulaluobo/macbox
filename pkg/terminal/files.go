package terminal

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

type FileInfo struct {
	Name          string `json:"name"`
	Path          string `json:"path"`
	IsDir         bool   `json:"isDir"`
	IsSymlink     bool   `json:"isSymlink"`
	Size          int64  `json:"size"`
	SizeFormatted string `json:"sizeFormatted"`
	Mode          string `json:"mode"`
	Mtime         int64  `json:"mtime"`
	MtimeString   string `json:"mtimeString"`
	Ext           string `json:"ext"`
}

const maxUploadSizeBytes int64 = 10 << 30

// The trash manifest is shared by all file operations. Serialize mutations so
// concurrent requests cannot overwrite each other's index updates.
var trashOperationMu sync.Mutex

func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

// ListFiles lists files in target directory inside the VM using Python scandir for high performance
func ListFiles(instanceName, targetPath string) ([]FileInfo, error) {
	return ListFilesContext(context.Background(), instanceName, targetPath)
}

// ListFilesContext is the request-aware variant used by HTTP handlers.
func ListFilesContext(ctx context.Context, instanceName, targetPath string) ([]FileInfo, error) {
	if instanceName == "" {
		instanceName = "macnas"
	}
	if targetPath == "" {
		targetPath = "/data"
	}
	var err error
	targetPath, err = resolveAllowedPathContext(ctx, instanceName, targetPath)
	if err != nil {
		return nil, err
	}

	pyScript := fmt.Sprintf(`
import os, json, sys, time
p = sys.argv[1] if len(sys.argv) > 1 else "/data"
items = []
try:
    with os.scandir(p) as it:
        for entry in it:
            try:
                st = entry.stat(follow_symlinks=False)
                items.append({
                    "name": entry.name,
                    "isDir": entry.is_dir(follow_symlinks=False),
                    "isSymlink": entry.is_symlink(),
                    "size": st.st_size,
                    "mode": oct(st.st_mode)[-4:],
                    "mtime": int(st.st_mtime)
                })
            except Exception:
                pass
except Exception as e:
    print(f"读取目录失败: {e}", file=sys.stderr)
    raise
items.sort(key=lambda x: (not x["isDir"], x["name"].lower()))
print(json.dumps(items))
`)

	cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "python3", "-c", pyScript, targetPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("读取目录失败: %s (%w)", strings.TrimSpace(string(out)), err)
	}

	var rawItems []struct {
		Name      string `json:"name"`
		IsDir     bool   `json:"isDir"`
		IsSymlink bool   `json:"isSymlink"`
		Size      int64  `json:"size"`
		Mode      string `json:"mode"`
		Mtime     int64  `json:"mtime"`
	}

	if err := json.Unmarshal(out, &rawItems); err != nil {
		return nil, fmt.Errorf("解析目录数据失败: %w", err)
	}

	var items []FileInfo
	for _, raw := range rawItems {
		fullPath := path.Join(targetPath, raw.Name)
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(raw.Name), "."))
		mtimeStr := time.Unix(raw.Mtime, 0).Format("2006-01-02 15:04")
		sizeFmt := formatBytes(raw.Size)
		if raw.IsDir {
			sizeFmt = "--"
		}

		items = append(items, FileInfo{
			Name:          raw.Name,
			Path:          fullPath,
			IsDir:         raw.IsDir,
			IsSymlink:     raw.IsSymlink,
			Size:          raw.Size,
			SizeFormatted: sizeFmt,
			Mode:          raw.Mode,
			Mtime:         raw.Mtime,
			MtimeString:   mtimeStr,
			Ext:           ext,
		})
	}

	return items, nil
}

// ReadFile reads up to 512KB text from file inside the VM
func ReadFile(instanceName, filePath string) (string, error) {
	return ReadFileContext(context.Background(), instanceName, filePath)
}

func ReadFileContext(ctx context.Context, instanceName, filePath string) (string, error) {
	if instanceName == "" {
		instanceName = "macnas"
	}
	var err error
	filePath, err = resolveAllowedPathContext(ctx, instanceName, filePath)
	if err != nil {
		return "", err
	}

	cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "head", "-c", "524288", filePath)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("读取文件失败: %w", err)
	}
	return string(out), nil
}

// WriteFile writes text content to file inside the VM without invoking a shell.
func WriteFile(instanceName, filePath, content string) error {
	return WriteFileContext(context.Background(), instanceName, filePath, content)
}

func WriteFileContext(ctx context.Context, instanceName, filePath, content string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	var err error
	filePath, err = resolveAllowedPathContext(ctx, instanceName, filePath)
	if err != nil {
		return err
	}

	cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "sudo", "tee", filePath)
	cmd.Stdin = strings.NewReader(content)
	cmd.Stdout = io.Discard
	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf
	err = cmd.Run()
	if err != nil {
		return fmt.Errorf("写入文件失败: %s (%w)", strings.TrimSpace(errBuf.String()), err)
	}
	return nil
}

// CreateDir creates directory inside VM
func CreateDir(instanceName, dirPath string) error {
	return CreateDirContext(context.Background(), instanceName, dirPath)
}

func CreateDirContext(ctx context.Context, instanceName, dirPath string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	var err error
	dirPath, err = resolveAllowedPathContext(ctx, instanceName, dirPath)
	if err != nil {
		return err
	}

	cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "mkdir", "-p", dirPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("创建文件夹失败: %s (%w)", string(out), err)
	}
	return nil
}

type TrashItem struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	OriginalPath    string `json:"originalPath"`
	TrashPath       string `json:"trashPath"`
	IsDir           bool   `json:"isDir"`
	Size            int64  `json:"size"`
	SizeFormatted   string `json:"sizeFormatted"`
	DeletedAt       int64  `json:"deletedAt"`
	DeletedAtString string `json:"deletedAtString"`
}

const maxTrashItemsPerOperation = 500

func normalizeTrashIDs(itemIDs []string) ([]string, error) {
	if len(itemIDs) > maxTrashItemsPerOperation {
		return nil, fmt.Errorf("一次最多处理 %d 个回收站项目", maxTrashItemsPerOperation)
	}
	ids := make([]string, len(itemIDs))
	for i, rawID := range itemIDs {
		id := strings.TrimSpace(rawID)
		if id == "" || len([]byte(id)) > 512 || strings.IndexFunc(id, unicode.IsControl) >= 0 {
			return nil, fmt.Errorf("回收站项目标识无效")
		}
		ids[i] = id
	}
	return ids, nil
}

func isSystemProtectedDir(p string) bool {
	p = path.Clean(p)
	return p == "/" || p == "/data" || p == "/bin" || p == "/boot" ||
		p == "/dev" || p == "/etc" || p == "/lib" || p == "/proc" ||
		p == "/root" || p == "/sys" || p == "/usr" || p == "/var" || p == "/home" ||
		p == "/data/.trash" || strings.HasPrefix(p, "/data/.trash/")
}

const allowedPathResolverScript = `import os, sys

root = os.path.realpath('/data')
candidate = os.path.realpath(sys.argv[1])
try:
    allowed = os.path.commonpath((root, candidate)) == root
except ValueError:
    allowed = False
if not allowed:
    raise SystemExit(2)
print(candidate)
`

// resolveAllowedPath validates the canonical path inside the VM. Checking the
// canonical parent also blocks ../ traversal and symlinks that point outside
// the user data root, including for paths that do not exist yet.
func resolveAllowedPath(instanceName, requested string) (string, error) {
	return resolveAllowedPathContext(context.Background(), instanceName, requested)
}

// normalizeRequestedPath applies the lexical validation that every file API
// request must pass before the VM-side canonicalization runs. Rejections here
// are deterministic and do not require the VM to be running.
func normalizeRequestedPath(requested string) (string, error) {
	requested = strings.TrimSpace(requested)
	if requested == "" || len(requested) > 4096 || strings.IndexFunc(requested, unicode.IsControl) >= 0 {
		return "", fmt.Errorf("路径格式无效")
	}
	clean := path.Clean(requested)
	if !path.IsAbs(clean) {
		return "", fmt.Errorf("路径必须为绝对路径")
	}
	return clean, nil
}

func resolveAllowedPathContext(ctx context.Context, instanceName, requested string) (string, error) {
	if instanceName == "" {
		instanceName = "macnas"
	}
	clean, err := normalizeRequestedPath(requested)
	if err != nil {
		return "", err
	}

	cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "python3", "-c", allowedPathResolverScript, clean)
	resolved, err := cmd.Output()
	if err != nil || strings.TrimSpace(string(resolved)) == "" {
		return "", fmt.Errorf("路径不在允许的 /data 存储范围内")
	}
	// Use the same canonical path that was checked. Returning the original
	// lexical path would reopen a symlink/TOCTOU window between validation and
	// the subsequent file operation. Keep the public data root spelling so
	// destructive handlers can still recognize and protect it.
	canonical := strings.TrimSpace(string(resolved))
	if clean == "/data" {
		return "/data", nil
	}
	return canonical, nil
}

// DeletePath deletes file or folder inside VM safely and stages to Mac ~/.Trash
func DeletePath(instanceName, targetPath string) error {
	return DeletePathContext(context.Background(), instanceName, targetPath)
}

func DeletePathContext(ctx context.Context, instanceName, targetPath string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	var err error
	targetPath, err = resolveAllowedPathContext(ctx, instanceName, targetPath)
	if err != nil {
		return err
	}

	if isSystemProtectedDir(targetPath) {
		return fmt.Errorf("禁止删除系统保护目录: %s", targetPath)
	}

	// Stage to host ~/.Trash before deleting from VM as an extra safety net
	baseName := path.Base(targetPath)
	stagingDir := filepath.Join(os.TempDir(), "macnas-trash-staging")
	if err := os.MkdirAll(stagingDir, 0700); err != nil {
		return fmt.Errorf("准备回收站暂存目录失败: %w", err)
	}
	stagedPath := filepath.Join(stagingDir, fmt.Sprintf("%d_%s", time.Now().UnixNano(), baseName))

	copyCmd := exec.CommandContext(ctx, "limactl", "copy", "-r", fmt.Sprintf("%s:%s", instanceName, targetPath), stagedPath)
	if err := copyCmd.Run(); err != nil {
		return fmt.Errorf("删除前备份到回收站失败: %w", err)
	}
	if err := MoveFileOrDirToMacTrashContext(ctx, stagedPath, baseName); err != nil {
		return fmt.Errorf("移动回收站备份失败: %w", err)
	}

	cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "sudo", "rm", "-rf", targetPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		errMsg := string(out)
		if strings.Contains(errMsg, "Read-only file system") {
			return fmt.Errorf("当前目录处于只读保护模式 (Read-only)，禁止删除。请前往【存储设置】将该直通目录切换为【允许读写】")
		}
		return fmt.Errorf("删除失败: %s (%w)", errMsg, err)
	}
	return nil
}

// DownloadFile streams a file from the VM directly to HTTP client
func DownloadFile(w http.ResponseWriter, r *http.Request, instanceName, filePath string) {
	if instanceName == "" {
		instanceName = "macnas"
	}
	var err error
	filePath, err = resolveAllowedPathContext(r.Context(), instanceName, filePath)
	if err != nil {
		log.Printf("[MacNAS Files] download path rejected: %v", err)
		http.Error(w, "文件路径不允许访问", http.StatusForbidden)
		return
	}
	fileName := path.Base(filePath)

	cmd := exec.CommandContext(r.Context(), "limactl", "shell", instanceName, "cat", filePath)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Printf("[MacNAS Files] create download stream failed: %v", err)
		http.Error(w, "下载文件失败", http.StatusInternalServerError)
		return
	}

	if err := cmd.Start(); err != nil {
		log.Printf("[MacNAS Files] start download failed: %v", err)
		http.Error(w, "下载文件失败", http.StatusInternalServerError)
		return
	}
	defer func() {
		if waitErr := cmd.Wait(); waitErr != nil {
			log.Printf("[MacNAS Files] download command failed: %v", waitErr)
		}
	}()

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(fileName)))
	w.Header().Set("Content-Type", "application/octet-stream")

	if _, err := io.Copy(w, stdout); err != nil {
		log.Printf("[MacNAS Files] stream download failed: %v", err)
	}
}

// UploadFile saves a multipart uploaded file into target directory inside the VM
func UploadFile(w http.ResponseWriter, r *http.Request, instanceName, targetDir string) error {
	if r == nil || r.Body == nil {
		return fmt.Errorf("上传请求无效")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSizeBytes)
	if instanceName == "" {
		instanceName = "macnas"
	}
	if targetDir == "" {
		targetDir = "/data"
	}
	var err error
	targetDir, err = resolveAllowedPathContext(r.Context(), instanceName, targetDir)
	if err != nil {
		return err
	}

	reader, err := r.MultipartReader()
	if err != nil {
		return fmt.Errorf("上传请求格式无效: %w", err)
	}
	file, err := reader.NextPart()
	if err == io.EOF {
		return fmt.Errorf("上传文件不能为空")
	}
	if err != nil {
		return fmt.Errorf("读取上传内容失败: %w", err)
	}
	if file.FormName() != "file" {
		return fmt.Errorf("上传请求必须包含 file 文件字段")
	}

	fileName := path.Base(strings.ReplaceAll(file.FileName(), "\\", "/"))
	if fileName == "." || fileName == ".." || fileName == "" ||
		len(fileName) > 255 || strings.IndexFunc(fileName, unicode.IsControl) >= 0 {
		return fmt.Errorf("上传文件名无效")
	}
	destPath, err := resolveAllowedPathContext(r.Context(), instanceName, path.Join(targetDir, fileName))
	if err != nil {
		return err
	}
	// Write beside the destination and rename only after the complete stream has
	// reached the VM. This prevents a cancelled upload from exposing a partial
	// file under its final name.
	tempPath, err := resolveAllowedPathContext(r.Context(), instanceName, fmt.Sprintf("%s.macnas-upload-%d", destPath, time.Now().UnixNano()))
	if err != nil {
		return fmt.Errorf("准备上传临时文件失败: %w", err)
	}
	committed := false
	cleanup := func() {
		if committed {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		cleanupCmd := exec.CommandContext(cleanupCtx, "limactl", "shell", instanceName, "sudo", "rm", "-f", tempPath)
		if cleanupErr := cleanupCmd.Run(); cleanupErr != nil {
			log.Printf("[MacNAS Files] cleanup interrupted upload failed: %v", cleanupErr)
		}
	}
	defer cleanup()

	cmd := exec.CommandContext(r.Context(), "limactl", "shell", instanceName, "sudo", "tee", tempPath)
	stream := &uploadPartReader{reader: file}
	cmd.Stdin = stream
	cmd.Stdout = io.Discard

	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf

	if err := cmd.Run(); err != nil {
		if stream.err != nil {
			return uploadStreamError(stream.err)
		}
		errMsg := errBuf.String()
		if strings.Contains(errMsg, "Read-only file system") {
			return fmt.Errorf("当前目录处于只读保护模式 (Read-only)，禁止上传文件")
		}
		return fmt.Errorf("上传文件写入失败: %s (%w)", errMsg, err)
	}
	if stream.err != nil {
		return uploadStreamError(stream.err)
	}
	// The client sends exactly one file part. Reject additional parts so a
	// malformed request cannot silently smuggle a second upload or fields that
	// the handler does not process.
	if extra, nextErr := reader.NextPart(); nextErr != io.EOF {
		if nextErr != nil {
			return fmt.Errorf("读取上传内容失败: %w", nextErr)
		}
		return fmt.Errorf("上传请求只能包含一个文件")
	} else if extra != nil {
		return fmt.Errorf("上传请求只能包含一个文件")
	}
	moveCmd := exec.CommandContext(r.Context(), "limactl", "shell", instanceName, "sudo", "mv", "-f", tempPath, destPath)
	if output, err := moveCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("提交上传文件失败: %s (%w)", strings.TrimSpace(string(output)), err)
	}
	committed = true
	return nil
}

// uploadPartReader preserves read failures from the request body. os/exec
// copies a non-file Stdin in a helper goroutine, so without retaining this
// error an http.MaxBytesReader failure could be reported as a generic command
// failure instead of a 413 response.
type uploadPartReader struct {
	reader io.Reader
	err    error
}

func (r *uploadPartReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if err != nil && err != io.EOF {
		r.err = err
	}
	return n, err
}

func uploadStreamError(err error) error {
	if strings.Contains(err.Error(), "request body too large") {
		return fmt.Errorf("request body too large: %w", err)
	}
	return fmt.Errorf("读取上传内容失败: %w", err)
}

// RenamePath renames or moves a file or folder inside the VM
func RenamePath(instanceName, oldPath, newPath string) error {
	return RenamePathContext(context.Background(), instanceName, oldPath, newPath)
}

func RenamePathContext(ctx context.Context, instanceName, oldPath, newPath string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	var err error
	oldPath, err = resolveAllowedPathContext(ctx, instanceName, oldPath)
	if err != nil {
		return err
	}
	newPath, err = resolveAllowedPathContext(ctx, instanceName, newPath)
	if err != nil {
		return err
	}

	if isSystemProtectedDir(oldPath) {
		return fmt.Errorf("禁止重命名系统核心目录: %s", oldPath)
	}
	if newPath == "" || newPath == "/" {
		return fmt.Errorf("无效的目标路径")
	}

	cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "sudo", "mv", oldPath, newPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		errMsg := string(out)
		if strings.Contains(errMsg, "Read-only file system") {
			return fmt.Errorf("当前目录处于只读保护模式 (Read-only)，禁止修改名称。请前往【存储设置】将该直通目录切换为【允许读写】")
		}
		return fmt.Errorf("重命名失败: %s (%w)", errMsg, err)
	}
	return nil
}

// CopyPaths copies multiple files or directories to destination directory
func CopyPaths(instanceName string, srcPaths []string, destDir string) error {
	return CopyPathsContext(context.Background(), instanceName, srcPaths, destDir)
}

func CopyPathsContext(ctx context.Context, instanceName string, srcPaths []string, destDir string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	var err error
	destDir, err = resolveAllowedPathContext(ctx, instanceName, destDir)
	if err != nil {
		return err
	}
	for _, src := range srcPaths {
		src, err = resolveAllowedPathContext(ctx, instanceName, src)
		if err != nil {
			return err
		}
		if path.Clean(src) == "/data" {
			return fmt.Errorf("禁止复制存储根目录")
		}
		cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "sudo", "cp", "-r", src, destDir+"/")
		out, err := cmd.CombinedOutput()
		if err != nil {
			errMsg := string(out)
			if strings.Contains(errMsg, "Read-only file system") {
				return fmt.Errorf("目标目录处于只读保护模式，无法复制写入")
			}
			return fmt.Errorf("复制 %s 失败: %s", path.Base(src), errMsg)
		}
	}
	return nil
}

// MovePaths moves multiple files or directories to destination directory
func MovePaths(instanceName string, srcPaths []string, destDir string) error {
	return MovePathsContext(context.Background(), instanceName, srcPaths, destDir)
}

func MovePathsContext(ctx context.Context, instanceName string, srcPaths []string, destDir string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	var err error
	destDir, err = resolveAllowedPathContext(ctx, instanceName, destDir)
	if err != nil {
		return err
	}
	for _, src := range srcPaths {
		src, err = resolveAllowedPathContext(ctx, instanceName, src)
		if err != nil {
			return err
		}
		if isSystemProtectedDir(src) {
			return fmt.Errorf("禁止移动系统核心目录: %s", src)
		}
		cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "sudo", "mv", src, destDir+"/")
		out, err := cmd.CombinedOutput()
		if err != nil {
			errMsg := string(out)
			if strings.Contains(errMsg, "Read-only file system") {
				return fmt.Errorf("当前或目标目录处于只读保护模式，无法移动")
			}
			return fmt.Errorf("移动 %s 失败: %s", path.Base(src), errMsg)
		}
	}
	return nil
}

// MoveToTrash moves files into /data/.trash and logs metadata
func MoveToTrash(instanceName string, targetPaths []string) error {
	return MoveToTrashContext(context.Background(), instanceName, targetPaths)
}

func MoveToTrashContext(ctx context.Context, instanceName string, targetPaths []string) error {
	trashOperationMu.Lock()
	defer trashOperationMu.Unlock()

	if instanceName == "" {
		instanceName = "macnas"
	}
	if len(targetPaths) > maxTrashItemsPerOperation {
		return fmt.Errorf("一次最多处理 %d 个文件", maxTrashItemsPerOperation)
	}

	var validPaths []string
	var err error
	for _, p := range targetPaths {
		if strings.TrimSpace(p) == "" || len([]byte(p)) > 4096 || strings.IndexFunc(p, unicode.IsControl) >= 0 {
			return fmt.Errorf("文件路径无效")
		}
		p, err = resolveAllowedPathContext(ctx, instanceName, p)
		if err != nil {
			return err
		}
		if isSystemProtectedDir(p) {
			return fmt.Errorf("禁止移入回收站: 系统保护目录 %s", p)
		}
		for _, existing := range validPaths {
			if p == existing || strings.HasPrefix(p, existing+"/") || strings.HasPrefix(existing, p+"/") {
				return fmt.Errorf("不能同时处理相同或嵌套的文件路径")
			}
		}
		validPaths = append(validPaths, p)
	}
	if len(validPaths) == 0 {
		return nil
	}

	pathsJSON, err := json.Marshal(validPaths)
	if err != nil {
		return err
	}
	b64Payload := base64.StdEncoding.EncodeToString(pathsJSON)

	pyScript := `
import os, sys, json, shutil, time, base64

paths = json.loads(base64.b64decode(sys.argv[1]).decode('utf-8'))
root = os.path.realpath('/data')
trash_dir = '/data/.trash'
expected_trash_root = os.path.join(root, '.trash')
trash_root = os.path.realpath(trash_dir)
if trash_root != expected_trash_root:
    raise RuntimeError('回收站目录解析异常')
os.makedirs(trash_dir, exist_ok=True)
if os.path.realpath(trash_dir) != expected_trash_root:
    raise RuntimeError('回收站目录不能是符号链接')
os.chmod(trash_dir, 0o700)
manifest_path = os.path.join(trash_dir, '.manifest.json')
if os.path.islink(manifest_path) or (os.path.lexists(manifest_path) and os.path.realpath(manifest_path) != os.path.join(trash_root, '.manifest.json')):
    raise RuntimeError('回收站索引不能是符号链接')

def is_inside(base, candidate):
    try:
        return os.path.commonpath((base, os.path.realpath(candidate))) == base
    except ValueError:
        return False

manifest = []
if os.path.exists(manifest_path):
    if os.path.getsize(manifest_path) > 16 * 1024 * 1024:
        raise RuntimeError('回收站索引超过大小限制')
    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
    except Exception as e:
        raise RuntimeError(f'回收站索引损坏: {e}')
    if not isinstance(manifest, list):
        raise RuntimeError('回收站索引格式无效')

now = int(time.time())
nonce = time.time_ns()
validated = []
for p in paths:
    if not is_inside(root, p):
        raise RuntimeError('待删除路径超出数据根目录')
    if not os.path.lexists(p):
        raise RuntimeError(f'待删除路径不存在: {p}')
    is_dir = os.path.isdir(p)
    size = 0
    if not is_dir:
        try:
            size = os.path.getsize(p)
        except Exception:
            pass
    base_name = os.path.basename(p)
    validated.append((p, is_dir, size, base_name))

tmp_manifest = manifest_path + '.tmp'
if os.path.islink(tmp_manifest):
    raise RuntimeError('回收站临时索引不能是符号链接')

moved = []
try:
    for idx, (p, is_dir, size, base_name) in enumerate(validated):
        item_id = f'{nonce}_{idx}_{base_name}'
        target_trash_path = os.path.join(trash_dir, item_id)
        if os.path.lexists(target_trash_path):
            raise RuntimeError('回收站目标已存在')
        shutil.move(p, target_trash_path)
        moved.append((target_trash_path, p))
        manifest.append({
            'id': item_id,
            'name': base_name,
            'originalPath': p,
            'trashPath': target_trash_path,
            'isDir': is_dir,
            'size': size,
            'deletedAt': now,
        })

    payload = json.dumps(manifest, ensure_ascii=False, indent=2)
    if len(payload.encode('utf-8')) > 16 * 1024 * 1024:
        raise RuntimeError('回收站索引超过大小限制')
    with open(tmp_manifest, 'w', encoding='utf-8') as f:
        f.write(payload)
    os.chmod(tmp_manifest, 0o600)
    os.replace(tmp_manifest, manifest_path)
except Exception:
    for moved_path, original_path in reversed(moved):
        if os.path.lexists(moved_path) and not os.path.lexists(original_path):
            try:
                os.makedirs(os.path.dirname(original_path), exist_ok=True)
                shutil.move(moved_path, original_path)
            except Exception:
                pass
    try:
        if os.path.exists(tmp_manifest) and not os.path.islink(tmp_manifest):
            os.remove(tmp_manifest)
    except Exception:
        pass
    raise
`

	cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "sudo", "python3", "-c", pyScript, b64Payload)
	out, err := cmd.CombinedOutput()
	if err != nil {
		errMsg := string(out)
		if strings.Contains(errMsg, "Read-only file system") {
			return fmt.Errorf("当前目录处于只读保护模式 (Read-only)，禁止移入回收站。请前往【存储设置】将该直通目录切换为【允许读写】")
		}
		return fmt.Errorf("移入回收站失败: %s", errMsg)
	}
	return nil
}

// ListTrash reads items from /data/.trash/.manifest.json
func ListTrash(instanceName string) ([]TrashItem, error) {
	return ListTrashContext(context.Background(), instanceName)
}

func ListTrashContext(ctx context.Context, instanceName string) ([]TrashItem, error) {
	trashOperationMu.Lock()
	defer trashOperationMu.Unlock()
	return listTrashContext(ctx, instanceName)
}

func listTrashContext(ctx context.Context, instanceName string) ([]TrashItem, error) {
	if instanceName == "" {
		instanceName = "macnas"
	}

	pyScript := `
import os, sys, json, time

manifest_path = '/data/.trash/.manifest.json'
root = os.path.realpath('/data')
trash_root = os.path.realpath('/data/.trash')
if trash_root != os.path.join(root, '.trash'):
    raise RuntimeError('回收站目录解析异常')
if os.path.islink(manifest_path) or (os.path.lexists(manifest_path) and os.path.realpath(manifest_path) != os.path.join(trash_root, '.manifest.json')):
    raise RuntimeError('回收站索引不能是符号链接')

def is_inside(base, candidate):
    try:
        return os.path.commonpath((base, os.path.realpath(candidate))) == base
    except ValueError:
        return False

if not os.path.exists(manifest_path):
    print('[]')
    sys.exit(0)

try:
    if os.path.getsize(manifest_path) > 16 * 1024 * 1024:
        raise RuntimeError('回收站索引超过大小限制')
    with open(manifest_path, 'r', encoding='utf-8') as f:
        items = json.load(f)
    if not isinstance(items, list):
        raise RuntimeError('回收站索引格式无效')
    valid = []
    for it in items:
        if isinstance(it, dict) and is_inside(root, it.get('originalPath', '')) and is_inside(trash_root, it.get('trashPath', '')) and os.path.exists(it.get('trashPath', '')):
            valid.append(it)
    print(json.dumps(valid, ensure_ascii=False))
except Exception as e:
    print(f"读取回收站索引失败: {e}", file=sys.stderr)
    raise
`
	cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "sudo", "python3", "-c", pyScript)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("读取回收站失败: %s (%w)", strings.TrimSpace(string(out)), err)
	}

	var raw []struct {
		ID           string `json:"id"`
		Name         string `json:"name"`
		OriginalPath string `json:"originalPath"`
		TrashPath    string `json:"trashPath"`
		IsDir        bool   `json:"isDir"`
		Size         int64  `json:"size"`
		DeletedAt    int64  `json:"deletedAt"`
	}

	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("解析回收站数据失败: %w", err)
	}

	var items []TrashItem
	for _, r := range raw {
		items = append(items, TrashItem{
			ID:              r.ID,
			Name:            r.Name,
			OriginalPath:    r.OriginalPath,
			TrashPath:       r.TrashPath,
			IsDir:           r.IsDir,
			Size:            r.Size,
			SizeFormatted:   formatBytes(r.Size),
			DeletedAt:       r.DeletedAt,
			DeletedAtString: time.Unix(r.DeletedAt, 0).Format("2006-01-02 15:04"),
		})
	}
	return items, nil
}

// RestoreTrash restores items from trash back to their original paths
func RestoreTrash(instanceName string, itemIDs []string) error {
	return RestoreTrashContext(context.Background(), instanceName, itemIDs)
}

func RestoreTrashContext(ctx context.Context, instanceName string, itemIDs []string) error {
	trashOperationMu.Lock()
	defer trashOperationMu.Unlock()

	if instanceName == "" {
		instanceName = "macnas"
	}

	normalizedIDs, err := normalizeTrashIDs(itemIDs)
	if err != nil {
		return err
	}
	idsJSON, err := json.Marshal(normalizedIDs)
	if err != nil {
		return err
	}
	b64Payload := base64.StdEncoding.EncodeToString(idsJSON)

	pyScript := `
import os, sys, json, shutil, base64

ids = set(json.loads(base64.b64decode(sys.argv[1]).decode('utf-8')))
manifest_path = '/data/.trash/.manifest.json'
root = os.path.realpath('/data')
trash_root = os.path.realpath('/data/.trash')
if trash_root != os.path.join(root, '.trash'):
    raise RuntimeError('回收站目录解析异常')
if os.path.islink(manifest_path) or (os.path.lexists(manifest_path) and os.path.realpath(manifest_path) != os.path.join(trash_root, '.manifest.json')):
    raise RuntimeError('回收站索引不能是符号链接')

def is_inside(base, candidate):
    try:
        return os.path.commonpath((base, os.path.realpath(candidate))) == base
    except ValueError:
        return False

if not os.path.exists(manifest_path):
    sys.exit(0)

try:
    if os.path.getsize(manifest_path) > 16 * 1024 * 1024:
        raise RuntimeError('回收站索引超过大小限制')
    with open(manifest_path, 'r', encoding='utf-8') as f:
        items = json.load(f)
    if not isinstance(items, list):
        raise RuntimeError('回收站索引格式无效')
except Exception as e:
    print(f'回收站索引损坏: {e}', file=sys.stderr)
    raise

selected = []
remaining = []
for it in items:
    if not isinstance(it, dict):
        raise RuntimeError('回收站索引项目格式无效')
    if it.get('id') in ids or it.get('name') in ids:
        orig = it.get('originalPath')
        trash = it.get('trashPath')
        if not is_inside(root, orig) or not is_inside(trash_root, trash) or not os.path.exists(trash):
            raise RuntimeError('回收站项目路径无效或文件不存在')
        if os.path.lexists(orig):
            raise RuntimeError(f'恢复目标已存在: {orig}')
        selected.append((orig, trash))
    else:
        remaining.append(it)

tmp_manifest = manifest_path + '.tmp'
if os.path.islink(tmp_manifest):
    raise RuntimeError('回收站临时索引不能是符号链接')

moved = []
try:
    for orig, trash in selected:
        if os.path.lexists(orig):
            raise RuntimeError(f'恢复目标已存在: {orig}')
        os.makedirs(os.path.dirname(orig), exist_ok=True)
        shutil.move(trash, orig)
        moved.append((orig, trash))

    payload = json.dumps(remaining, ensure_ascii=False, indent=2)
    if len(payload.encode('utf-8')) > 16 * 1024 * 1024:
        raise RuntimeError('回收站索引超过大小限制')
    with open(tmp_manifest, 'w', encoding='utf-8') as f:
        f.write(payload)
    os.chmod(tmp_manifest, 0o600)
    os.replace(tmp_manifest, manifest_path)
except Exception:
    for original_path, trash_path in reversed(moved):
        if os.path.lexists(original_path) and not os.path.lexists(trash_path):
            try:
                shutil.move(original_path, trash_path)
            except Exception:
                pass
    try:
        if os.path.exists(tmp_manifest) and not os.path.islink(tmp_manifest):
            os.remove(tmp_manifest)
    except Exception:
        pass
    raise
`

	cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "sudo", "python3", "-c", pyScript, b64Payload)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("还原失败: %s (%w)", string(out), err)
	}
	return nil
}

// MoveFileOrDirToMacTrash moves a file or directory from host path into ~/.Trash
func MoveFileOrDirToMacTrash(hostPath string, customName string) error {
	return MoveFileOrDirToMacTrashContext(context.Background(), hostPath, customName)
}

func MoveFileOrDirToMacTrashContext(ctx context.Context, hostPath string, customName string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	macTrash := filepath.Join(home, ".Trash")
	if err := os.MkdirAll(macTrash, 0700); err != nil {
		return err
	}

	fileName := path.Base(strings.ReplaceAll(customName, "\\", "/"))
	if fileName == "" {
		fileName = filepath.Base(hostPath)
	}
	if fileName == "." || fileName == ".." || strings.IndexFunc(fileName, unicode.IsControl) >= 0 {
		return fmt.Errorf("回收站文件名无效")
	}

	destPath := filepath.Join(macTrash, fileName)
	if _, err := os.Stat(destPath); err == nil {
		ext := filepath.Ext(fileName)
		nameWithoutExt := strings.TrimSuffix(fileName, ext)
		destPath = filepath.Join(macTrash, fmt.Sprintf("%s_%d%s", nameWithoutExt, time.Now().Unix(), ext))
	}

	cmd := exec.CommandContext(ctx, "mv", hostPath, destPath)
	return cmd.Run()
}

func deleteAndSendToMacTrash(instanceName string, item TrashItem) error {
	return deleteAndSendToMacTrashContext(context.Background(), instanceName, item)
}

func deleteAndSendToMacTrashContext(ctx context.Context, instanceName string, item TrashItem) error {
	trashPath, err := resolveAllowedPathContext(ctx, instanceName, item.TrashPath)
	if err != nil || !strings.HasPrefix(trashPath, "/data/.trash/") {
		return fmt.Errorf("回收站项目路径无效")
	}
	stagingDir := filepath.Join(os.TempDir(), "macnas-trash-staging")
	if err := os.MkdirAll(stagingDir, 0700); err != nil {
		return fmt.Errorf("准备回收站暂存目录失败: %w", err)
	}

	safeName := item.Name
	if safeName == "" {
		safeName = filepath.Base(trashPath)
	}
	safeName = path.Base(strings.ReplaceAll(safeName, "\\", "/"))
	if safeName == "." || safeName == ".." || safeName == "" {
		return fmt.Errorf("回收站项目名称无效")
	}
	stagedPath := filepath.Join(stagingDir, fmt.Sprintf("%d_%s", time.Now().UnixNano(), safeName))

	var copyCmd *exec.Cmd
	if item.IsDir {
		copyCmd = exec.CommandContext(ctx, "limactl", "copy", "-r", instanceName+":"+trashPath, stagedPath)
	} else {
		copyCmd = exec.CommandContext(ctx, "limactl", "copy", instanceName+":"+trashPath, stagedPath)
	}

	if err := copyCmd.Run(); err != nil {
		return fmt.Errorf("删除前备份到回收站失败: %w", err)
	}
	if err := MoveFileOrDirToMacTrashContext(ctx, stagedPath, safeName); err != nil {
		return fmt.Errorf("移动回收站备份失败: %w", err)
	}

	// Always clean up from VM
	rmCmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "sudo", "rm", "-rf", trashPath)
	if err := rmCmd.Run(); err != nil {
		return fmt.Errorf("清理回收站项目失败: %w", err)
	}
	return nil
}

// DeleteTrashItems deletes selected items from trash and safely moves them to Mac host's ~/.Trash
func DeleteTrashItems(instanceName string, itemIDs []string) (int, error) {
	return DeleteTrashItemsContext(context.Background(), instanceName, itemIDs)
}

func DeleteTrashItemsContext(ctx context.Context, instanceName string, itemIDs []string) (int, error) {
	trashOperationMu.Lock()
	defer trashOperationMu.Unlock()

	if instanceName == "" {
		instanceName = "macnas"
	}
	if len(itemIDs) == 0 {
		return 0, nil
	}
	normalizedIDs, err := normalizeTrashIDs(itemIDs)
	if err != nil {
		return 0, err
	}

	items, err := listTrashContext(ctx, instanceName)
	if err != nil {
		return 0, err
	}

	idSet := make(map[string]bool)
	for _, id := range normalizedIDs {
		idSet[id] = true
	}

	deletedCount := 0
	var toDeleteIds []string
	var operationErr error
	for _, it := range items {
		if idSet[it.ID] || idSet[it.Name] {
			if err := deleteAndSendToMacTrashContext(ctx, instanceName, it); err != nil {
				operationErr = err
				break
			}
			toDeleteIds = append(toDeleteIds, it.ID)
			deletedCount++
		}
	}

	if len(toDeleteIds) > 0 {
		idsJSON, err := json.Marshal(toDeleteIds)
		if err != nil {
			return deletedCount, fmt.Errorf("编码回收站项目失败: %w", err)
		}
		b64Payload := base64.StdEncoding.EncodeToString(idsJSON)
		pyScript := `
import os, sys, json, base64

ids = set(json.loads(base64.b64decode(sys.argv[1]).decode('utf-8')))
manifest_path = '/data/.trash/.manifest.json'
root = os.path.realpath('/data')
trash_root = os.path.realpath('/data/.trash')
if trash_root != os.path.join(root, '.trash'):
    raise RuntimeError('回收站目录解析异常')
if os.path.islink(manifest_path) or (os.path.lexists(manifest_path) and os.path.realpath(manifest_path) != os.path.join(trash_root, '.manifest.json')):
    raise RuntimeError('回收站索引不能是符号链接')
if not os.path.exists(manifest_path):
    sys.exit(0)

try:
    if os.path.getsize(manifest_path) > 16 * 1024 * 1024:
        raise RuntimeError('回收站索引超过大小限制')
    with open(manifest_path, 'r', encoding='utf-8') as f:
        items = json.load(f)
    if not isinstance(items, list):
        raise RuntimeError('回收站索引格式无效')
except Exception as e:
    print(f'回收站索引损坏: {e}', file=sys.stderr)
    raise

remaining = [it for it in items if it.get('id') not in ids and it.get('name') not in ids]

tmp_manifest = manifest_path + '.tmp'
if os.path.islink(tmp_manifest):
    raise RuntimeError('回收站临时索引不能是符号链接')
payload = json.dumps(remaining, ensure_ascii=False, indent=2)
if len(payload.encode('utf-8')) > 16 * 1024 * 1024:
    raise RuntimeError('回收站索引超过大小限制')
with open(tmp_manifest, 'w', encoding='utf-8') as f:
    f.write(payload)
os.chmod(tmp_manifest, 0o600)
os.replace(tmp_manifest, manifest_path)
`
		if output, err := exec.CommandContext(ctx, "limactl", "shell", instanceName, "sudo", "python3", "-c", pyScript, b64Payload).CombinedOutput(); err != nil {
			if operationErr != nil {
				return deletedCount, fmt.Errorf("部分删除完成，但更新回收站索引失败: %v；索引错误: %s (%w)", operationErr, strings.TrimSpace(string(output)), err)
			}
			return deletedCount, fmt.Errorf("更新回收站索引失败: %s (%w)", strings.TrimSpace(string(output)), err)
		}
	}

	if operationErr != nil {
		return deletedCount, operationErr
	}
	return deletedCount, nil
}

// EmptyTrash moves all items in trash into Mac's ~/.Trash and clears /data/.trash
func EmptyTrash(instanceName string) (int, error) {
	return EmptyTrashContext(context.Background(), instanceName)
}

func EmptyTrashContext(ctx context.Context, instanceName string) (int, error) {
	trashOperationMu.Lock()
	defer trashOperationMu.Unlock()

	if instanceName == "" {
		instanceName = "macnas"
	}

	items, err := listTrashContext(ctx, instanceName)
	if err != nil {
		return 0, err
	}

	count := 0
	for _, it := range items {
		if err := deleteAndSendToMacTrashContext(ctx, instanceName, it); err != nil {
			return count, err
		}
		count++
	}

	cmd := exec.CommandContext(ctx, "limactl", "shell", instanceName, "sudo", "rm", "-rf", "/data/.trash")
	if err := cmd.Run(); err != nil {
		return count, fmt.Errorf("清空回收站失败: %w", err)
	}

	return count, nil
}

var rangeRegex = regexp.MustCompile(`^bytes=(\d*)-(\d*)$`)

func parseRange(rangeHeader string, fileSize int64) (int64, int64, bool) {
	matches := rangeRegex.FindStringSubmatch(rangeHeader)
	if len(matches) != 3 || fileSize <= 0 || (matches[1] == "" && matches[2] == "") {
		return 0, 0, false
	}
	if matches[1] == "" {
		suffix, err := strconv.ParseInt(matches[2], 10, 64)
		if err != nil || suffix <= 0 {
			return 0, 0, false
		}
		if suffix > fileSize {
			suffix = fileSize
		}
		return fileSize - suffix, fileSize - 1, true
	}
	start, err := strconv.ParseInt(matches[1], 10, 64)
	if err != nil || start < 0 || start >= fileSize {
		return 0, 0, false
	}
	end := fileSize - 1
	if matches[2] != "" {
		parsedEnd, err := strconv.ParseInt(matches[2], 10, 64)
		if err != nil || parsedEnd < start {
			return 0, 0, false
		}
		if parsedEnd < end {
			end = parsedEnd
		}
	}
	return start, end, true
}

// StreamMediaFile streams media files with HTTP 206 Range support for smooth video/audio playback
func StreamMediaFile(w http.ResponseWriter, r *http.Request, instanceName, filePath string) {
	if instanceName == "" {
		instanceName = "macnas"
	}
	var err error
	filePath, err = resolveAllowedPathContext(r.Context(), instanceName, filePath)
	if err != nil {
		log.Printf("[MacNAS Files] media path rejected: %v", err)
		http.Error(w, "文件路径不允许访问", http.StatusForbidden)
		return
	}
	fileName := path.Base(filePath)
	ext := strings.TrimPrefix(filepath.Ext(fileName), ".")

	// Get file size
	sizeCmd := exec.CommandContext(r.Context(), "limactl", "shell", instanceName, "stat", "-c", "%s", filePath)
	sizeOut, err := sizeCmd.Output()
	if err != nil {
		log.Printf("[MacNAS Files] read media size failed: %v", err)
		http.Error(w, "无法读取文件", http.StatusInternalServerError)
		return
	}
	fileSize, err := strconv.ParseInt(strings.TrimSpace(string(sizeOut)), 10, 64)
	if err != nil || fileSize < 0 {
		http.Error(w, "无法获取文件大小", http.StatusInternalServerError)
		return
	}

	mime := getMimeType(ext)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename*=UTF-8''%s", url.PathEscape(fileName)))

	rangeHeader := r.Header.Get("Range")
	if rangeHeader == "" || fileSize == 0 {
		// Full stream
		w.Header().Set("Content-Type", mime)
		w.Header().Set("Content-Length", strconv.FormatInt(fileSize, 10))

		cmd := exec.CommandContext(r.Context(), "limactl", "shell", instanceName, "cat", filePath)
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			log.Printf("[MacNAS Files] create media stream failed: %v", err)
			http.Error(w, "读取文件失败", http.StatusInternalServerError)
			return
		}
		if err := cmd.Start(); err != nil {
			log.Printf("[MacNAS Files] start media stream failed: %v", err)
			http.Error(w, "读取文件失败", http.StatusInternalServerError)
			return
		}
		defer func() {
			if waitErr := cmd.Wait(); waitErr != nil {
				log.Printf("[MacNAS Files] media command failed: %v", waitErr)
			}
		}()
		if _, err := io.Copy(w, stdout); err != nil {
			log.Printf("[MacNAS Files] stream media failed: %v", err)
		}
		return
	}

	// Partial content stream (HTTP 206)
	start, end, validRange := parseRange(rangeHeader, fileSize)
	if !validRange {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", fileSize))
		http.Error(w, "请求的字节范围无效", http.StatusRequestedRangeNotSatisfiable)
		return
	}
	length := end - start + 1

	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
	w.Header().Set("Content-Length", strconv.FormatInt(length, 10))
	w.WriteHeader(http.StatusPartialContent)

	pyScript := `import sys
file_path = sys.argv[1]
start = int(sys.argv[2])
length = int(sys.argv[3])
with open(file_path, 'rb') as f:
    f.seek(start)
    sys.stdout.buffer.write(f.read(length))`
	cmd := exec.CommandContext(r.Context(), "limactl", "shell", instanceName, "python3", "-c", pyScript,
		filePath, strconv.FormatInt(start, 10), strconv.FormatInt(length, 10))
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Printf("[MacNAS Files] create ranged media stream failed: %v", err)
		return
	}
	if err := cmd.Start(); err != nil {
		log.Printf("[MacNAS Files] start ranged media stream failed: %v", err)
		return
	}
	defer func() {
		if waitErr := cmd.Wait(); waitErr != nil {
			log.Printf("[MacNAS Files] ranged media command failed: %v", waitErr)
		}
	}()
	if _, err := io.Copy(w, stdout); err != nil {
		log.Printf("[MacNAS Files] stream ranged media failed: %v", err)
	}
}

func getMimeType(ext string) string {
	switch strings.ToLower(ext) {
	case "mp4":
		return "video/mp4"
	case "webm":
		return "video/webm"
	case "ogg":
		return "video/ogg"
	case "mkv":
		return "video/x-matroska"
	case "mov":
		return "video/quicktime"
	case "jpg", "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "gif":
		return "image/gif"
	case "webp":
		return "image/webp"
	case "svg":
		return "image/svg+xml"
	case "ico":
		return "image/x-icon"
	case "mp3":
		return "audio/mpeg"
	case "wav":
		return "audio/wav"
	case "flac":
		return "audio/flac"
	case "aac":
		return "audio/aac"
	case "m4a":
		return "audio/mp4"
	case "pdf":
		return "application/pdf"
	case "txt", "log", "md", "sh", "yaml", "yml", "json", "xml", "conf", "ini":
		return "text/plain; charset=utf-8"
	default:
		return "application/octet-stream"
	}
}
