package terminal

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
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
	if instanceName == "" {
		instanceName = "macnas"
	}
	if targetPath == "" {
		targetPath = "/data"
	}
	targetPath = path.Clean(targetPath)

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
    items = []
items.sort(key=lambda x: (not x["isDir"], x["name"].lower()))
print(json.dumps(items))
`)

	cmd := exec.Command("limactl", "shell", instanceName, "python3", "-c", pyScript, targetPath)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("读取目录失败: %w", err)
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
	if instanceName == "" {
		instanceName = "macnas"
	}
	filePath = path.Clean(filePath)

	cmd := exec.Command("limactl", "shell", instanceName, "head", "-c", "524288", filePath)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("读取文件失败: %w", err)
	}
	return string(out), nil
}

// WriteFile writes text content to file inside the VM via base64 pipe
func WriteFile(instanceName, filePath, content string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	filePath = path.Clean(filePath)

	b64 := base64.StdEncoding.EncodeToString([]byte(content))
	script := fmt.Sprintf("echo '%s' | base64 -d > %s", b64, filePath)

	cmd := exec.Command("limactl", "shell", instanceName, "bash", "-c", script)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("写入文件失败: %s (%w)", string(out), err)
	}
	return nil
}

// CreateDir creates directory inside VM
func CreateDir(instanceName, dirPath string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	dirPath = path.Clean(dirPath)

	cmd := exec.Command("limactl", "shell", instanceName, "mkdir", "-p", dirPath)
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

func isSystemProtectedDir(p string) bool {
	p = path.Clean(p)
	return p == "/" || p == "/data" || p == "/bin" || p == "/boot" ||
		p == "/dev" || p == "/etc" || p == "/lib" || p == "/proc" ||
		p == "/root" || p == "/sys" || p == "/usr" || p == "/var" || p == "/home"
}

// DeletePath deletes file or folder inside VM safely
func DeletePath(instanceName, targetPath string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	targetPath = path.Clean(targetPath)

	if isSystemProtectedDir(targetPath) {
		return fmt.Errorf("禁止删除系统保护目录: %s", targetPath)
	}

	cmd := exec.Command("limactl", "shell", instanceName, "sudo", "rm", "-rf", targetPath)
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
	filePath = path.Clean(filePath)
	fileName := path.Base(filePath)

	cmd := exec.Command("limactl", "shell", instanceName, "cat", filePath)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := cmd.Start(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer func() {
		_ = cmd.Wait()
	}()

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.PathEscape(fileName)))
	w.Header().Set("Content-Type", "application/octet-stream")

	_, _ = io.Copy(w, stdout)
}

// UploadFile saves a multipart uploaded file into target directory inside the VM
func UploadFile(w http.ResponseWriter, r *http.Request, instanceName, targetDir string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	if targetDir == "" {
		targetDir = "/data"
	}
	targetDir = path.Clean(targetDir)

	file, header, err := r.FormFile("file")
	if err != nil {
		return fmt.Errorf("获取上传文件失败: %w", err)
	}
	defer file.Close()

	destPath := path.Join(targetDir, header.Filename)
	cmd := exec.Command("limactl", "shell", instanceName, "sudo", "bash", "-c", fmt.Sprintf("cat > '%s'", destPath))
	cmd.Stdin = file

	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf

	if err := cmd.Run(); err != nil {
		errMsg := errBuf.String()
		if strings.Contains(errMsg, "Read-only file system") {
			return fmt.Errorf("当前目录处于只读保护模式 (Read-only)，禁止上传文件")
		}
		return fmt.Errorf("上传文件写入失败: %s (%w)", errMsg, err)
	}
	return nil
}

// RenamePath renames or moves a file or folder inside the VM
func RenamePath(instanceName, oldPath, newPath string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	oldPath = path.Clean(oldPath)
	newPath = path.Clean(newPath)

	if isSystemProtectedDir(oldPath) {
		return fmt.Errorf("禁止重命名系统核心目录: %s", oldPath)
	}
	if newPath == "" || newPath == "/" {
		return fmt.Errorf("无效的目标路径")
	}

	cmd := exec.Command("limactl", "shell", instanceName, "sudo", "mv", oldPath, newPath)
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
	if instanceName == "" {
		instanceName = "macnas"
	}
	destDir = path.Clean(destDir)
	for _, src := range srcPaths {
		src = path.Clean(src)
		cmd := exec.Command("limactl", "shell", instanceName, "sudo", "cp", "-r", src, destDir+"/")
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
	if instanceName == "" {
		instanceName = "macnas"
	}
	destDir = path.Clean(destDir)
	for _, src := range srcPaths {
		src = path.Clean(src)
		if isSystemProtectedDir(src) {
			return fmt.Errorf("禁止移动系统核心目录: %s", src)
		}
		cmd := exec.Command("limactl", "shell", instanceName, "sudo", "mv", src, destDir+"/")
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
	if instanceName == "" {
		instanceName = "macnas"
	}

	var validPaths []string
	for _, p := range targetPaths {
		p = path.Clean(p)
		if isSystemProtectedDir(p) {
			return fmt.Errorf("禁止移入回收站: 系统保护目录 %s", p)
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

	pyScript := fmt.Sprintf(`python3 -c "
