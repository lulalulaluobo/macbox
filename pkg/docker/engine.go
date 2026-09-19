package docker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/containerengine"
)

// engineProbeTTL bounds how often Docker operations re-probe host engines.
// Probing dials unix sockets and may shell out to `docker info`, so it is
// cached briefly and invalidated whenever an engine command fails in a way
// that suggests the daemon disappeared.
const engineProbeTTL = 5 * time.Second

// VMDataRoot is the MacBox data root inside the Lima guest. Host engine mode
// mirrors this layout under HostDataDir so compose templates can be translated
// with a single path rewrite.
const VMDataRoot = "/data"

// DockerMode values.
const (
	DockerModeAuto = "auto"
	DockerModeVM   = "vm"
)

// HostDataDir returns the macOS-side data root used when Docker operations
// target a host engine instead of the Lima VM.
func HostDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = "."
	}
	return filepath.Join(home, "MacBox", "data")
}

// composeCLIKey tags a context with a host-side CLI (Mocker) that must run
// `compose`-family commands instead of the docker engine. The request layer
// injects it when the experimental Apple container Compose support is on.
type composeCLIKey struct{}

// WithComposeCLI returns a context whose Compose operations execute the
// given host CLI (no -H flag) rather than a docker engine.
func WithComposeCLI(ctx context.Context, cliPath string) context.Context {
	return context.WithValue(ctx, composeCLIKey{}, cliPath)
}

func composeCLIFromContext(ctx context.Context) (string, bool) {
	if cli, ok := ctx.Value(composeCLIKey{}).(string); ok && cli != "" {
		return cli, true
	}
	return "", false
}

// ComposeOnHost reports whether the caller asked for host-side Compose
// execution (Mocker path). Data roots and file layouts follow the host.
func (c *Client) ComposeOnHost(ctx context.Context) bool {
	_, ok := composeCLIFromContext(ctx)
	return ok
}

// execHostCLI runs a CLI binary directly on macOS without a -H endpoint.
func execHostCLI(ctx context.Context, cliPath string, out io.Writer, capture *cappedDockerOutput, args ...string) error {
	cmd := exec.CommandContext(ctx, cliPath, args...)
	streaming := out != nil && out != io.Discard
	switch {
	case streaming && capture != nil:
		cmd.Stdout = io.MultiWriter(capture, out)
		cmd.Stderr = io.MultiWriter(capture, out)
	case capture != nil:
		cmd.Stdout = capture
		cmd.Stderr = capture
	case streaming:
		cmd.Stdout = out
		cmd.Stderr = out
	}
	return cmd.Run()
}

// SetDockerMode configures engine selection ("auto" or "vm"). It must be
// called before the client serves requests.
func (c *Client) SetDockerMode(mode string) {
	if strings.TrimSpace(mode) == DockerModeVM {
		c.dockerMode = DockerModeVM
		return
	}
	c.dockerMode = DockerModeAuto
}

// hostEngine returns a running host-side Docker engine (OrbStack, Docker
// Desktop or a docker CLI context) that MacBox should reuse instead of the
// daemon inside the Lima VM.
func (c *Client) hostEngine() (containerengine.Engine, bool) {
	if c.dockerMode == DockerModeVM {
		return containerengine.Engine{}, false
	}

	c.engineMu.Lock()
	defer c.engineMu.Unlock()
	if time.Since(c.engineProbedAt) < engineProbeTTL {
		engine := c.cachedEngine
		return engine, engine.Running && engine.SocketPath != "" && engine.CLIPath != ""
	}

	engine, ok := firstUsableHostEngine()
	c.cachedEngine = engine
	c.engineProbedAt = time.Now()
	return engine, ok
}

func firstUsableHostEngine() (containerengine.Engine, bool) {
	for _, engine := range containerengine.HostEngines() {
		if engine.Running && engine.SocketPath != "" && engine.CLIPath != "" {
			return engine, true
		}
	}
	return containerengine.Engine{}, false
}

// InvalidateEngineProbe forces the next Docker operation to re-detect engines,
// for example after starting or stopping the VM or an engine app.
func (c *Client) InvalidateEngineProbe() {
	c.engineMu.Lock()
	c.engineProbedAt = time.Time{}
	c.engineMu.Unlock()
}

