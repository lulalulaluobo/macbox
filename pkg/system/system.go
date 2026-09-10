package system

import (
	"fmt"
	"net"
	"os/exec"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
)

var (
	cpuRegex   = regexp.MustCompile(`CPU usage:\s*([0-9.]+)%\s*user,\s*([0-9.]+)%\s*sys,\s*([0-9.]+)%\s*idle`)
	cpuMu      sync.RWMutex
	cachedCPU  float64
	cpuStarted sync.Once
)

// StartCPUMonitor initializes periodic background sampling of CPU usage
func StartCPUMonitor() {
	cpuStarted.Do(func() {
		// Sample once synchronously so first read isn't zero
		if val, err := sampleDarwinCPU(); err == nil {
			cpuMu.Lock()
			cachedCPU = val
			cpuMu.Unlock()
		}

		go func() {
			ticker := time.NewTicker(3 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				if runtime.GOOS == "darwin" {
					if val, err := sampleDarwinCPU(); err == nil {
						cpuMu.Lock()
						cachedCPU = val
						cpuMu.Unlock()
					}
				}
			}
		}()
	})
}

func sampleDarwinCPU() (float64, error) {
	cmd := exec.Command("top", "-l", "1", "-n", "0")
	out, err := cmd.Output()
	if err != nil {
		return 0, err
	}

	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "CPU usage:") {
			m := cpuRegex.FindStringSubmatch(line)
			if len(m) >= 4 {
				user, _ := strconv.ParseFloat(m[1], 64)
				sys, _ := strconv.ParseFloat(m[2], 64)
				return user + sys, nil
			}
		}
	}
	return 0, fmt.Errorf("cpu line not found")
}

func GetCachedCPU() float64 {
	StartCPUMonitor()
	cpuMu.RLock()
	defer cpuMu.RUnlock()
	return cachedCPU
}

type SystemStats struct {
	HostName     string    `json:"hostname"`
	OS           string    `json:"os"`
	Platform     string    `json:"platform"`
	KernelArch   string    `json:"arch"`
	Uptime       uint64    `json:"uptime"`
	UptimeString string    `json:"uptimeString"`
	CPUPercent   float64   `json:"cpuPercent"`
	CPUCores     int       `json:"cpuCores"`
	MemTotal     uint64    `json:"memTotal"`
	MemUsed      uint64    `json:"memUsed"`
	MemPercent   float64   `json:"memPercent"`
	IPAddresses  []string  `json:"ipAddresses"`
	PrimaryIP    string    `json:"primaryIP"`
	Status       string    `json:"status"` // "Running"
	Timestamp    time.Time `json:"timestamp"`
}

func GetSystemStats() (*SystemStats, error) {
	stats := &SystemStats{
		OS:        runtime.GOOS,
		Status:    "Running",
		Timestamp: time.Now(),
	}

	// Host info
	if hInfo, err := host.Info(); err == nil {
		stats.HostName = hInfo.Hostname
		stats.Platform = hInfo.Platform + " " + hInfo.PlatformVersion
		stats.KernelArch = hInfo.KernelArch
		stats.Uptime = hInfo.Uptime
		stats.UptimeString = formatUptime(hInfo.Uptime)
	}

	// CPU
	stats.CPUCores = runtime.NumCPU()
	if runtime.GOOS == "darwin" {
		stats.CPUPercent = GetCachedCPU()
	} else {
		if percents, err := cpu.Percent(100*time.Millisecond, false); err == nil && len(percents) > 0 {
			stats.CPUPercent = percents[0]
		}
	}

	// Memory
	if vMem, err := mem.VirtualMemory(); err == nil {
		stats.MemTotal = vMem.Total
		stats.MemUsed = vMem.Used
		stats.MemPercent = vMem.UsedPercent
	}

	// Network IPs
	ips, primary := getHostIPs()
	stats.IPAddresses = ips
	stats.PrimaryIP = primary

	return stats, nil
}

func formatUptime(secs uint64) string {
	d := secs / 86400
	h := (secs % 86400) / 3600
	m := (secs % 3600) / 60
	if d > 0 {
		return fmt.Sprintf("%d天 %d小时", d, h)
	}
	if h > 0 {
		return fmt.Sprintf("%d小时 %d分", h, m)
	}
	return fmt.Sprintf("%d分钟", m)
}

func getHostIPs() ([]string, string) {
	var ips []string
	var primary string

	interfaces, err := net.Interfaces()
	if err != nil {
		return ips, "127.0.0.1"
	}

	for _, iface := range interfaces {
		// skip loopback, inactive
		if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
			continue
		}

		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}

			if ip == nil || ip.IsLoopback() {
				continue
			}

			ip4 := ip.To4()
			if ip4 == nil {
				continue // skip IPv6 for primary
			}

			ipStr := ip4.String()
			ips = append(ips, ipStr)

			// Pick preferred LAN IP (192.168.x.x or 10.x.x.x)
			if primary == "" && (ip4[0] == 192 && ip4[1] == 168 || ip4[0] == 10) {
				primary = ipStr
			}
		}
	}

	if primary == "" {
		if len(ips) > 0 {
			primary = ips[0]
		} else {
			primary = "127.0.0.1"
		}
	}

	return ips, primary
}