import os, sys, json, shutil, time, base64

paths = json.loads(base64.b64decode('%s').decode('utf-8'))
trash_dir = '/data/.trash'
os.makedirs(trash_dir, exist_ok=True)
manifest_path = os.path.join(trash_dir, '.manifest.json')

manifest = []
if os.path.exists(manifest_path):
    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)
    except Exception:
        manifest = []

now = int(time.time())
for idx, p in enumerate(paths):
    if not os.path.exists(p):
        continue
    is_dir = os.path.isdir(p)
    size = 0
    if not is_dir:
        try:
            size = os.path.getsize(p)
        except Exception:
            pass
    base_name = os.path.basename(p)
    item_id = f'{now}_{idx}_{base_name}'
    target_trash_path = os.path.join(trash_dir, item_id)
    shutil.move(p, target_trash_path)
    manifest.append({
        'id': item_id,
        'name': base_name,
        'originalPath': p,
        'trashPath': target_trash_path,
        'isDir': is_dir,
        'size': size,
        'deletedAt': now,
    })

with open(manifest_path, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
"`, b64Payload)

	cmd := exec.Command("limactl", "shell", instanceName, "sudo", "bash", "-c", pyScript)
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
	if instanceName == "" {
		instanceName = "macnas"
	}

	pyScript := `python3 -c "
import os, sys, json, time

manifest_path = '/data/.trash/.manifest.json'
if not os.path.exists(manifest_path):
    print('[]')
    sys.exit(0)

try:
    with open(manifest_path, 'r', encoding='utf-8') as f:
        items = json.load(f)
    valid = []
    for it in items:
        if os.path.exists(it.get('trashPath', '')):
            valid.append(it)
    print(json.dumps(valid, ensure_ascii=False))
except Exception as e:
    print('[]')
"`
	cmd := exec.Command("limactl", "shell", instanceName, "sudo", "bash", "-c", pyScript)
	out, err := cmd.Output()
	if err != nil {
		return []TrashItem{}, nil
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
		return []TrashItem{}, nil
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
	if instanceName == "" {
		instanceName = "macnas"
	}

	idsJSON, err := json.Marshal(itemIDs)
	if err != nil {
		return err
	}
	b64Payload := base64.StdEncoding.EncodeToString(idsJSON)

	pyScript := fmt.Sprintf(`python3 -c "
import os, sys, json, shutil, base64

ids = set(json.loads(base64.b64decode('%s').decode('utf-8')))
manifest_path = '/data/.trash/.manifest.json'
if not os.path.exists(manifest_path):
    sys.exit(0)

try:
    with open(manifest_path, 'r', encoding='utf-8') as f:
        items = json.load(f)
except Exception:
    items = []

remaining = []
for it in items:
    if it.get('id') in ids or it.get('name') in ids:
        orig = it.get('originalPath')
        trash = it.get('trashPath')
        if os.path.exists(trash):
            os.makedirs(os.path.dirname(orig), exist_ok=True)
            shutil.move(trash, orig)
    else:
        remaining.append(it)

with open(manifest_path, 'w', encoding='utf-8') as f:
    json.dump(remaining, f, ensure_ascii=False, indent=2)
"`, b64Payload)

	cmd := exec.Command("limactl", "shell", instanceName, "sudo", "bash", "-c", pyScript)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("还原失败: %s (%w)", string(out), err)
	}
	return nil
}

