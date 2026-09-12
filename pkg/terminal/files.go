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
	items, _, err := ListFilesPageContext(ctx, instanceName, targetPath, 0, 10000)
	return items, err
}

// ListFilesPageContext bounds command output and memory use for very large
// directories. The VM still sorts one directory snapshot for deterministic
// paging, but only the requested window crosses the process boundary.
func ListFilesPageContext(ctx context.Context, instanceName, targetPath string, offset, limit int) ([]FileInfo, bool, error) {
	if instanceName == "" {
		instanceName = "macnas"
	}
	if targetPath == "" {
		targetPath = "/data"
	}
	displayPath, err := normalizeRequestedPath(targetPath)
	if err != nil {
		return nil, false, err
	}
	resolvedPath, err := resolveAllowedPathContext(ctx, instanceName, displayPath)
	if err != nil {
		return nil, false, err
	}
	if offset < 0 {
		offset = 0
	}
	if limit < 1 || limit > 500 {
		limit = 300
	}

	pyScript := fmt.Sprintf(`
import os, json, sys, time
p = os.path.realpath(sys.argv[1] if len(sys.argv) > 1 else "/data")
fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
items = []
try:
    with os.scandir(fd) as it:
        for entry in it:
            try:
                st = entry.stat(follow_symlinks=False)
                items.append({
                    "name": entry.name,
                    # Make standard VM links such as /bin and /lib
                    # navigable in the root browser. The resolver still
                    # canonicalizes every child and keeps /data links from
                    # escaping the NAS data root.
                    "isDir": entry.is_dir(follow_symlinks=True),
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
finally:
    os.close(fd)
items.sort(key=lambda x: (not x["isDir"], x["name"].lower()))
offset = int(sys.argv[2])
limit = int(sys.argv[3])
print(json.dumps({"items": items[offset:offset + limit], "hasMore": offset + limit < len(items)}))
`)

	cmd := privilegedCommand(ctx, instanceName, "python3", "-c", pyScript, resolvedPath, strconv.Itoa(offset), strconv.Itoa(limit))
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, false, fmt.Errorf("读取目录失败: %s (%w)", strings.TrimSpace(string(out)), err)
	}

	var pageResult struct {
		Items []struct {
			Name      string `json:"name"`
			IsDir     bool   `json:"isDir"`
			IsSymlink bool   `json:"isSymlink"`
			Size      int64  `json:"size"`
			Mode      string `json:"mode"`
			Mtime     int64  `json:"mtime"`
		} `json:"items"`
		HasMore bool `json:"hasMore"`
	}

	if err := json.Unmarshal(out, &pageResult); err != nil {
		return nil, false, fmt.Errorf("解析目录数据失败: %w", err)
	}

	var items []FileInfo
	for _, raw := range pageResult.Items {
		fullPath := path.Join(displayPath, raw.Name)
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

	return items, pageResult.HasMore, nil
}

const safeReadScript = `import json, os, shutil, stat, sys
raw = sys.argv[1]
mode = sys.argv[2]
candidate = os.path.realpath(raw)
if not os.path.isabs(candidate) or candidate == '/':
    raise RuntimeError('目标不是可读取的文件')
parts = [part for part in candidate.split(os.sep) if part]
parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    for component in parts[:-1]:
        next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        os.close(parent)
        parent = next_fd
    fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        info = os.fstat(fd)
        if mode == 'stat':
            print(info.st_size)
        elif mode == 'info':
            print(json.dumps({'size': info.st_size, 'isDir': stat.S_ISDIR(info.st_mode)}))
        else:
            start = int(sys.argv[3])
            length = int(sys.argv[4])
            os.lseek(fd, start, os.SEEK_SET)
            with os.fdopen(fd, 'rb', closefd=False) as source:
                if length < 0:
                    shutil.copyfileobj(source, sys.stdout.buffer)
                else:
                    remaining = length
                    while remaining > 0:
                        chunk = source.read(min(1024 * 1024, remaining))
                        if not chunk: break
                        sys.stdout.buffer.write(chunk)
                        remaining -= len(chunk)
    finally:
        os.close(fd)
finally:
    os.close(parent)
`

func safeReadCommand(ctx context.Context, instanceName, filePath, mode string, start, length int64) *exec.Cmd {
	return privilegedCommand(ctx, instanceName, "python3", "-c", safeReadScript,
		filePath, mode, strconv.FormatInt(start, 10), strconv.FormatInt(length, 10))
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

	cmd := safeReadCommand(ctx, instanceName, filePath, "read", 0, 524288)
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

	err = runSafeMutation(ctx, instanceName, map[string]string{"operation": "write", "path": filePath}, strings.NewReader(content))
	if err != nil {
		return fmt.Errorf("写入文件失败: %w", err)
	}
	return nil
}

