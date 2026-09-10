package docker

// PortMapping represents an exposed container port and its host binding
type PortMapping struct {
	HostIP        string `json:"hostIp"`
	HostPort      int    `json:"hostPort"`
	ContainerPort int    `json:"containerPort"`
	Protocol      string `json:"protocol"`
}

// ContainerInfo represents detailed information about a container
type ContainerInfo struct {
	ID         string        `json:"id"`
	Names      string        `json:"name"`
	Image      string        `json:"image"`
	State      string        `json:"state"` // "running", "exited", "created", etc.
	Status     string        `json:"status"`
	Ports      string        `json:"ports"`
	PortsMap   []PortMapping `json:"portsMap"`
	CreatedAt  string        `json:"createdAt"`
	CPUPerc    string        `json:"cpuPerc"`    // e.g. "0.50%"
	MemUsage   string        `json:"memUsage"`   // e.g. "45.2MiB / 2GiB"
	MemPerc    string        `json:"memPerc"`    // e.g. "2.25%"
	NetIO      string        `json:"netIo"`      // e.g. "12KB / 45KB"
	BlockIO    string        `json:"blockIo"`    // e.g. "1.2MB / 50KB"
	Project    string        `json:"project"`    // compose project name if any
}

// ImageInfo represents a local docker image
type ImageInfo struct {
	ID           string `json:"id"`
	Repository   string `json:"repository"`
	Tag          string `json:"tag"`
	Size         string `json:"size"`
	SizeBytes    int64  `json:"sizeBytes"`
	CreatedAt    string `json:"createdAt"`
	CreatedSince string `json:"createdSince"`
	Containers   int    `json:"containers"`
	InUse        bool   `json:"inUse"`
}

// ComposeProject represents a docker compose application/project
type ComposeProject struct {
	Name          string   `json:"name"`
	Status        string   `json:"status"` // "running", "partially_running", "stopped"
	ConfigFiles   string   `json:"configFiles"`
	WorkingDir    string   `json:"workingDir"`
	ServicesCount int      `json:"servicesCount"`
	Containers    []string `json:"containers"`
	IsSystemApp   bool     `json:"isSystemApp"` // true if managed by MacNAS App Store
}

// DockerOverview represents the summary dashboard for Docker
type DockerOverview struct {
	Healthy           bool    `json:"healthy"`
	HealthMessage     string  `json:"healthMessage"`
	DockerReady       bool    `json:"dockerReady"`
	DockerVersion     string  `json:"dockerVersion"`
	StorageLocation   string  `json:"storageLocation"`
	AutoStart         bool    `json:"autoStart"`
	ContainersTotal   int     `json:"containersTotal"`
	ContainersRunning int     `json:"containersRunning"`
	ContainersStopped int     `json:"containersStopped"`
	ImagesTotal       int     `json:"imagesTotal"`
	ImagesInUse       int     `json:"imagesInUse"`
	ProjectsTotal     int     `json:"projectsTotal"`
	ProjectsRunning   int     `json:"projectsRunning"`
	CPUPerc           float64 `json:"cpuPerc"`
	MemUsageMB        float64 `json:"memUsageMb"`
	MemTotalMB        float64 `json:"memTotalMb"`
	MemPerc           float64 `json:"memPerc"`
	NetRxKB           float64 `json:"netRxKb"`
	NetTxKB           float64 `json:"netTxKb"`
}

// DockerNetwork represents a docker network
type DockerNetwork struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Driver    string `json:"driver"`
	Scope     string `json:"scope"`
	IPv4      string `json:"ipv4"`
	Internal  bool   `json:"internal"`
	CreatedAt string `json:"createdAt"`
}

// RegistryConfig represents docker registry mirrors
type RegistryConfig struct {
	Mirrors []string `json:"mirrors"`
}
