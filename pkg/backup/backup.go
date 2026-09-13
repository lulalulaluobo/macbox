package backup

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/config"
)

const (
	FormatVersion             = 1
	MaxArchiveBytes           = 64 << 20
	MaxFileBytes              = 16 << 20
	MaxCustomAppsBytes        = 32 << 20
	ManifestEntryPath         = "manifest.json"
	ConfigEntryPath           = "config/config.yaml"
	UsersEntryPath            = "auth/users.json"
	TerminalSettingsEntryPath = "settings/terminal_settings.json"
	CustomAppsEntryPrefix     = "apps/custom_apps/"
)

// Manifest describes a configuration-only MacBox backup. It deliberately
// does not claim to include the VM, data disk, Docker runtime, or browser
// preferences.
type Manifest struct {
	FormatVersion int       `json:"formatVersion"`
	CreatedAt     time.Time `json:"createdAt"`
	Includes      []string  `json:"includes"`
	Warning       string    `json:"warning"`
}

type Archive struct {
	Manifest Manifest
	Files    map[string][]byte
}

func Create(w io.Writer) (Manifest, error) {
	if w == nil {
		return Manifest{}, errors.New("备份输出不可为空")
	}

	configDir, err := config.ConfigDir()
	if err != nil {
		return Manifest{}, fmt.Errorf("读取 MacBox 配置目录失败: %w", err)
	}
	appDir, err := ApplicationDataDir()
	if err != nil {
		return Manifest{}, err
	}

	files := make(map[string][]byte)
	readAndAdd := func(source, target string, required bool) error {
		data, err := readRegularFile(source, MaxFileBytes)
		if err != nil {
			if !required && os.IsNotExist(err) {
				return nil
			}
			return err
		}
		files[target] = data
		return nil
	}

	configFile := filepath.Join(configDir, "config.yaml")
	if err := readAndAdd(configFile, ConfigEntryPath, true); err != nil {
		return Manifest{}, fmt.Errorf("读取 MacBox 配置失败: %w", err)
	}
	if err := readAndAdd(filepath.Join(configDir, "users.json"), UsersEntryPath, true); err != nil {
		return Manifest{}, fmt.Errorf("读取 MacBox 用户数据失败: %w", err)
	}
	if err := readAndAdd(filepath.Join(configDir, "terminal_settings.json"), TerminalSettingsEntryPath, false); err != nil {
		return Manifest{}, fmt.Errorf("读取终端设置失败: %w", err)
	}

	customFiles, err := readCustomApps(filepath.Join(appDir, "custom_apps"))
	if err != nil {
		return Manifest{}, fmt.Errorf("读取自定义应用失败: %w", err)
	}
	for name, data := range customFiles {
		files[name] = data
	}
	var totalBytes int64
	for _, data := range files {
		totalBytes += int64(len(data))
		if totalBytes > MaxArchiveBytes {
			return Manifest{}, fmt.Errorf("备份内容超过大小限制")
		}
	}

	includeNames := make([]string, 0, len(files))
	for name := range files {
		includeNames = append(includeNames, name)
	}
	sort.Strings(includeNames)
	manifest := Manifest{
		FormatVersion: FormatVersion,
		CreatedAt:     time.Now().UTC(),
		Includes:      includeNames,
		Warning:       "此第一版备份未加密，请勿上传公网或分享给他人。数据盘、VM、Docker 数据和终端会话不在备份中。",
	}

	archive := zip.NewWriter(w)
	manifestData, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return Manifest{}, fmt.Errorf("生成备份清单失败: %w", err)
	}
	if err := writeZipFile(archive, ManifestEntryPath, manifestData); err != nil {
		return Manifest{}, err
	}
	for _, name := range includeNames {
		if err := writeZipFile(archive, name, files[name]); err != nil {
			return Manifest{}, err
		}
	}
	if err := archive.Close(); err != nil {
		return Manifest{}, fmt.Errorf("完成备份文件失败: %w", err)
	}
	return manifest, nil
}

