package docker

import (
	"bytes"
	"context"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCappedDockerOutput(t *testing.T) {
	var output cappedDockerOutput
	input := bytes.Repeat([]byte("x"), maxDockerCommandOutputBytes+1)
	if n, err := output.Write(input); err != nil || n != len(input) {
		t.Fatalf("capped output write = (%d, %v), want (%d, nil)", n, err, len(input))
	}
	result := output.Bytes()
	if len(result) <= maxDockerCommandOutputBytes || !strings.Contains(string(result), "Docker 命令输出已截断") {
		t.Fatalf("capped output did not include bounded diagnostic marker: len=%d", len(result))
	}
}

func TestPublishedHostPorts(t *testing.T) {
	content := `services:
  app:
    ports:
      - "8082:80"
      - "127.0.0.1:8085:8080/tcp"
      - "53:53/udp"
  long-form:
    ports:
      - target: 80
        published: 8080
`

	got, err := PublishedHostPorts(content)
	if err != nil {
		t.Fatalf("PublishedHostPorts() error = %v", err)
	}
	want := []int{53, 8080, 8082, 8085}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("PublishedHostPorts() = %v, want %v", got, want)
	}
}

func TestContainerSnapshotCacheCoalescesConcurrentLoads(t *testing.T) {
	var cache containerSnapshotCache
	started := make(chan struct{})
	release := make(chan struct{})
	var calls atomic.Int32
	load := func() ([]ContainerInfo, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return []ContainerInfo{{ID: "one", Names: "demo"}}, nil
	}

	var wg sync.WaitGroup
	results := make(chan []ContainerInfo, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			value, err := cache.get(context.Background(), time.Second, load)
			if err != nil {
				t.Errorf("cache.get() error = %v", err)
				return
			}
			results <- value
		}()
	}
	<-started
	if got := calls.Load(); got != 1 {
		t.Fatalf("concurrent cache loads = %d, want 1", got)
	}
	close(release)
	wg.Wait()
	close(results)
	for value := range results {
		if len(value) != 1 || value[0].Names != "demo" {
			t.Fatalf("cached result = %#v", value)
		}
	}
}
