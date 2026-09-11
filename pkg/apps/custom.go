package apps

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"gopkg.in/yaml.v3"
)

type CustomAppRecord struct {
	Metadata AppMetadata `json:"metadata"`
	YAML     string      `json:"yaml"`
}

// CustomAppManager manages user-imported compose applications
type CustomAppManager struct {
	storageDir string
}

const maxCustomRecordBytes = maxComposeYAMLBytes + 1<<20

var generatedAppIDSanitizer = regexp.MustCompile(`[^a-z0-9_-]`)

func validateCustomAppText(field, value string, maxBytes int, required bool) error {
	value = strings.TrimSpace(value)
	if required && value == "" {
		return fmt.Errorf("%s 不能为空", field)
	}
	if len([]byte(value)) > maxBytes || strings.IndexFunc(value, unicode.IsControl) >= 0 {
		return fmt.Errorf("%s 过长或包含控制字符", field)
	}
	return nil
}

func NewCustomAppManager(dataDir string) *CustomAppManager {
	dir := filepath.Join(dataDir, "custom_apps")
	_ = os.MkdirAll(dir, 0700)
	_ = os.Chmod(dir, 0700)
	return &CustomAppManager{
		storageDir: dir,
	}
}

func (cm *CustomAppManager) List() ([]CustomAppRecord, error) {
	files, err := os.ReadDir(cm.storageDir)
	if err != nil {
		return nil, err
	}

	var results []CustomAppRecord
	var listErrors []error
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".json") || strings.HasPrefix(f.Name(), ".") {
			continue
		}
		filePath := filepath.Join(cm.storageDir, f.Name())
		info, err := f.Info()
		if err != nil {
			listErrors = append(listErrors, fmt.Errorf("读取自定义应用文件 %s 元数据失败: %w", f.Name(), err))
			continue
		}
		if f.Type()&os.ModeSymlink != 0 || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			listErrors = append(listErrors, fmt.Errorf("自定义应用文件 %s 不是普通文件", f.Name()))
			continue
		}
		if info.Size() < 0 || info.Size() > maxCustomRecordBytes {
			listErrors = append(listErrors, fmt.Errorf("自定义应用文件 %s 超过大小限制", f.Name()))
			continue
		}
		data, err := os.ReadFile(filePath)
		if err != nil {
			listErrors = append(listErrors, fmt.Errorf("读取自定义应用文件 %s 失败: %w", f.Name(), err))
			continue
		}
		var rec CustomAppRecord
		if err := json.Unmarshal(data, &rec); err != nil {
			listErrors = append(listErrors, fmt.Errorf("解析自定义应用文件 %s 失败: %w", f.Name(), err))
			continue
		}
		if !validAppID.MatchString(rec.Metadata.ID) || len([]byte(rec.YAML)) > maxComposeYAMLBytes {
			listErrors = append(listErrors, fmt.Errorf("自定义应用文件 %s 内容不合规", f.Name()))
			continue
		}
		rec.Metadata.Source = "custom"
		results = append(results, rec)
	}
	return results, errors.Join(listErrors...)
}

func (cm *CustomAppManager) Save(input CustomAppInput) (*AppMetadata, error) {
	rawID := strings.ToLower(strings.TrimSpace(input.ID))
	id := rawID
	if id == "" {
		// Generate id from name
		id = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(input.Name), " ", "-"))
		id = generatedAppIDSanitizer.ReplaceAllString(id, "")
	} else if !validAppID.MatchString(id) {
		return nil, fmt.Errorf("应用标识格式无效")
	}
	if !validAppID.MatchString(id) {
		return nil, fmt.Errorf("应用标识格式无效")
	}
	if err := validateCustomAppText("应用名称", input.Name, 256, true); err != nil {
		return nil, err
	}
	if err := validateCustomAppText("应用描述", input.Description, 2048, false); err != nil {
		return nil, err
	}
	if err := validateCustomAppText("应用分类", input.Category, 128, false); err != nil {
		return nil, err
	}
	if err := validateCustomAppText("应用图标", input.Icon, 128, false); err != nil {
		return nil, err
	}
	if input.Port < 0 || input.Port > 65535 {
		return nil, fmt.Errorf("应用端口无效: %d", input.Port)
	}

	composeYAML := strings.TrimSpace(input.ComposeYAML)
	if composeYAML == "" {
		return nil, fmt.Errorf("Docker Compose YAML 内容不能为空")
	}
	if len([]byte(composeYAML)) > maxComposeYAMLBytes {
		return nil, fmt.Errorf("Docker Compose YAML 内容不能超过 8 MB")
	}
	var composeDocument struct {
		Services map[string]yaml.Node `yaml:"services"`
	}
	if err := yaml.Unmarshal([]byte(composeYAML), &composeDocument); err != nil {
		return nil, fmt.Errorf("Docker Compose YAML 格式无效: %w", err)
	}
	if len(composeDocument.Services) == 0 {
		return nil, fmt.Errorf("Docker Compose YAML 缺少 services")
	}

	// Parse ports, volumes, env from yaml if not provided
	parsedPorts, parsedVolumes, parsedEnv := parseComposeYaml(composeYAML)

	mainPort := input.Port
	if mainPort <= 0 && len(parsedPorts) > 0 {
		mainPort = parsedPorts[0].HostPort
	}
	if mainPort < 0 || mainPort > 65535 {
		return nil, fmt.Errorf("应用端口无效: %d", mainPort)
	}
	for _, port := range parsedPorts {
		if port.HostPort < 1 || port.HostPort > 65535 || port.ContainerPort < 1 || port.ContainerPort > 65535 {
			return nil, fmt.Errorf("Compose 端口映射无效")
		}
	}

	category := input.Category
	if category == "" {
		category = "我的自定义"
	}

	icon := input.Icon
	if icon == "" {
		icon = "box"
	}

	meta := AppMetadata{
		ID:              id,
		Name:            input.Name,
		Description:     input.Description,
		Version:         "custom",
		Icon:            icon,
		Category:        category,
		Port:            mainPort,
		Ports:           parsedPorts,
		Volumes:         parsedVolumes,
		Env:             parsedEnv,
		Source:          "custom",
		ComposeTemplate: composeYAML,
	}

	rec := CustomAppRecord{
		Metadata: meta,
		YAML:     composeYAML,
	}

	data, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return nil, err
	}

	filePath := filepath.Join(cm.storageDir, fmt.Sprintf("%s.json", id))
	tmpFile, err := os.CreateTemp(cm.storageDir, ".custom-app-*.json")
	if err != nil {
		return nil, err
	}
	tmpPath := tmpFile.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if err := tmpFile.Chmod(0600); err != nil {
		_ = tmpFile.Close()
		return nil, err
	}
	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		return nil, err
	}
	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		return nil, err
	}
	if err := tmpFile.Close(); err != nil {
		return nil, err
	}
	if err := os.Rename(tmpPath, filePath); err != nil {
		return nil, err
	}
	if err := os.Chmod(filePath, 0600); err != nil {
		return nil, err
	}

	return &meta, nil
}