func Read(data []byte) (*Archive, error) {
	if len(data) == 0 || len(data) > MaxArchiveBytes {
		return nil, fmt.Errorf("备份文件大小无效，最大支持 %d MB", MaxArchiveBytes>>20)
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("备份文件不是有效的 ZIP 格式: %w", err)
	}

	files := make(map[string][]byte)
	seenEntries := make(map[string]struct{})
	var total int64
	for _, entry := range reader.File {
		name := filepath.ToSlash(entry.Name)
		if entry.FileInfo().IsDir() {
			continue
		}
		if !validEntryName(name) {
			return nil, fmt.Errorf("备份包含非法路径: %s", entry.Name)
		}
		if _, exists := seenEntries[name]; exists {
			return nil, fmt.Errorf("备份包含重复文件: %s", name)
		}
		seenEntries[name] = struct{}{}
		if name != ManifestEntryPath && name != ConfigEntryPath && name != UsersEntryPath && name != TerminalSettingsEntryPath && !strings.HasPrefix(name, CustomAppsEntryPrefix) {
			return nil, fmt.Errorf("备份包含不支持的文件: %s", name)
		}
		limit := int64(MaxFileBytes)
		if strings.HasPrefix(name, CustomAppsEntryPrefix) {
			limit = MaxCustomAppsBytes
		}
		if entry.UncompressedSize64 > uint64(limit) {
			return nil, fmt.Errorf("备份文件 %s 超过大小限制", name)
		}
		total += int64(entry.UncompressedSize64)
		if total > MaxArchiveBytes {
			return nil, fmt.Errorf("备份内容超过大小限制")
		}
		file, err := entry.Open()
		if err != nil {
			return nil, fmt.Errorf("打开备份文件 %s 失败: %w", name, err)
		}
		content, readErr := io.ReadAll(io.LimitReader(file, limit+1))
		_ = file.Close()
		if readErr != nil {
			return nil, fmt.Errorf("读取备份文件 %s 失败: %w", name, readErr)
		}
		if int64(len(content)) > limit {
			return nil, fmt.Errorf("备份文件 %s 超过大小限制", name)
		}
		files[name] = content
	}

	manifestData, ok := files[ManifestEntryPath]
	if !ok {
		return nil, errors.New("备份缺少 manifest.json")
	}
	var manifest Manifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return nil, fmt.Errorf("备份清单无效: %w", err)
	}
	if manifest.FormatVersion != FormatVersion {
		return nil, fmt.Errorf("不支持的备份版本: %d", manifest.FormatVersion)
	}
	if _, ok := files[ConfigEntryPath]; !ok {
		return nil, errors.New("备份缺少系统配置")
	}
	if _, ok := files[UsersEntryPath]; !ok {
		return nil, errors.New("备份缺少用户数据")
	}
	return &Archive{Manifest: manifest, Files: files}, nil
}

// ApplicationDataDir is the host directory used by the current app manager
// for custom app definitions and the community catalog cache.
func ApplicationDataDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("读取用户目录失败: %w", err)
	}
	return filepath.Join(home, "Library", "Application Support", "MacBox"), nil
}

func readCustomApps(dir string) (map[string][]byte, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string][]byte{}, nil
		}
		return nil, err
	}
	result := make(map[string][]byte)
	var total int64
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("自定义应用 %s 不是普通文件", entry.Name())
		}
		data, err := readRegularFile(filepath.Join(dir, entry.Name()), MaxFileBytes)
		if err != nil {
			return nil, err
		}
		total += int64(len(data))
		if total > MaxCustomAppsBytes {
			return nil, fmt.Errorf("自定义应用备份超过 %d MB", MaxCustomAppsBytes>>20)
		}
		result[CustomAppsEntryPrefix+entry.Name()] = data
	}
	return result, nil
}

func readRegularFile(path string, maxBytes int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("文件不是普通文件: %s", path)
	}
	if info.Size() < 0 || info.Size() > maxBytes {
		return nil, fmt.Errorf("文件超过大小限制: %s", path)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("文件超过大小限制: %s", path)
	}
	return data, nil
}

func writeZipFile(archive *zip.Writer, name string, data []byte) error {
	header := &zip.FileHeader{Name: name, Method: zip.Deflate}
	header.SetMode(0600)
	writer, err := archive.CreateHeader(header)
	if err != nil {
		return fmt.Errorf("创建备份条目 %s 失败: %w", name, err)
	}
	if _, err := writer.Write(data); err != nil {
		return fmt.Errorf("写入备份条目 %s 失败: %w", name, err)
	}
	return nil
}

func validEntryName(name string) bool {
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, `\`) || filepath.Clean(name) != name {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}
