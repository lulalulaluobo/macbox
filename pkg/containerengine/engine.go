// Package containerengine detects host-side container runtimes (OrbStack,
// Docker Desktop, plain docker CLI, Apple container) so MacBox can reuse an
// existing daemon instead of provisioning a second one inside the Lima VM.
package containerengine

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type Kind string

const (
	KindOrbStack       Kind = "orbstack"
	KindDockerDesktop  Kind = "docker-desktop"
	KindDockerCLI      Kind = "docker-cli"
	KindLimaVM         Kind = "lima-vm"
	KindAppleContainer Kind = "apple-container"
)

// Engine describes one detected container runtime on the host.
type Engine struct {
	Kind       Kind   `json:"kind"`
	Name       string `json:"name"`
	SocketPath string `json:"socketPath,omitempty"`
	CLIPath    string `json:"cliPath,omitempty"`
	Running    bool   `json:"running"`
	Detail     string `json:"detail,omitempty"`
}

// DockerHostArg renders the -H value for talking to this engine's daemon.
// Engines discovered from a plain CLI without a socket return false.
func (e Engine) DockerHost() (string, bool) {
	if e.SocketPath == "" {
		return "", false
	}
	return "unix://" + e.SocketPath, true
}

func homePath(parts ...string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(append([]string{home}, parts...)...)
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// socketDialable verifies a unix socket actually accepts connections; the file
// may linger after OrbStack or Docker Desktop exits.
func socketDialable(path string) bool {
	if path == "" {
		return false
	}
	conn, err := net.DialTimeout("unix", path, 400*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func lookPath(name string, extraCandidates ...string) string {
	if path, err := exec.LookPath(name); err == nil {
		return path
	}
	for _, candidate := range extraCandidates {
		if fileExists(candidate) {
			return candidate
		}
	}
	return ""
}

// HostEngines returns docker-capable engines installed on the host, ordered by
// preference. The Lima VM fallback engine is appended when its forwarded
// docker socket is live; callers treat index 0 as the preferred runtime.
func HostEngines() []Engine {
	var engines []Engine

	if socket := homePath(".orbstack", "run", "docker.sock"); fileExists(socket) || appExists("OrbStack.app") {
		engines = append(engines, Engine{
			Kind:       KindOrbStack,
			Name:       "OrbStack",
			SocketPath: socketIfLive(socket),
			CLIPath:    lookPath("docker", "/usr/local/bin/docker", "/opt/homebrew/bin/docker"),
			Running:    socketDialable(socket),
			Detail:     "/Applications/OrbStack.app",
		})
	}

	if socket := homePath(".docker", "run", "docker.sock"); fileExists(socket) || appExists("Docker.app") {
		engines = append(engines, Engine{
			Kind:       KindDockerDesktop,
			Name:       "Docker Desktop",
			SocketPath: socketIfLive(socket),
			CLIPath:    lookPath("docker", "/usr/local/bin/docker", "/opt/homebrew/bin/docker"),
			Running:    socketDialable(socket),
			Detail:     "/Applications/Docker.app",
		})
	}

	// A bare docker CLI (or DOCKER_HOST from a shell profile) still counts as
	// host capability, but only when it answers `docker info` quickly.
	if cli := lookPath("docker", "/usr/local/bin/docker", "/opt/homebrew/bin/docker"); cli != "" && !enginesCoverRunning(engines) {
		engine := Engine{
			Kind:    KindDockerCLI,
			Name:    "Docker CLI",
			CLIPath: cli,
			Detail:  "docker context / DOCKER_HOST",
		}
		if socket := dockerCLISocket(context.Background(), cli); socket != "" {
			engine.SocketPath = socket
			engine.Running = true
		}
		engines = append(engines, engine)
	}

	return engines
}

func socketIfLive(socket string) string {
	if socketDialable(socket) {
		return socket
	}
	return ""
}

func appExists(bundle string) bool {
	return fileExists(filepath.Join("/Applications", bundle))
}

// AppleContainerCLI locates the Apple `container` CLI shipped with the
// macOS 26+ container tooling.
func AppleContainerCLI() (string, bool) {
	path := lookPath("container", "/usr/local/bin/container", "/opt/homebrew/bin/container")
	if path == "" {
		return "", false
	}
	return path, true
}

// MockerCLI locates Mocker (github.com/us/mocker), the Docker-compatible
// CLI + Compose layer built on Apple's Containerization framework. MacBox
// uses it as the optional Compose backend when the Apple container engine
// is active.
func MockerCLI() (string, bool) {
	path := lookPath("mocker", "/opt/homebrew/bin/mocker", "/usr/local/bin/mocker")
	if path == "" {
		return "", false
	}
	return path, true
}

func enginesCoverRunning(engines []Engine) bool {
	for _, e := range engines {
		if e.Running {
			return true
		}
	}
	return false
}

// dockerCLISocket asks the docker CLI which endpoint it would use. It is only
// consulted when no app-bundled socket is live, and never blocks for long.
func dockerCLISocket(ctx context.Context, cli string) string {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, cli, "info", "--format", "{{.Client.DockerHost}}").Output()
	if err != nil {
		return ""
	}
	host := strings.TrimSpace(string(out))
	switch {
	case strings.HasPrefix(host, "unix://"):
		path := strings.TrimPrefix(host, "unix://")
		if socketDialable(path) {
			return path
		}
	case host == "" || strings.HasPrefix(host, "ssh://") || strings.HasPrefix(host, "tcp://"):
		// Remote endpoints are out of scope for host reuse.
	}
	return ""
}

// LimaVMSocketEngine reports the docker socket forwarded from the Lima
// instance, if it exists and answers. instanceName is config.VM.Name.
func LimaVMSocketEngine(instanceName string) (Engine, bool) {
	socket := homePath(".lima", instanceName, "sock", "docker.sock")
	if !socketDialable(socket) {
		return Engine{}, false
	}
	return Engine{
		Kind:       KindLimaVM,
		Name:       fmt.Sprintf("Lima VM (%s)", instanceName),
		SocketPath: socket,
		CLIPath:    lookPath("docker", "/usr/local/bin/docker", "/opt/homebrew/bin/docker"),
		Running:    true,
	}, true
}

// PreferredDocker returns the first running host engine, or the Lima VM
// socket as the fallback. ok is false when no reachable daemon exists.
func PreferredDocker(instanceName string) (Engine, bool) {
	for _, e := range HostEngines() {
		if e.Running && e.SocketPath != "" {
			return e, true
		}
	}
	return LimaVMSocketEngine(instanceName)
}
