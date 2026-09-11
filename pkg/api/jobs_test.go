package api

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func TestJobManagerPersistsCompletionAndRecoversInterruptedJobs(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "jobs.json")
	manager := newJobManager(statePath)
	completed := manager.add("vm.start", "starting", func() {})
	manager.finish(completed.ID, errors.New("start failed"))
	interrupted := manager.add("vm.stop", "stopping", func() {})

	reloaded := newJobManager(statePath)
	gotCompleted, ok := reloaded.snapshot(completed.ID)
	if !ok || gotCompleted.Status != "failed" || gotCompleted.Error != "start failed" {
		t.Fatalf("completed job was not persisted: %#v", gotCompleted)
	}
	gotInterrupted, ok := reloaded.snapshot(interrupted.ID)
	if !ok || gotInterrupted.Status != "failed" {
		t.Fatalf("interrupted job was not recovered as failed: %#v", gotInterrupted)
	}
}

func TestJobManagerCancelPropagatesContext(t *testing.T) {
	manager := newJobManager("")
	ctx, cancel := context.WithCancel(context.Background())
	job := manager.add("vm.restart", "restarting", cancel)
	if !manager.cancelJob(job.ID) {
		t.Fatal("running job should be cancellable")
	}
	select {
	case <-ctx.Done():
	default:
		t.Fatal("job cancellation did not cancel operation context")
	}
}
