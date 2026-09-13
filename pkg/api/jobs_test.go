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

func TestJobManagerPersistsProgressStage(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "jobs.json")
	manager := newJobManager(statePath)
	job := manager.addWithStage("vm.start", "checking", 5, "检查环境", func() {})
	manager.update(job.ID, "waiting-ssh", 45, "等待 SSH")
	got, ok := manager.snapshot(job.ID)
	if !ok || got.Stage != "waiting-ssh" || got.Progress != 45 || got.Message != "等待 SSH" {
		t.Fatalf("progress stage was not recorded: %#v", got)
	}
	manager.finish(job.ID, nil)
	reloaded := newJobManager(statePath)
	got, ok = reloaded.snapshot(job.ID)
	if !ok || got.Stage != "completed" || got.Progress != 100 {
		t.Fatalf("completed stage was not recorded: %#v", got)
	}
}

func TestPublicJobErrorHidesHostSpecificCommandOutput(t *testing.T) {
	if got := publicJobError(errors.New(`/Users/example/.lima/macbox: limactl start failed`)); got != "后台操作失败，请打开诊断中心查看具体检查结果" {
		t.Fatalf("host-specific job error was not summarized: %q", got)
	}
	if got := publicJobError(errors.New("数据盘尚未挂载")); got != "数据盘尚未挂载" {
		t.Fatalf("actionable job error was unexpectedly hidden: %q", got)
	}
}