// EmptyTrash permanently deletes all items in trash
func EmptyTrash(instanceName string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	cmd := exec.Command("limactl", "shell", instanceName, "sudo", "rm", "-rf", "/data/.trash")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("清空回收站失败: %s (%w)", string(out), err)
	}
	return nil
}

var rangeRegex = regexp.MustCompile(`bytes=(\d+)-(\d*)`)

func parseRange(rangeHeader string, fileSize int64) (int64, int64) {
	matches := rangeRegex.FindStringSubmatch(rangeHeader)
	if len(matches) < 2 {
		return 0, fileSize - 1
	}
	start, _ := strconv.ParseInt(matches[1], 10, 64)
	if start >= fileSize {
		start = fileSize - 1
	}
	if start < 0 {
		start = 0
	}
	end := fileSize - 1
	if len(matches) >= 3 && matches[2] != "" {
		if parsedEnd, err := strconv.ParseInt(matches[2], 10, 64); err == nil && parsedEnd < fileSize {
			end = parsedEnd
		}
	}
	if end < start {
		end = start
	}
	return start, end
}

// StreamMediaFile streams media files with HTTP 206 Range support for smooth video/audio playback
func StreamMediaFile(w http.ResponseWriter, r *http.Request, instanceName, filePath string) {
	if instanceName == "" {
		instanceName = "macnas"
	}
	filePath = path.Clean(filePath)
	fileName := path.Base(filePath)
	ext := strings.TrimPrefix(filepath.Ext(fileName), ".")

	// Get file size
	sizeCmd := exec.Command("limactl", "shell", instanceName, "stat", "-c", "%s", filePath)
	sizeOut, err := sizeCmd.Output()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	fileSize, _ := strconv.ParseInt(strings.TrimSpace(string(sizeOut)), 10, 64)

	mime := getMimeType(ext)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename*=UTF-8''%s", url.PathEscape(fileName)))

	rangeHeader := r.Header.Get("Range")
	if rangeHeader == "" || fileSize == 0 {
		// Full stream
		w.Header().Set("Content-Type", mime)
		w.Header().Set("Content-Length", strconv.FormatInt(fileSize, 10))

		cmd := exec.Command("limactl", "shell", instanceName, "cat", filePath)
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := cmd.Start(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer cmd.Wait()
		_, _ = io.Copy(w, stdout)
		return
	}

	// Partial content stream (HTTP 206)
	start, end := parseRange(rangeHeader, fileSize)
	length := end - start + 1

	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
	w.Header().Set("Content-Length", strconv.FormatInt(length, 10))
	w.WriteHeader(http.StatusPartialContent)

	pyScript := fmt.Sprintf("python3 -c \"import sys; f=open('%s','rb'); f.seek(%d); sys.stdout.buffer.write(f.read(%d))\"", filePath, start, length)
	cmd := exec.Command("limactl", "shell", instanceName, "bash", "-c", pyScript)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return
	}
	if err := cmd.Start(); err != nil {
		return
	}
	defer cmd.Wait()
	_, _ = io.Copy(w, stdout)
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