// HostEngineActive reports whether Docker and Compose operations currently
// resolve to a host engine rather than the Lima VM daemon. Mocker Compose
// override counts as host-side for path layout.
func (c *Client) HostEngineActive(ctx context.Context) bool {
	if c.ComposeOnHost(ctx) {
		return true
	}
	_, ok := c.hostEngine()
	return ok
}

// AppDataRoot returns the root directory that holds per-app Compose projects.
func (c *Client) AppDataRoot(ctx context.Context) string {
	if c.HostEngineActive(ctx) {
		return filepath.Join(HostDataDir(), "appdata")
	}
	return VMDataRoot + "/appdata"
}

// ComposeProjectsRoot returns the root directory for user Compose projects.
func (c *Client) ComposeProjectsRoot(ctx context.Context) string {
	return filepath.Join(c.AppDataRoot(ctx), "compose")
}

// DataRoot returns the engine-side MacBox data root: /data inside the VM or
// the mirrored host directory when a host engine is active.
func (c *Client) DataRoot(ctx context.Context) string {
	if c.HostEngineActive(ctx) {
		return HostDataDir()
	}
	return VMDataRoot
}

// EngineInfo describes the selected runtime for API responses.
func (c *Client) EngineInfo(ctx context.Context) map[string]interface{} {
	info := map[string]interface{}{"mode": c.dockerMode}
	if engine, ok := c.hostEngine(); ok {
		info["engine"] = engine
		info["source"] = "host"
		return info
	}
	if engine, ok := containerengine.LimaVMSocketEngine(c.vmMgr.InstanceName()); ok {
		info["engine"] = engine
		info["source"] = "lima-vm"
		return info
	}
	info["engine"] = nil
	info["source"] = "none"
	return info
}

// execOnEngine runs the docker CLI against an engine socket. When capture is
// set its merged output is stored there; out receives live streamed output.
func execOnEngine(ctx context.Context, engine containerengine.Engine, input io.Reader, out io.Writer, capture *cappedDockerOutput, args ...string) error {
	host, ok := engine.DockerHost()
	if !ok || engine.CLIPath == "" {
		return fmt.Errorf("宿主容器引擎 %s 不可用", engine.Name)
	}
	cmdArgs := append([]string{"-H", host}, args...)
	cmd := exec.CommandContext(ctx, engine.CLIPath, cmdArgs...)
	if input != nil {
		cmd.Stdin = input
	}

	streaming := out != nil && out != io.Discard
	switch {
	case streaming && capture != nil:
		cmd.Stdout = io.MultiWriter(capture, out)
		cmd.Stderr = io.MultiWriter(capture, out)
	case capture != nil:
		cmd.Stdout = capture
		cmd.Stderr = capture
	case streaming:
		cmd.Stdout = out
		cmd.Stderr = out
	}
	return cmd.Run()
}

func asExitError(err error) (*exec.ExitError, bool) {
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee, true
	}
	return nil, false
}

// runDockerStream executes a docker command with live output. A Compose CLI
// override (Mocker) runs directly on macOS; host engine mode runs the host
// CLI against the engine socket; VM mode always executes inside the guest
// because Compose reads project files from the CLI side and those paths only
// exist on the VM filesystem.
func (c *Client) runDockerStream(ctx context.Context, out io.Writer, args ...string) error {
	if cli, ok := composeCLIFromContext(ctx); ok {
		return execHostCLI(ctx, cli, out, nil, args...)
	}
	if engine, ok := c.hostEngine(); ok {
		err := execOnEngine(ctx, engine, nil, out, nil, args...)
		if err == nil {
			return nil
		}
		if _, isExit := asExitError(err); isExit {
			// The daemon answered and the command itself failed; rerunning it
			// in the VM would duplicate output and mutate the wrong engine.
			return err
		}
		c.InvalidateEngineProbe()
	}
	return c.vmMgr.ExecStream(ctx, out, append([]string{"docker"}, args...)...)
}

// ExecComposeFile runs a docker command whose arguments include paths to
// Compose files. Compose reads those files on the client side, so the
// command must execute on the machine that stores the file: the host CLI in
// host engine mode, limactl inside the guest otherwise.
func (c *Client) ExecComposeFile(ctx context.Context, args ...string) (string, error) {
	if cli, ok := composeCLIFromContext(ctx); ok {
		var output cappedDockerOutput
		err := execHostCLI(ctx, cli, nil, &output, args...)
		return string(output.Bytes()), err
	}
	if engine, ok := c.hostEngine(); ok {
		var output cappedDockerOutput
		err := execOnEngine(ctx, engine, nil, nil, &output, args...)
		return string(output.Bytes()), err
	}
	out, err := c.vmMgr.Exec(ctx, append([]string{"docker"}, args...)...)
	return out, err
}

