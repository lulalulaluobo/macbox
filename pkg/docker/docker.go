package docker

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"sync"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/vm"
)

type Client struct {
	vmMgr                 *vm.Manager
	projectRoot           string
	containerSummaryCache containerSnapshotCache
	containerStatsCache   containerSnapshotCache
}

const (
	containerSummaryCacheTTL = 2 * time.Second
	containerStatsCacheTTL   = 1 * time.Second
)

// containerSnapshotCache coalesces concurrent Docker list requests and keeps
// the UI from starting multiple limactl/docker processes during a short poll
// burst. Values are copied at the boundary so callers cannot mutate shared
// cached slices.
type containerSnapshotCache struct {
	mu         sync.Mutex
	value      []ContainerInfo
	cachedAt   time.Time
	generation uint64
	refreshing bool
	wait       chan struct{}
}

func (cache *containerSnapshotCache) get(ctx context.Context, ttl time.Duration, load func() ([]ContainerInfo, error)) ([]ContainerInfo, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	for {
		cache.mu.Lock()
		if !cache.cachedAt.IsZero() && time.Since(cache.cachedAt) < ttl {
			value := cloneContainerInfos(cache.value)
			cache.mu.Unlock()
			return value, nil
		}
		if cache.refreshing {
			wait := cache.wait
			cache.mu.Unlock()
			select {
			case <-wait:
				continue
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		cache.refreshing = true
		cache.wait = make(chan struct{})
		wait := cache.wait
		generation := cache.generation
		cache.mu.Unlock()

		value, err := load()

		cache.mu.Lock()
		if err == nil && cache.generation == generation {
			cache.value = cloneContainerInfos(value)
			cache.cachedAt = time.Now()
		}
		cache.refreshing = false
		close(wait)
		cache.mu.Unlock()
		return value, err
	}
}

func cloneContainerInfos(value []ContainerInfo) []ContainerInfo {
	if value == nil {
		return nil
	}
	cloned := make([]ContainerInfo, len(value))
	copy(cloned, value)
	for i := range cloned {
		if value[i].PortsMap != nil {
			cloned[i].PortsMap = append([]PortMapping(nil), value[i].PortsMap...)
		}
	}
	return cloned
}

const maxDockerCommandOutputBytes = 8 << 20

type cappedDockerOutput struct {
	mu        sync.Mutex
	buf       bytes.Buffer
	truncated bool
}

func (b *cappedDockerOutput) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	remaining := maxDockerCommandOutputBytes - b.buf.Len()
	if remaining > 0 {
		if len(p) <= remaining {
			_, _ = b.buf.Write(p)
		} else {
			_, _ = b.buf.Write(p[:remaining])
			b.truncated = true
		}
	} else if len(p) > 0 {
		b.truncated = true
	}
	return len(p), nil
}

func (b *cappedDockerOutput) Bytes() []byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	output := append([]byte(nil), b.buf.Bytes()...)
	if b.truncated {
		output = append(output, []byte(fmt.Sprintf("\n[MacBox] Docker 命令输出已截断（超过 %d MiB）\n", maxDockerCommandOutputBytes/(1<<20)))...)
	}
	return output
}

func NewClient(vmMgr *vm.Manager, projectRoot ...string) *Client {
	root := ""
	if len(projectRoot) > 0 {
		root = projectRoot[0]
	}
	return &Client{
		vmMgr:       vmMgr,
		projectRoot: root,
	}
}

// InvalidateContainerCaches is called after a Docker mutation when the caller
// wants the next read to observe the new daemon state immediately.
func (c *Client) InvalidateContainerCaches() {
	for _, cache := range []*containerSnapshotCache{&c.containerSummaryCache, &c.containerStatsCache} {
		cache.mu.Lock()
		cache.cachedAt = time.Time{}
		cache.generation++
		cache.mu.Unlock()
	}
}

func (c *Client) runDockerCmd(ctx context.Context, args ...string) ([]byte, error) {
	status, _ := c.vmMgr.GetStatusContext(ctx)
	// If host docker socket is ready and host docker cli is available, run directly
	if status != nil && status.DockerReady {
		cmdArgs := append([]string{"-H", "unix://" + status.DockerSocket}, args...)
		cmd := exec.CommandContext(ctx, "docker", cmdArgs...)
		var output cappedDockerOutput
		cmd.Stdout = &output
		cmd.Stderr = &output
		err := cmd.Run()
		if err == nil {
			return output.Bytes(), nil
		}
	}

	// Fallback to running inside VM
	vmArgs := append([]string{"docker"}, args...)
	out, err := c.vmMgr.ExecAsManagementUser(ctx, vmArgs...)
	return []byte(out), err
}

func getString(m map[string]interface{}, key string) string {
	if val, ok := m[key]; ok {
		if s, ok := val.(string); ok {
			return s
		}
	}
	return ""
}
