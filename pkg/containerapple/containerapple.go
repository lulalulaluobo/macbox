// Package containerapple wraps Apple's `container` CLI (macOS 26+) for basic
// container management: list, start/stop/delete, logs, and image listing.
// Compose workloads stay on the docker engine.
package containerapple

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/containerengine"
)

// Client executes the `container` CLI. It is safe for concurrent use.
type Client struct {
	cliPath string
}

// NewClient resolves the container CLI. ok is false when the binary is absent.
func NewClient() (*Client, bool) {
	path, ok := containerengine.AppleContainerCLI()
	if !ok {
		return nil, false
	}
	return &Client{cliPath: path}, true
}

func (c *Client) CLIPath() string { return c.cliPath }

// Container mirrors the fields MacBox reads from `container ls --format json`.
type Container struct {
	ID            string `json:"id"`
	Configuration struct {
		ID           string            `json:"id"`
		CreationDate string            `json:"creationDate"`
		Labels       map[string]string `json:"labels"`
		Image        struct {
			Reference string `json:"reference"`
		} `json:"image"`
	} `json:"configuration"`
	Status struct {
		State       string `json:"state"`
		StartedDate string `json:"startedDate"`
	} `json:"status"`
}

func (c Container) Name() string {
	if c.ID != "" {
		return c.ID
	}
	return c.Configuration.ID
}

func (c Container) ImageRef() string { return c.Configuration.Image.Reference }

func (c Container) State() string { return strings.ToLower(strings.TrimSpace(c.Status.State)) }

func (c Container) Running() bool { return c.State() == "running" }

// Project returns the compose-ish project label third-party adapters attach
// (e.g. com.icontainu.compose.project), or "" when the container is standalone.
func (c Container) Project() string {
	for key, value := range c.Configuration.Labels {
		if strings.HasSuffix(key, ".compose.project") && strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// Image mirrors `container image ls --format json`.
type Image struct {
	ID            string `json:"id"`
	Configuration struct {
		Name         string `json:"name"`
		CreationDate string `json:"creationDate"`
		Descriptor   struct {
			Size int64 `json:"size"`
		} `json:"descriptor"`
	} `json:"configuration"`
}

func (c *Client) run(ctx context.Context, args ...string) ([]byte, error) {
	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, c.cliPath, args...)
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return out, fmt.Errorf("container %s: %s", strings.Join(args, " "), msg)
	}
	return out, nil
}

func (c *Client) List(ctx context.Context) ([]Container, error) {
	out, err := c.run(ctx, "ls", "--all", "--format", "json")
	if err != nil {
		return nil, err
	}
	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" || trimmed == "[]" {
		return nil, nil
	}
	var containers []Container
	if err := json.Unmarshal([]byte(trimmed), &containers); err != nil {
		return nil, fmt.Errorf("解析 container ls 输出失败: %w", err)
	}
	return containers, nil
}

func (c *Client) Start(ctx context.Context, id string) error {
	_, err := c.run(ctx, "start", id)
	return err
}

func (c *Client) Stop(ctx context.Context, id string, timeout time.Duration) error {
	_, err := c.run(ctx, "stop", "-t", strconv.Itoa(int(timeout.Seconds())), id)
	return err
}

func (c *Client) Delete(ctx context.Context, id string, force bool) error {
	args := []string{"delete"}
	if force {
		args = append(args, "--force")
	}
	_, err := c.run(ctx, append(args, id)...)
	return err
}

// LogsStream streams `container logs` output for a container into out.
func (c *Client) LogsStream(ctx context.Context, id string, tail int) ([]byte, error) {
	args := []string{"logs"}
	if tail > 0 {
		args = append(args, "-n", strconv.Itoa(tail))
	}
	return c.run(ctx, append(args, id)...)
}

func (c *Client) ImageList(ctx context.Context) ([]Image, error) {
	out, err := c.run(ctx, "image", "ls", "--format", "json")
	if err != nil {
		return nil, err
	}
	trimmed := strings.TrimSpace(string(out))
	if trimmed == "" || trimmed == "[]" {
		return nil, nil
	}
	var images []Image
	if err := json.Unmarshal([]byte(trimmed), &images); err != nil {
		return nil, fmt.Errorf("解析 container image ls 输出失败: %w", err)
	}
	return images, nil
}

func (c *Client) ImagePull(ctx context.Context, reference string) error {
	_, err := c.run(ctx, "image", "pull", reference)
	return err
}

func (c *Client) ImageDelete(ctx context.Context, id string, force bool) error {
	args := []string{"image", "delete"}
	if force {
		args = append(args, "--force")
	}
	_, err := c.run(ctx, append(args, id)...)
	return err
}

// SystemStatus reports whether the user-level container service is running.
func (c *Client) SystemStatus(ctx context.Context) (running bool, detail string, err error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, c.cliPath, "system", "status", "--format", "json")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, runErr := cmd.Output()
	if runErr != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = runErr.Error()
		}
		return false, msg, nil
	}
	var status struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(bytes.TrimSpace(out), &status); err == nil {
		return status.Status == "running", status.Status, nil
	}
	return strings.Contains(string(out), "running"), strings.TrimSpace(string(out)), nil
}

func (c *Client) SystemStart(ctx context.Context) error {
	_, err := c.run(ctx, "system", "start")
	return err
}

func (c *Client) SystemStop(ctx context.Context) error {
	_, err := c.run(ctx, "system", "stop")
	return err
}

// Version returns the CLI version string, e.g. "1.3.1".
func (c *Client) Version(ctx context.Context) string {
	out, err := c.run(ctx, "--version")
	if err != nil {
		return ""
	}
	fields := strings.Fields(string(out))
	for i, f := range fields {
		if f == "version" && i+1 < len(fields) {
			return fields[i+1]
		}
	}
	return strings.TrimSpace(string(out))
}
