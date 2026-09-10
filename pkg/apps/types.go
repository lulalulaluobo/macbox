package apps

type AppPort struct {
	HostPort      int    `json:"hostPort"`
	ContainerPort int    `json:"containerPort"`
	Protocol      string `json:"protocol"`
	Description   string `json:"description"`
}

type AppVolume struct {
	Host        string `json:"host"`
	Container   string `json:"container"`
	Description string `json:"description"`
}

type AppEnv struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Description string `json:"description"`
}

type AppMetadata struct {
	ID              string      `json:"id"`
	Name            string      `json:"name"`
	Description     string      `json:"description"`
	Version         string      `json:"version"`
	Icon            string      `json:"icon"`
	Category        string      `json:"category"`
	Port            int         `json:"port"`
	WebURL          string      `json:"webUrl"`
	Ports           []AppPort   `json:"ports"`
	Volumes         []AppVolume `json:"volumes"`
	Env             []AppEnv    `json:"env"`
	Status          string      `json:"status"` // "not_installed", "running", "stopped", "error"
	Installed       bool        `json:"installed"`
	Source          string      `json:"source"` // "builtin", "community", "custom"
	ComposeTemplate string      `json:"composeTemplate,omitempty"`
}

type InstallCustomConfig struct {
	PortsMap   map[string]int    `json:"portsMap"`   // containerPort (str) -> hostPort (int)
	VolumesMap map[string]string `json:"volumesMap"` // containerPath -> hostPath
	EnvMap     map[string]string `json:"envMap"`     // envKey -> envVal
	CustomYaml string            `json:"customYaml"` // optional directly edited YAML
}

type CustomAppInput struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Icon        string `json:"icon"`
	Port        int    `json:"port"`
	ComposeYAML string `json:"composeYaml"`
}
