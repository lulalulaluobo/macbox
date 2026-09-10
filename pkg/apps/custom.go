package apps

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type CustomAppRecord struct {
	Metadata AppMetadata `json:"metadata"`
	YAML     string      `json:"yaml"`
}

// CustomAppManager manages user-imported compose applications
type CustomAppManager struct {
	storageDir string
}

func NewCustomAppManager(dataDir string) *CustomAppManager {
	dir := filepath.Join(dataDir, "custom_apps")
	_ = os.MkdirAll(dir, 0755)
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
	for _, f := range files {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".json") {
			path := filepath.Join(cm.storageDir, f.Name())
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			var rec CustomAppRecord
			if err := json.Unmarshal(data, &rec); err == nil {
				rec.Metadata.Source = "custom"
				results = append(results, rec)
			}
		}
	}
	return results, nil
}

func (cm *CustomAppManager) Save(input CustomAppInput) (*AppMetadata, error) {
	id := strings.ToLower(strings.TrimSpace(input.ID))
	if id == "" {
		// Generate id from name
		id = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(input.Name), " ", "-"))
	}
	id = regexp.MustCompile(`[^a-z0-9_-]`).ReplaceAllString(id, "")
	if id == "" {
		return nil, fmt.Errorf("应用标识 ID 不能为空")
	}

	if strings.TrimSpace(input.ComposeYAML) == "" {
		return nil, fmt.Errorf("Docker Compose YAML 内容不能为空")
	}

	// Parse ports, volumes, env from yaml if not provided
	parsedPorts, parsedVolumes, parsedEnv := parseComposeYaml(input.ComposeYAML)

	mainPort := input.Port
	if mainPort <= 0 && len(parsedPorts) > 0 {
		mainPort = parsedPorts[0].HostPort
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
		ComposeTemplate: input.ComposeYAML,
	}

	rec := CustomAppRecord{
		Metadata: meta,
		YAML:     input.ComposeYAML,
	}

	data, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return nil, err
	}

	filePath := filepath.Join(cm.storageDir, fmt.Sprintf("%s.json", id))
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return nil, err
	}

	return &meta, nil
}

func (cm *CustomAppManager) Delete(id string) error {
	filePath := filepath.Join(cm.storageDir, fmt.Sprintf("%s.json", id))
	return os.Remove(filePath)
}

func (cm *CustomAppManager) Get(id string) (*CustomAppRecord, error) {
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