func (cm *CustomAppManager) Delete(id string) error {
	id = strings.ToLower(strings.TrimSpace(id))
	if !validAppID.MatchString(id) {
		return fmt.Errorf("应用标识格式无效")
	}
	filePath := filepath.Join(cm.storageDir, fmt.Sprintf("%s.json", id))
	return os.Remove(filePath)
}

func (cm *CustomAppManager) Get(id string) (*CustomAppRecord, error) {
	id = strings.ToLower(strings.TrimSpace(id))
	if !validAppID.MatchString(id) {
		return nil, fmt.Errorf("应用标识格式无效")
	}
	filePath := filepath.Join(cm.storageDir, fmt.Sprintf("%s.json", id))
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	var rec CustomAppRecord
	if err := json.Unmarshal(data, &rec); err != nil {
		return nil, err
	}
	return &rec, nil
}

// Simple heuristic parser for ports, volumes, and environment from Compose YAML
func parseComposeYaml(yamlStr string) ([]AppPort, []AppVolume, []AppEnv) {
	var ports []AppPort
	var volumes []AppVolume
	var envs []AppEnv

	lines := strings.Split(yamlStr, "\n")
	mode := ""

	portRegex := regexp.MustCompile(`["']?(\d+):(\d+)(?:/(\w+))?["']?`)
	volRegex := regexp.MustCompile(`["']?([^:"']+):([^:"']+)(?::([a-z,]+))?["']?`)
	envRegex := regexp.MustCompile(`["']?([A-Za-z0-9_]+)=([^"']*)["']?`)

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "ports:") {
			mode = "ports"
			continue
		} else if strings.HasPrefix(trimmed, "volumes:") {
			mode = "volumes"
			continue
		} else if strings.HasPrefix(trimmed, "environment:") {
			mode = "environment"
			continue
		} else if !strings.HasPrefix(trimmed, "-") && !strings.HasPrefix(trimmed, "#") && strings.HasSuffix(trimmed, ":") {
			mode = ""
		}

		if mode == "ports" && strings.HasPrefix(trimmed, "-") {
			item := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
			matches := portRegex.FindStringSubmatch(item)
			if len(matches) >= 3 {
				hPort, _ := strconv.Atoi(matches[1])
				cPort, _ := strconv.Atoi(matches[2])
				proto := matches[3]
				if proto == "" {
					proto = "tcp"
				}
				ports = append(ports, AppPort{
					HostPort:      hPort,
					ContainerPort: cPort,
					Protocol:      proto,
					Description:   fmt.Sprintf("端口 %d 映射", cPort),
				})
			}
		} else if mode == "volumes" && strings.HasPrefix(trimmed, "-") {
			item := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
			matches := volRegex.FindStringSubmatch(item)
			if len(matches) >= 3 {
				volumes = append(volumes, AppVolume{
					Host:        matches[1],
					Container:   matches[2],
					Description: fmt.Sprintf("挂载至 %s", matches[2]),
				})
			}
		} else if mode == "environment" && strings.HasPrefix(trimmed, "-") {
			item := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
			matches := envRegex.FindStringSubmatch(item)
			if len(matches) >= 3 {
				envs = append(envs, AppEnv{
					Key:         matches[1],
					Value:       matches[2],
					Description: matches[1],
				})
			}
		}
	}

	return ports, volumes, envs
}
