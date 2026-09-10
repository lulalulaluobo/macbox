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

// DeletePath deletes file or folder inside VM safely
func DeletePath(instanceName, targetPath string) error {
	if instanceName == "" {
		instanceName = "macnas"
	}
	targetPath = path.Clean(targetPath)

	// Critical system protection
	if targetPath == "/" || targetPath == "/bin" || targetPath == "/boot" ||
		targetPath == "/dev" || targetPath == "/etc" || targetPath == "/lib" ||
		targetPath == "/proc" || targetPath == "/root" || targetPath == "/sys" ||
		targetPath == "/usr" || targetPath == "/var" {
		return fmt.Errorf("禁止删除系统保护目录: %s", targetPath)
	}

	cmd := exec.Command("limactl", "shell", instanceName, "rm", "-rf", targetPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("删除失败: %s (%w)", string(out), err)
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
	cmd := exec.Command("limactl", "shell", instanceName, "bash", "-c", fmt.Sprintf("cat > '%s'", destPath))
	cmd.Stdin = file

	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("上传文件写入失败: %s (%w)", errBuf.String(), err)
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

	if oldPath == "/" || oldPath == "/data" || oldPath == "/bin" || oldPath == "/etc" ||
		oldPath == "/usr" || oldPath == "/var" || oldPath == "/home" {
		return fmt.Errorf("禁止重命名系统核心目录: %s", oldPath)
	}
	if newPath == "" || newPath == "/" {
		return fmt.Errorf("无效的目标路径")
	}

	cmd := exec.Command("limactl", "shell", instanceName, "mv", oldPath, newPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("重命名失败: %s (%w)", string(out), err)
	}
	return nil
}

// StreamMediaFile streams media files directly for inline preview (video/image/audio)
func StreamMediaFile(w http.ResponseWriter, r *http.Request, instanceName, filePath string) {
	if instanceName == "" {
		instanceName = "macnas"
	}
	filePath = path.Clean(filePath)
	fileName := path.Base(filePath)
	ext := strings.TrimPrefix(filepath.Ext(fileName), ".")

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

	mime := getMimeType(ext)
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename*=UTF-8''%s", url.PathEscape(fileName)))
	w.Header().Set("Accept-Ranges", "bytes")

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