// ExecComposeFileStream is ExecComposeFile with live streamed output.
func (c *Client) ExecComposeFileStream(ctx context.Context, out io.Writer, args ...string) error {
	return c.runDockerStream(ctx, out, args...)
}

// WriteComposeFileOnHost stores Compose YAML with 0600 permissions because
// project files may contain credentials.
func WriteComposeFileOnHost(filePath, content string) error {
	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(filePath, []byte(content), 0o600)
}

var dockerSocketBindPattern = regexp.MustCompile(`(?m)^(\s*(?:-\s*)?["']?)/var/run/docker\.sock(:)`)

// TranslateComposeForEngine rewrites a VM-authored Compose document so the
// same deployment runs against the active engine: /data bind sources become
// host data-root paths and /var/run/docker.sock mounts point at the host
// engine socket. It is a no-op while operations target the Lima VM.
func (c *Client) TranslateComposeForEngine(ctx context.Context, content string) string {
	if !c.HostEngineActive(ctx) {
		return content
	}
	translated := TranslateBindPaths(content, HostDataDir())
	// Under the mocker bridge a docker.sock mount would point at an unrelated
	// Docker daemon socket, so leave it untouched.
	if _, mocker := composeCLIFromContext(ctx); !mocker {
		if engine, ok := c.hostEngine(); ok {
			replacement := "${1}" + strings.ReplaceAll(engine.SocketPath, "$", "$$") + "${2}"
			translated = dockerSocketBindPattern.ReplaceAllString(translated, replacement)
		}
	}
	return translated
}

// DockerExecOutput runs any docker command (for example a Compose subcommand)
// through the selected engine and returns its merged output.
func (c *Client) DockerExecOutput(ctx context.Context, args ...string) (string, error) {
	out, err := c.runDockerCmd(ctx, args...)
	return string(out), err
}

// DockerExecStream runs any docker command through the selected engine and
// streams merged output.
func (c *Client) DockerExecStream(ctx context.Context, out io.Writer, args ...string) error {
	return c.runDockerStream(ctx, out, args...)
}

// TranslateBindPaths rewrites guest-side /data bind sources in Compose YAML so
// the same document runs against a host engine using hostRoot. Container-side
// path segments (those preceded by ':') are left untouched.
func TranslateBindPaths(content, hostRoot string) string {
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		if strings.Contains(line, VMDataRoot+"/") {
			lines[i] = translateBindLine(line, hostRoot)
		}
	}
	translated := strings.Join(lines, "\n")
	// Long-syntax bind sources for the bare /data root (Alist template).
	sourcePattern := regexp.MustCompile(`(?m)^(\s*source:\s*["']?)/data(["']?\s*)$`)
	replacement := "${1}" + strings.ReplaceAll(hostRoot, "$", "$$") + "${2}"
	return sourcePattern.ReplaceAllString(translated, replacement)
}

func translateBindLine(line, hostRoot string) string {
	prefix := VMDataRoot + "/"
	var b strings.Builder
	i := 0
	for i < len(line) {
		idx := strings.Index(line[i:], prefix)
		if idx < 0 {
			b.WriteString(line[i:])
			break
		}
		start := i + idx
		end := start
		for end < len(line) && isPathChar(line[end]) {
			end++
		}
		token := line[start:end]
		b.WriteString(line[i:start])
		// A host-side token cannot be preceded by ':' (that marks the
		// container path of "host:container") or by another path character
		// (that would make it part of a longer path).
		if start == 0 || (line[start-1] != ':' && !isPathChar(line[start-1])) {
			b.WriteString(hostRoot + token[len(VMDataRoot):])
		} else {
			b.WriteString(token)
		}
		i = end
	}
	return b.String()
}

func isPathChar(b byte) bool {
	switch {
	case b >= 'a' && b <= 'z', b >= 'A' && b <= 'Z', b >= '0' && b <= '9':
		return true
	case b == '/', b == '.', b == '_', b == '-':
		return true
	}
	return false
}