// WriteStreamContext writes a potentially large stream atomically inside the
// VM. The caller owns the reader and may wrap it to report transfer progress.
func WriteStreamContext(ctx context.Context, instanceName, filePath string, input io.Reader) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	if input == nil {
		return fmt.Errorf("写入内容不能为空")
	}
	resolved, err := resolveAllowedPathContext(ctx, instanceName, filePath)
	if err != nil {
		return err
	}
	if err := runSafeMutation(ctx, instanceName, map[string]string{"operation": "write", "path": resolved}, input); err != nil {
		return fmt.Errorf("写入文件失败: %w", err)
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

	if err := runSafeMutation(ctx, instanceName, map[string]string{"operation": "mkdir", "path": dirPath}, nil); err != nil {
		return fmt.Errorf("创建文件夹失败: %w", err)
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

requested = os.path.normpath(sys.argv[1])
candidate = os.path.realpath(requested)
if not os.path.isabs(candidate):
    raise SystemExit(2)
data_root = os.path.realpath('/data')
if requested == '/data' or requested.startswith('/data/'):
    try:
        if os.path.commonpath((data_root, candidate)) != data_root:
            raise SystemExit(2)
    except ValueError:
        raise SystemExit(2)
print(candidate)
`

const safeMutationScript = `import base64, json, os, shutil, stat, sys, time

request = json.loads(base64.b64decode(sys.argv[1]).decode('utf-8'))
root_path = os.path.realpath('/data')
root_fd = os.open(root_path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)

def parts_for(raw, allow_root=False):
    clean = os.path.normpath(raw)
    candidate = os.path.realpath(clean)
    if os.path.commonpath((root_path, candidate)) != root_path:
        raise RuntimeError('路径超出 /data 存储范围')
    relative = os.path.relpath(candidate, root_path)
    if relative == '.':
        if allow_root:
            return []
        raise RuntimeError('禁止操作存储根目录')
    parts = relative.split(os.sep)
    if any(part in ('', '.', '..') for part in parts):
        raise RuntimeError('路径格式无效')
    return parts

def open_dir(parts, create=False):
    fd = os.dup(root_fd)
    try:
        for part in parts:
            if create:
                try:
                    os.mkdir(part, 0o755, dir_fd=fd)
                except FileExistsError:
                    pass
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd
    except Exception:
        os.close(fd)
        raise

def open_parent(raw):
    parts = parts_for(raw)
    return open_dir(parts[:-1]), parts[-1]

def path_exists(parent_fd, name):
    try:
        os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        return True
    except FileNotFoundError:
        return False

def remove_entry(parent_fd, name):
    info = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    if stat.S_ISDIR(info.st_mode):
        shutil.rmtree(name, dir_fd=parent_fd)
    else:
        os.unlink(name, dir_fd=parent_fd)

def unique_name(parent_fd, name):
    stem, extension = os.path.splitext(name)
    index = 1
    while True:
        candidate = f'{stem} ({index}){extension}'
        if not path_exists(parent_fd, candidate):
            return candidate
        index += 1

def prepare_destination(parent_fd, name):
    policy = request.get('conflictPolicy', 'error')
    if policy not in ('error', 'overwrite', 'rename', 'skip'):
        raise RuntimeError('同名冲突策略无效')
    if not path_exists(parent_fd, name):
        return name
    if policy == 'skip':
        return None
    if policy == 'rename':
        return unique_name(parent_fd, name)
    if policy == 'overwrite':
        remove_entry(parent_fd, name)
        return name
    raise RuntimeError(f'目标中已存在同名项目: {name}')

operation = request['operation']
if operation == 'delete':
    parent_fd, name = open_parent(request['path'])
    try:
        info = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if stat.S_ISDIR(info.st_mode):
            shutil.rmtree(name, dir_fd=parent_fd)
        else:
            os.unlink(name, dir_fd=parent_fd)
    finally:
        os.close(parent_fd)
elif operation in ('rename', 'move'):
    source_fd, source_name = open_parent(request['source'])
    if operation == 'move':
        destination_fd = open_dir(parts_for(request['destination'], allow_root=True))
        destination_name = prepare_destination(destination_fd, source_name)
    else:
        destination_fd, destination_name = open_parent(request['destination'])
    try:
        if destination_name is None:
            raise SystemExit(0)
        os.rename(source_name, destination_name, src_dir_fd=source_fd, dst_dir_fd=destination_fd)
    finally:
        os.close(source_fd)
        os.close(destination_fd)
elif operation == 'mkdir':
    directory_fd = open_dir(parts_for(request['path']), create=True)
    os.close(directory_fd)
elif operation == 'write':
    parent_fd, name = open_parent(request['path'])
    temp_name = '.macnas-write-' + str(os.getpid()) + '-' + str(time.time_ns())
    try:
        fd = os.open(temp_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent_fd)
        try:
            with os.fdopen(fd, 'wb', closefd=True) as output:
                shutil.copyfileobj(sys.stdin.buffer, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temp_name, name, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        except Exception:
            try: os.unlink(temp_name, dir_fd=parent_fd)
            except FileNotFoundError: pass
            raise
    finally:
        os.close(parent_fd)
elif operation == 'copy':
    source_fd, source_name = open_parent(request['source'])
    destination_fd = open_dir(parts_for(request['destination'], allow_root=True))
    source_path = f'/proc/self/fd/{source_fd}/{source_name}'
    try:
        info = os.stat(source_name, dir_fd=source_fd, follow_symlinks=False)
        if stat.S_ISLNK(info.st_mode):
            raise RuntimeError('不允许复制符号链接')
        destination_name = prepare_destination(destination_fd, source_name)
        if destination_name is None:
            raise SystemExit(0)
        destination_path = f'/proc/self/fd/{destination_fd}/{destination_name}'
        if stat.S_ISDIR(info.st_mode):
            shutil.copytree(source_path, destination_path, symlinks=True)
        else:
            shutil.copy2(source_path, destination_path, follow_symlinks=False)
    finally:
        os.close(source_fd)
        os.close(destination_fd)
else:
    raise RuntimeError('不支持的文件操作')
`

func runSafeMutation(ctx context.Context, instanceName string, request map[string]string, input io.Reader) error {
	payload, err := json.Marshal(request)
	if err != nil {
		return err
	}
	encoded := base64.StdEncoding.EncodeToString(payload)
	cmd := privilegedCommand(ctx, instanceName, "python3", "-c", safeMutationScript, encoded)
	cmd.Stdin = input
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s (%w)", strings.TrimSpace(output.String()), err)
	}
	return nil
}

// resolveAllowedPath validates and canonicalizes an absolute path inside the
// VM. The API layer limits non-admin callers to /data; this lower-level helper
// also serves the admin-only VM root browser.
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

	cmd := privilegedCommand(ctx, instanceName, "python3", "-c", allowedPathResolverScript, clean)
	resolved, err := cmd.Output()
	if err != nil || strings.TrimSpace(string(resolved)) == "" {
		detail := strings.TrimSpace(string(resolved))
		if exitErr, ok := err.(*exec.ExitError); ok {
			detail = strings.TrimSpace(string(exitErr.Stderr))
		}
		if detail == "" {
			detail = "虚拟机路径解析命令未返回结果"
		}
		return "", fmt.Errorf("虚拟机路径解析失败: %s", detail)
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

// DeletePath deletes a file or folder directly inside the VM. The caller uses
// MoveToTrash when a recoverable deletion is desired.
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

	err = runSafeMutation(ctx, instanceName, map[string]string{"operation": "delete", "path": targetPath}, nil)
	if err != nil {
		errMsg := err.Error()
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
	if path.Clean(filePath) == "/" {
		// The VM root is available for browsing, but downloading it would
		// recursively archive the whole system filesystem.
		http.Error(w, "禁止下载虚拟机根目录", http.StatusForbidden)
		return
	}
	fileName := path.Base(filePath)

	// Preflight the file before committing the HTTP response. Without a known
	// length, a VM-side read failure after headers were sent can look like a
	// successful zero-byte download in mobile browsers.
	infoCmd := safeReadCommand(r.Context(), instanceName, filePath, "info", 0, 0)
	infoOut, err := infoCmd.Output()
	if err != nil {
		log.Printf("[MacNAS Files] read download metadata failed: %v", err)
		http.Error(w, "无法读取文件", http.StatusInternalServerError)
		return
	}
	var fileInfo struct {
		Size  int64 `json:"size"`
		IsDir bool  `json:"isDir"`
	}
	if err := json.Unmarshal(infoOut, &fileInfo); err != nil || fileInfo.Size < 0 {
		log.Printf("[MacNAS Files] invalid download metadata for %s: %q", filePath, strings.TrimSpace(string(infoOut)))
		http.Error(w, "无法获取文件大小", http.StatusInternalServerError)
		return
	}
	if fileInfo.IsDir {
		cmd := privilegedCommand(r.Context(), instanceName, "python3", "-c", zipDirectoryStreamScript, filePath)
		streamCommandDownload(w, cmd, fileName+".zip", "application/zip", -1)
		return
	}

	cmd := safeReadCommand(r.Context(), instanceName, filePath, "read", 0, -1)
	streamCommandDownload(w, cmd, fileName, "application/octet-stream", fileInfo.Size)
}

// DownloadPathsAsZip streams a selected set of files and folders as one ZIP.
// The archive is created inside the VM process and never materialized on the
// NAS data disk, which avoids the previous 0 KB browser download failure and
// keeps batch downloads from triggering multiple-download blocking.
func DownloadPathsAsZip(w http.ResponseWriter, r *http.Request, instanceName string, requestedPaths []string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	if len(requestedPaths) == 0 || len(requestedPaths) > 100 {
		return fmt.Errorf("一次最多下载 100 个项目")
	}
	resolved := make([]string, 0, len(requestedPaths))
	for _, requested := range requestedPaths {
		filePath, err := resolveAllowedPathContext(r.Context(), instanceName, requested)
		if err != nil {
			return fmt.Errorf("下载路径无效: %w", err)
		}
		if path.Clean(filePath) == "/" || path.Clean(filePath) == "/data" {
			return fmt.Errorf("禁止下载虚拟机或存储根目录")
		}
		resolved = append(resolved, filePath)
	}
	cmd := privilegedCommand(r.Context(), instanceName, append([]string{"python3", "-c", zipSelectedPathsStreamScript}, resolved...)...)
	streamCommandDownload(w, cmd, "MacNAS-批量下载.zip", "application/zip", -1)
	return nil
}

// streamCommandDownload streams command output only after the first chunk has
// been read. This prevents clients from saving a successful-looking empty
// file when a VM-side command failed before producing data.
func streamCommandDownload(w http.ResponseWriter, cmd *exec.Cmd, fileName, contentType string, fileSize int64) {
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
	waited := false
	defer func() {
		if !waited {
			if waitErr := cmd.Wait(); waitErr != nil {
				log.Printf("[MacNAS Files] download command failed: %v", waitErr)
			}
		}
	}()

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(fileName)))
	w.Header().Set("Content-Type", contentType)
	if fileSize >= 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(fileSize, 10))
	}

	if fileSize == 0 {
		return
	}

	// Read a first chunk before writing headers. If the VM command cannot read
	// the file, return an HTTP error instead of creating an empty download.
	first := make([]byte, 32*1024)
	n, readErr := stdout.Read(first)
	for n == 0 && readErr == nil {
		n, readErr = stdout.Read(first)
	}
	if n == 0 {
		waitErr := cmd.Wait()
		waited = true
		if waitErr != nil {
			log.Printf("[MacNAS Files] download preflight failed: %v", waitErr)
		} else {
			log.Printf("[MacNAS Files] download preflight returned no data for %s", fileName)
		}
		http.Error(w, "读取文件内容失败", http.StatusInternalServerError)
		return
	}

	if _, err := w.Write(first[:n]); err != nil {
		log.Printf("[MacNAS Files] write download preflight failed: %v", err)
		return
	}

	if _, err := io.Copy(w, stdout); err != nil {
		log.Printf("[MacNAS Files] stream download failed: %v", err)
	}
}

const zipDirectoryStreamScript = `import os, stat, sys, zipfile

root = os.path.realpath('/data')
directory = os.path.realpath(sys.argv[1])
if os.path.commonpath((root, directory)) != root or directory == root:
    raise RuntimeError('文件夹路径超出 /data 存储范围')
if not os.path.isdir(directory) or os.path.islink(directory):
    raise RuntimeError('下载目标不是有效文件夹')

archive_name = os.path.basename(directory.rstrip(os.sep))
with zipfile.ZipFile(sys.stdout.buffer, 'w', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
    for current, directories, files in os.walk(directory, topdown=True, followlinks=False):
        directories[:] = sorted(name for name in directories if not os.path.islink(os.path.join(current, name)))
        files = sorted(files)
        relative = os.path.relpath(current, directory)
        prefix = archive_name if relative == '.' else archive_name + '/' + relative.replace(os.sep, '/')
        if not directories and not files:
            archive.writestr(prefix.rstrip('/') + '/', b'')
        for name in files:
            source = os.path.join(current, name)
            try:
                info = os.lstat(source)
            except OSError:
                continue
            if not stat.S_ISREG(info.st_mode):
                continue
            archive.write(source, prefix + '/' + name)
`

const zipSelectedPathsStreamScript = `import os, stat, sys, zipfile

root = os.path.realpath('/data')
sources = [os.path.realpath(value) for value in sys.argv[1:]]
if not sources or len(sources) > 100:
    raise RuntimeError('批量下载项目数量无效')

def inside(candidate):
    try:
        return os.path.commonpath((root, candidate)) == root
    except ValueError:
        return False

def add_tree(archive, source, archive_name):
    if os.path.isdir(source) and not os.path.islink(source):
        for current, directories, files in os.walk(source, topdown=True, followlinks=False):
            directories[:] = sorted(name for name in directories if not os.path.islink(os.path.join(current, name)))
            files = sorted(files)
            relative = os.path.relpath(current, source)
            prefix = archive_name if relative == '.' else archive_name + '/' + relative.replace(os.sep, '/')
            if not directories and not files:
                archive.writestr(prefix.rstrip('/') + '/', b'')
            for name in files:
                source_file = os.path.join(current, name)
                info = os.lstat(source_file)
                if stat.S_ISREG(info.st_mode):
                    archive.write(source_file, prefix + '/' + name)
    else:
        info = os.lstat(source)
        if not stat.S_ISREG(info.st_mode):
            raise RuntimeError('不支持下载符号链接或特殊文件')
        archive.write(source, archive_name)

used = set()
with zipfile.ZipFile(sys.stdout.buffer, 'w', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
    for source in sources:
        if not inside(source) or source == root or not os.path.lexists(source):
            raise RuntimeError('下载路径无效')
        name = os.path.basename(source.rstrip(os.sep))
        original = name
        index = 1
        while name in used:
            name = f'{original} ({index})'
            index += 1
        used.add(name)
        add_tree(archive, source, name)
`

const archiveZipScript = `import os, shutil, stat, sys, zipfile

operation = sys.argv[1]
destination = os.path.realpath(sys.argv[2])
conflict_policy = sys.argv[3]
sources = [os.path.realpath(value) for value in sys.argv[4:]]
root = os.path.realpath('/data')

def inside(base, candidate):
    try:
        return os.path.commonpath((base, candidate)) == base
    except ValueError:
        return False

if not inside(root, destination) or destination == root:
    raise RuntimeError('目标路径超出 /data 存储范围')
if not sources:
    raise RuntimeError('未指定源文件')
for source in sources:
    if not inside(root, source) or source == root or not os.path.lexists(source):
        raise RuntimeError('源文件路径无效')

def remove_path(target):
    if os.path.isdir(target) and not os.path.islink(target):
        shutil.rmtree(target)
    else:
        os.unlink(target)

def unique_path(target):
    parent = os.path.dirname(target)
    name = os.path.basename(target)
    stem, extension = os.path.splitext(name)
    index = 1
    while True:
        candidate = os.path.join(parent, f'{stem} ({index}){extension}')
        if not os.path.lexists(candidate):
            return candidate
        index += 1

if operation == 'compress':
    if os.path.lexists(destination):
        if conflict_policy == 'overwrite':
            remove_path(destination)
        elif conflict_policy == 'rename':
            destination = unique_path(destination)
        elif conflict_policy == 'skip':
            raise SystemExit(0)
        else:
            raise RuntimeError('目标压缩包已存在，请选择覆盖、自动改名或跳过')
    if any(destination == source or inside(source, destination) for source in sources if os.path.isdir(source)):
        raise RuntimeError('压缩包不能创建在待压缩文件夹内部')
    os.makedirs(os.path.dirname(destination), exist_ok=True)
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        for source in sources:
            base = os.path.basename(source.rstrip(os.sep))
            if os.path.isdir(source) and not os.path.islink(source):
                for current, directories, files in os.walk(source, topdown=True, followlinks=False):
                    directories[:] = sorted(name for name in directories if not os.path.islink(os.path.join(current, name)))
                    files = sorted(files)
                    relative = os.path.relpath(current, source)
                    prefix = base if relative == '.' else base + '/' + relative.replace(os.sep, '/')
                    if not directories and not files:
                        archive.writestr(prefix.rstrip('/') + '/', b'')
                    for name in files:
                        source_file = os.path.join(current, name)
                        try:
                            info = os.lstat(source_file)
                        except OSError:
                            continue
                        if stat.S_ISREG(info.st_mode):
                            archive.write(source_file, prefix + '/' + name)
            else:
                info = os.lstat(source)
                if not stat.S_ISREG(info.st_mode):
                    raise RuntimeError('不支持压缩符号链接或特殊文件')
                archive.write(source, base)
elif operation == 'extract':
    if len(sources) != 1 or not os.path.isfile(sources[0]):
        raise RuntimeError('解压需要一个有效的 ZIP 文件')
    os.makedirs(destination, exist_ok=True)
    with zipfile.ZipFile(sources[0], 'r') as archive:
        for entry in archive.infolist():
            name = entry.filename.replace('\\', '/')
            if not name or name.startswith('/') or name == '..' or name.startswith('../') or '/../' in name:
                raise RuntimeError('压缩包包含不安全路径')
            target = os.path.realpath(os.path.join(destination, name))
            if not inside(destination, target):
                raise RuntimeError('压缩包路径超出目标目录')
            mode = (entry.external_attr >> 16) & 0o170000
            if stat.S_ISLNK(mode):
                raise RuntimeError('压缩包包含不安全符号链接')
            if entry.is_dir() or name.endswith('/'):
                if os.path.lexists(target):
                    if os.path.islink(target):
                        raise RuntimeError('解压目标包含不安全符号链接')
                    if not os.path.isdir(target):
                        if conflict_policy == 'overwrite':
                            remove_path(target)
                        elif conflict_policy == 'rename':
                            target = unique_path(target)
                        elif conflict_policy == 'skip':
                            continue
                        else:
                            raise RuntimeError('解压目标存在同名文件')
                os.makedirs(target, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if os.path.lexists(target):
                if conflict_policy == 'overwrite':
                    remove_path(target)
                elif conflict_policy == 'rename':
                    target = unique_path(target)
                elif conflict_policy == 'skip':
                    continue
                else:
                    raise RuntimeError('解压目标存在同名文件')
            with archive.open(entry, 'r') as source, open(target, 'wb') as output:
                shutil.copyfileobj(source, output)
else:
    raise RuntimeError('不支持的压缩操作')
`

// External archive tools are run inside a temporary directory and their
// output is copied into the requested destination only after the extracted
// tree has been checked. The tool switches also disable symbolic-link
// extraction where supported. This keeps 7z/RAR subject to the same policy as
// the built-in ZIP implementation instead of trusting a tool's defaults.
const archiveExternalExtractScript = `import os, shutil, stat, subprocess, sys, tempfile

tool = sys.argv[1]
archive = os.path.realpath(sys.argv[2])
destination = os.path.realpath(sys.argv[3])
conflict_policy = sys.argv[4]
if not os.path.isfile(archive):
    raise RuntimeError('压缩包不存在')
if not os.path.isdir(destination):
    os.makedirs(destination, exist_ok=True)
if os.path.islink(destination):
    raise RuntimeError('解压目标不能是符号链接')

temporary = tempfile.mkdtemp(prefix='.macnas-archive-', dir=destination)
try:
    if tool in ('unrar', 'rar'):
        command = [tool, 'x', '-o+', '-ol-', archive, temporary + os.sep]
    else:
        command = [tool, 'x', '-y', '-snld', '-o' + temporary, archive]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    root = os.path.realpath(temporary)
    def inside_root(candidate):
        try:
            return os.path.commonpath((root, os.path.realpath(candidate))) == root
        except ValueError:
            return False

    def validate_tree(current):
        if not inside_root(current):
            raise RuntimeError('解压结果超出临时目录')
        for entry in os.scandir(current):
            info = os.lstat(entry.path)
            if stat.S_ISLNK(info.st_mode):
                raise RuntimeError('压缩包包含不安全符号链接')
            if stat.S_ISDIR(info.st_mode):
                validate_tree(entry.path)
            elif not stat.S_ISREG(info.st_mode):
                raise RuntimeError('压缩包包含不支持的特殊文件')

    def remove_path(target):
        if os.path.isdir(target) and not os.path.islink(target):
            shutil.rmtree(target)
        else:
            os.unlink(target)

    def unique_path(target):
        parent = os.path.dirname(target)
        name = os.path.basename(target)
        stem, extension = os.path.splitext(name)
        index = 1
        while True:
            candidate = os.path.join(parent, f'{stem} ({index}){extension}')
            if not os.path.lexists(candidate):
                return candidate
            index += 1

    def merge_tree(source, target):
        for entry in os.scandir(source):
            destination_path = os.path.join(target, entry.name)
            if os.path.lexists(destination_path) and os.path.islink(destination_path):
                raise RuntimeError('解压目标包含不安全符号链接')
            info = os.lstat(entry.path)
            if stat.S_ISDIR(info.st_mode):
                if os.path.lexists(destination_path):
                    if not os.path.isdir(destination_path) or os.path.islink(destination_path):
                        if conflict_policy == 'overwrite':
                            remove_path(destination_path)
                        elif conflict_policy == 'rename':
                            destination_path = unique_path(destination_path)
                        elif conflict_policy == 'skip':
                            continue
                        else:
                            raise RuntimeError('解压目标存在同名非目录')
                    elif conflict_policy == 'skip':
                        continue
                else:
                    os.mkdir(destination_path, 0o755)
                merge_tree(entry.path, destination_path)
            elif stat.S_ISREG(info.st_mode):
                if os.path.lexists(destination_path) and os.path.isdir(destination_path):
                    if conflict_policy == 'overwrite':
                        remove_path(destination_path)
                    elif conflict_policy == 'rename':
                        destination_path = unique_path(destination_path)
                    elif conflict_policy == 'skip':
                        continue
                    else:
                        raise RuntimeError('解压目标存在同名目录')
                elif os.path.lexists(destination_path):
                    if conflict_policy == 'overwrite':
                        remove_path(destination_path)
                    elif conflict_policy == 'rename':
                        destination_path = unique_path(destination_path)
                    elif conflict_policy == 'skip':
                        continue
                    else:
                        raise RuntimeError('解压目标存在同名文件')
                fd = os.open(destination_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o644)
                try:
                    with os.fdopen(fd, 'wb', closefd=True) as output, open(entry.path, 'rb') as source:
                        shutil.copyfileobj(source, output)
                        output.flush()
                        os.fsync(output.fileno())
                except Exception:
                    try: os.close(fd)
                    except OSError: pass
                    raise
            else:
                raise RuntimeError('压缩包包含不支持的特殊文件')

    validate_tree(temporary)
    merge_tree(temporary, destination)
finally:
    shutil.rmtree(temporary, ignore_errors=True)
`

const prepareArchiveDestinationScript = `import os, shutil, sys

destination = os.path.realpath(sys.argv[1])
policy = sys.argv[2]
root = os.path.realpath('/data')
if os.path.commonpath((root, destination)) != root or destination == root:
    raise RuntimeError('目标路径超出 /data 存储范围')
if policy not in ('error', 'overwrite', 'rename', 'skip'):
    raise RuntimeError('同名冲突策略无效')

def remove_path(target):
    if os.path.isdir(target) and not os.path.islink(target):
        shutil.rmtree(target)
    else:
        os.unlink(target)

if os.path.lexists(destination):
    if policy == 'overwrite':
        remove_path(destination)
    elif policy == 'rename':
        parent = os.path.dirname(destination)
        name = os.path.basename(destination)
        stem, extension = os.path.splitext(name)
        index = 1
        while True:
            candidate = os.path.join(parent, f'{stem} ({index}){extension}')
            if not os.path.lexists(candidate):
                destination = candidate
                break
            index += 1
    elif policy == 'skip':
        print('SKIP')
        raise SystemExit(0)
    else:
        raise RuntimeError('目标压缩包已存在，请选择覆盖、自动改名或跳过')
print(destination)
`

const maxArchiveListingBytes = 8 << 20

type boundedArchiveOutput struct {
	mu        sync.Mutex
	buffer    bytes.Buffer
	remaining int
	exceeded  bool
}

func (w *boundedArchiveOutput) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.remaining <= 0 {
		w.exceeded = true
		return len(p), nil
	}
	if len(p) > w.remaining {
		_, _ = w.buffer.Write(p[:w.remaining])
		w.remaining = 0
		w.exceeded = true
		return len(p), nil
	}
	_, _ = w.buffer.Write(p)
	w.remaining -= len(p)
	return len(p), nil
}

func validateArchiveEntryName(raw string) error {
	name := strings.ReplaceAll(raw, `\`, "/")
	if name == "" || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return fmt.Errorf("压缩包包含非法文件名")
	}
	if strings.HasPrefix(name, "/") || (len(name) >= 2 && name[1] == ':') {
		return fmt.Errorf("压缩包包含绝对路径")
	}
	for _, part := range strings.Split(name, "/") {
		if part == ".." {
			return fmt.Errorf("压缩包包含父目录跳转")
		}
	}
	return nil
}

func validateSevenZipListing(output string) error {
	inEntries := false
	sawEntry := false
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSuffix(line, "\r")
		if strings.TrimSpace(line) == "----------" {
			inEntries = true
			continue
		}
		if !inEntries || line == "" {
			continue
		}
		key, value, ok := strings.Cut(line, " = ")
		if !ok {
			return fmt.Errorf("7z 目录清单格式无效")
		}
		switch key {
		case "Path":
			sawEntry = true
			if err := validateArchiveEntryName(value); err != nil {
				return err
			}
		case "Attributes":
			if strings.Contains(strings.ToLower(value), "l") {
				return fmt.Errorf("压缩包包含不安全符号链接")
			}
		}
	}
	if !sawEntry {
		return fmt.Errorf("7z 目录清单为空或格式无效")
	}
	return nil
}

func validateRarListing(output string) error {
	sawEntry := false
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSuffix(line, "\r")
		if line == "" {
			continue
		}
		sawEntry = true
		if err := validateArchiveEntryName(line); err != nil {
			return err
		}
	}
	if !sawEntry {
		return fmt.Errorf("RAR 目录清单为空或格式无效")
	}
	return nil
}

func validateExternalArchive(ctx context.Context, instanceName, tool, archivePath string) error {
	var args []string
	if tool == "7z" || tool == "7zz" {
		args = []string{tool, "l", "-slt", archivePath}
	} else {
		args = []string{tool, "lb", "-idq", archivePath}
	}
	cmd := privilegedCommand(ctx, instanceName, args...)
	output := &boundedArchiveOutput{remaining: maxArchiveListingBytes}
	cmd.Stdout = output
	cmd.Stderr = output
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("无法读取压缩包目录清单")
	}
	if output.exceeded {
		return fmt.Errorf("压缩包目录清单过大，已拒绝处理")
	}
	if tool == "7z" || tool == "7zz" {
		return validateSevenZipListing(output.buffer.String())
	}
	return validateRarListing(output.buffer.String())
}

// ArchivePathsContext creates or extracts an archive inside the VM data root.
// ZIP is built in with Python's standard library; 7z and RAR use native VM
// tools when available and return an actionable error when they are absent.
func ArchivePathsContext(ctx context.Context, instanceName, operation, format, destination string, sourcePaths []string) error {
	return ArchivePathsWithPolicyContext(ctx, instanceName, operation, format, destination, sourcePaths, "error")
}

func ArchivePathsWithPolicyContext(ctx context.Context, instanceName, operation, format, destination string, sourcePaths []string, conflictPolicy string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	operation = strings.ToLower(strings.TrimSpace(operation))
	format = strings.ToLower(strings.TrimPrefix(strings.TrimSpace(format), "."))
	if operation != "compress" && operation != "extract" {
		return fmt.Errorf("不支持的压缩操作")
	}
	if conflictPolicy != "error" && conflictPolicy != "overwrite" && conflictPolicy != "rename" && conflictPolicy != "skip" {
		return fmt.Errorf("同名冲突策略无效")
	}
	if format != "zip" {
		return fmt.Errorf("目前仅支持 ZIP 压缩格式")
	}
	if len(sourcePaths) == 0 || len(sourcePaths) > 100 {
		return fmt.Errorf("源文件数量必须在 1 到 100 个之间")
	}
	if operation == "extract" && len(sourcePaths) != 1 {
		return fmt.Errorf("一次只能解压一个压缩包")
	}

	resolvedDestination, err := resolveAllowedPathContext(ctx, instanceName, destination)
	if err != nil {
		return fmt.Errorf("目标路径无效: %w", err)
	}
	resolvedSources := make([]string, 0, len(sourcePaths))
	for _, source := range sourcePaths {
		resolved, resolveErr := resolveAllowedPathContext(ctx, instanceName, source)
		if resolveErr != nil {
			return fmt.Errorf("源路径无效: %w", resolveErr)
		}
		if path.Clean(resolved) == "/data" {
			return fmt.Errorf("禁止处理存储根目录")
		}
		resolvedSources = append(resolvedSources, resolved)
	}

	if format == "zip" {
		args := []string{"python3", "-c", archiveZipScript, operation, resolvedDestination, conflictPolicy}
		args = append(args, resolvedSources...)
		cmd := privilegedCommand(ctx, instanceName, args...)
		output, runErr := cmd.CombinedOutput()
		if runErr != nil {
			return fmt.Errorf("ZIP %s失败: %s (%w)", archiveOperationLabel(operation), strings.TrimSpace(string(output)), runErr)
		}
		return nil
	}

	tool, err := findArchiveTool(ctx, instanceName, operation, format)
	if err != nil {
		return err
	}
	if operation == "extract" {
		if err := validateExternalArchive(ctx, instanceName, tool, resolvedSources[0]); err != nil {
			return fmt.Errorf("%s 解压前安全检查失败: %w", strings.ToUpper(format), err)
		}
		cmd := privilegedCommand(ctx, instanceName, "python3", "-c", archiveExternalExtractScript, tool, resolvedSources[0], resolvedDestination, conflictPolicy)
		output, runErr := cmd.CombinedOutput()
		if runErr != nil {
			return fmt.Errorf("%s 解压失败: %s (%w)", strings.ToUpper(format), strings.TrimSpace(string(output)), runErr)
		}
		return nil
	}
	preparedDestination, skipped, prepareErr := prepareExternalArchiveDestination(ctx, instanceName, resolvedDestination, conflictPolicy)
	if prepareErr != nil {
		return prepareErr
	}
	if skipped {
		return nil
	}
	args := archiveToolArgs(tool, operation, format, preparedDestination, resolvedSources)
	cmd := privilegedCommand(ctx, instanceName, args...)
	output, runErr := cmd.CombinedOutput()
	if runErr != nil {
		return fmt.Errorf("%s %s失败: %s (%w)", strings.ToUpper(format), archiveOperationLabel(operation), strings.TrimSpace(string(output)), runErr)
	}
	return nil
}

func prepareExternalArchiveDestination(ctx context.Context, instanceName, destination, conflictPolicy string) (string, bool, error) {
	cmd := privilegedCommand(ctx, instanceName, "python3", "-c", prepareArchiveDestinationScript, destination, conflictPolicy)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", false, fmt.Errorf("准备压缩包目标失败: %s (%w)", strings.TrimSpace(string(output)), err)
	}
	resolved := strings.TrimSpace(string(output))
	if resolved == "SKIP" {
		return "", true, nil
	}
	if resolved == "" {
		return "", false, fmt.Errorf("准备压缩包目标失败: 未返回目标路径")
	}
	return resolved, false, nil
}

// ArchiveCapabilities reports which optional VM-side tools are available.
func ArchiveCapabilitiesContext(ctx context.Context, instanceName string) map[string]bool {
	if instanceName == "" {
		instanceName = "macnas"
	}
	capabilities := map[string]bool{"zip": true, "sevenZip": false, "rarExtract": false, "rarCompress": false}
	if _, err := findArchiveTool(ctx, instanceName, "compress", "7z"); err == nil {
		capabilities["sevenZip"] = true
	}
	if _, err := findArchiveTool(ctx, instanceName, "extract", "rar"); err == nil {
		capabilities["rarExtract"] = true
	}
	if _, err := findArchiveTool(ctx, instanceName, "compress", "rar"); err == nil {
		capabilities["rarCompress"] = true
	}
	return capabilities
}

func archiveOperationLabel(operation string) string {
	if operation == "extract" {
		return "解压"
	}
	return "压缩"
}

func findArchiveTool(ctx context.Context, instanceName, operation, format string) (string, error) {
	candidates := []string{}
	switch {
	case format == "7z":
		candidates = []string{"7z", "7zz"}
	case format == "rar" && operation == "extract":
		// Prefer 7z for RAR extraction because its structured -slt listing
		// lets us validate entry names and link attributes without parsing a
		// human-oriented listing.
		candidates = []string{"7z", "7zz", "unrar", "rar"}
	case format == "rar":
		candidates = []string{"rar"}
	}
	for _, candidate := range candidates {
		cmd := managementCommand(ctx, instanceName, "sh", "-lc", "command -v -- \"$1\"", "macnas-archive-tool", candidate)
		if output, err := cmd.Output(); err == nil && strings.TrimSpace(string(output)) != "" {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("虚拟机未安装 %s 工具，当前可直接使用 ZIP；请在虚拟机中安装 7zip/unrar 后重试", strings.ToUpper(format))
}

func archiveToolArgs(tool, operation, format, destination string, sources []string) []string {
	if operation == "extract" {
		if format == "rar" && tool != "7z" && tool != "7zz" {
			return []string{tool, "x", "-o+", "-ol-", sources[0], destination + "/"}
		}
		return []string{tool, "x", "-y", "-snld", "-o" + destination, sources[0]}
	}
	if format == "7z" {
		return append([]string{tool, "a", "-y", "-t7z", destination}, sources...)
	}
	return append([]string{tool, "a", "-r", destination}, sources...)
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
		if cleanupErr := runSafeMutation(cleanupCtx, instanceName, map[string]string{"operation": "delete", "path": tempPath}, nil); cleanupErr != nil {
			log.Printf("[MacNAS Files] cleanup interrupted upload failed: %v", cleanupErr)
		}
	}
	defer cleanup()

	stream := &uploadPartReader{reader: file}
	if err := runSafeMutation(r.Context(), instanceName, map[string]string{"operation": "write", "path": tempPath}, stream); err != nil {
		if stream.err != nil {
			return uploadStreamError(stream.err)
		}
		errMsg := err.Error()
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
	if err := runSafeMutation(r.Context(), instanceName, map[string]string{"operation": "rename", "source": tempPath, "destination": destPath}, nil); err != nil {
		return fmt.Errorf("提交上传文件失败: %w", err)
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

	err = runSafeMutation(ctx, instanceName, map[string]string{"operation": "rename", "source": oldPath, "destination": newPath}, nil)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "Read-only file system") {
			return fmt.Errorf("当前目录处于只读保护模式 (Read-only)，禁止修改名称。请前往【存储设置】将该直通目录切换为【允许读写】")
		}
		return fmt.Errorf("重命名失败: %s (%w)", errMsg, err)
	}
	return nil
}

// CopyPaths copies multiple files or directories to destination directory
func CopyPaths(instanceName string, srcPaths []string, destDir string) error {
	return CopyPathsWithPolicyContext(context.Background(), instanceName, srcPaths, destDir, "error")
}

func CopyPathsContext(ctx context.Context, instanceName string, srcPaths []string, destDir string) error {
	return CopyPathsWithPolicyContext(ctx, instanceName, srcPaths, destDir, "error")
}

func CopyPathsWithPolicyContext(ctx context.Context, instanceName string, srcPaths []string, destDir, conflictPolicy string) error {
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
		err = runSafeMutation(ctx, instanceName, map[string]string{"operation": "copy", "source": src, "destination": destDir, "conflictPolicy": conflictPolicy}, nil)
		if err != nil {
			errMsg := err.Error()
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
	return MovePathsWithPolicyContext(context.Background(), instanceName, srcPaths, destDir, "error")
}

func MovePathsContext(ctx context.Context, instanceName string, srcPaths []string, destDir string) error {
	return MovePathsWithPolicyContext(ctx, instanceName, srcPaths, destDir, "error")
}

func MovePathsWithPolicyContext(ctx context.Context, instanceName string, srcPaths []string, destDir, conflictPolicy string) error {
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
		err = runSafeMutation(ctx, instanceName, map[string]string{"operation": "move", "source": src, "destination": destDir, "conflictPolicy": conflictPolicy}, nil)
		if err != nil {
			errMsg := err.Error()
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
	// TrashItem stores the public /data path, while the resolver returns the
	// VM's canonical path (for example /mnt/lima-macnas-data/.trash/...).
	// Validate both forms so the canonical-path security check does not reject
	// every legitimate item and a symlink cannot escape the trash directory.
	requestedTrashPath, err := normalizeRequestedPath(item.TrashPath)
	if err != nil || !strings.HasPrefix(requestedTrashPath, "/data/.trash/") {
		return fmt.Errorf("回收站项目路径无效")
	}
	trashPath, err := resolveAllowedPathContext(ctx, instanceName, requestedTrashPath)
	if err != nil {
		return fmt.Errorf("回收站项目路径无效")
	}
	trashRoot, err := resolveAllowedPathContext(ctx, instanceName, "/data/.trash")
	if err != nil || trashPath == trashRoot || !strings.HasPrefix(trashPath, trashRoot+"/") {
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

	// Remove through an anchored directory descriptor so a concurrent symlink
	// replacement cannot redirect deletion outside the trash directory.
	if err := runSafeMutation(ctx, instanceName, map[string]string{"operation": "delete", "path": trashPath}, nil); err != nil {
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

	if err := runSafeMutation(ctx, instanceName, map[string]string{"operation": "delete", "path": "/data/.trash"}, nil); err != nil {
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
	sizeCmd := safeReadCommand(r.Context(), instanceName, filePath, "stat", 0, 0)
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

		cmd := safeReadCommand(r.Context(), instanceName, filePath, "read", 0, -1)
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

	cmd := safeReadCommand(r.Context(), instanceName, filePath, "read", start, length)
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
