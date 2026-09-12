package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type backgroundJob struct {
	ID                  string             `json:"id"`
	Kind                string             `json:"kind"`
	Status              string             `json:"status"`
	Stage               string             `json:"stage,omitempty"`
	Progress            int                `json:"progress,omitempty"`
	BytesDone           int64              `json:"bytesDone,omitempty"`
	BytesTotal          int64              `json:"bytesTotal,omitempty"`
	SpeedBytesPerSecond int64              `json:"speedBytesPerSecond,omitempty"`
	CurrentFile         string             `json:"currentFile,omitempty"`
	Message             string             `json:"message,omitempty"`
	Error               string             `json:"error,omitempty"`
	CreatedAt           time.Time          `json:"createdAt"`
	UpdatedAt           time.Time          `json:"updatedAt"`
	cancel              context.CancelFunc `json:"-"`
}

type jobManager struct {
	mu   sync.RWMutex
	jobs map[string]*backgroundJob
	path string
}

func newJobManager(storagePath string) *jobManager {
	m := &jobManager{jobs: make(map[string]*backgroundJob), path: storagePath}
	data, err := os.ReadFile(storagePath)
	if err == nil {
		var saved []*backgroundJob
		if json.Unmarshal(data, &saved) == nil {
			now := time.Now().UTC()
			for _, job := range saved {
				if job == nil || job.ID == "" {
					continue
				}
				if job.Status == "running" {
					job.Status = "failed"
					job.Stage = "failed"
					job.Error = "服务重启，任务执行状态已中断"
					job.UpdatedAt = now
				}
				m.jobs[job.ID] = job
			}
		}
	}
	m.saveLocked()
	return m
}

func (m *jobManager) saveLocked() {
	if m.path == "" {
		return
	}
	items := make([]*backgroundJob, 0, len(m.jobs))
	for _, job := range m.jobs {
		items = append(items, job)
	}
	data, err := json.Marshal(items)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(m.path), 0700); err != nil {
		log.Printf("[MacNAS Jobs] create state directory: %v", err)
		return
	}
	temp := m.path + ".tmp"
	if err := os.WriteFile(temp, data, 0600); err != nil {
		log.Printf("[MacNAS Jobs] write state: %v", err)
		return
	}
	if err := os.Chmod(temp, 0600); err != nil {
		_ = os.Remove(temp)
		return
	}
	if err := os.Rename(temp, m.path); err != nil {
		_ = os.Remove(temp)
		log.Printf("[MacNAS Jobs] commit state: %v", err)
	}
}

func newJobID() string {
	var value [12]byte
	if _, err := rand.Read(value[:]); err == nil {
		return hex.EncodeToString(value[:])
	}
	return hex.EncodeToString([]byte(time.Now().UTC().Format(time.RFC3339Nano)))
}

func (m *jobManager) add(kind, message string, cancel context.CancelFunc) *backgroundJob {
	return m.addWithStage(kind, "starting", 0, message, cancel)
}

func (m *jobManager) addWithStage(kind, stage string, progress int, message string, cancel context.CancelFunc) *backgroundJob {
	now := time.Now().UTC()
	job := &backgroundJob{ID: newJobID(), Kind: kind, Status: "running", Stage: stage, Progress: clampProgress(progress), Message: message, CreatedAt: now, UpdatedAt: now, cancel: cancel}
	m.mu.Lock()
	if len(m.jobs) >= 100 {
		var oldest *backgroundJob
		for _, candidate := range m.jobs {
			if candidate.Status != "running" && (oldest == nil || candidate.UpdatedAt.Before(oldest.UpdatedAt)) {
				oldest = candidate
			}
		}
		if oldest != nil {
			delete(m.jobs, oldest.ID)
		}
	}
	m.jobs[job.ID] = job
	m.saveLocked()
	m.mu.Unlock()
	return job
}

func clampProgress(progress int) int {
	if progress < 0 {
		return 0
	}
	if progress > 100 {
		return 100
	}
	return progress
}

func publicJobError(err error) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Error())
	// Lima and shell errors frequently contain multi-line command output and
	// host-specific paths. Keep that detail in server logs/diagnostics instead
	// of putting it into a compact browser progress card.
	if len(message) > 600 || strings.Contains(message, "time=\"") || strings.Contains(message, "/Users/") || strings.Contains(message, "/var/") {
		return "后台操作失败，请打开诊断中心查看具体检查结果"
	}
	return message
}

// update records a coarse-grained stage for long-running operations. It is
// intentionally persisted so a browser refresh still explains what the
// server was doing before the latest poll.
func (m *jobManager) update(id, stage string, progress int, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	job := m.jobs[id]
	if job == nil || job.Status != "running" {
		return
	}
	if stage != "" {
		job.Stage = stage
	}
	if progress >= 0 {
		job.Progress = clampProgress(progress)
	}
	if message != "" {
		job.Message = message
	}
	job.UpdatedAt = time.Now().UTC()
	m.saveLocked()
}

func (m *jobManager) updateTransfer(id, stage string, progress int, message, currentFile string, done, total, speed int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	job := m.jobs[id]
	if job == nil || job.Status != "running" {
		return
	}
	if stage != "" {
		job.Stage = stage
	}
	if progress >= 0 {
		job.Progress = clampProgress(progress)
	}
	if message != "" {
		job.Message = message
	}
	if currentFile != "" {
		job.CurrentFile = currentFile
	}
	if done >= 0 {
		job.BytesDone = done
	}
	if total >= 0 {
		job.BytesTotal = total
	}
	if speed >= 0 {
		job.SpeedBytesPerSecond = speed
	}
	job.UpdatedAt = time.Now().UTC()
	m.saveLocked()
}

func (m *jobManager) finish(id string, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	job := m.jobs[id]
	if job == nil {
		return
	}
	job.UpdatedAt = time.Now().UTC()
	job.cancel = nil
	if job.Status == "cancelled" {
		m.saveLocked()
		return
	}
	if err != nil {
		job.Status = "failed"
		job.Stage = "failed"
		job.Error = publicJobError(err)
		m.saveLocked()
		return
	}
	job.Status = "succeeded"
	job.Stage = "completed"
	job.Progress = 100
	m.saveLocked()
}

func (m *jobManager) cancelJob(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	job := m.jobs[id]
	if job == nil || job.Status != "running" {
		return false
	}
	job.Status = "cancelled"
	job.Stage = "cancelled"
	job.UpdatedAt = time.Now().UTC()
	if job.cancel != nil {
		job.cancel()
		job.cancel = nil
	}
	m.saveLocked()
	return true
}

// clearFinished removes only historical records. Running jobs are deliberately
// kept so a cleanup click can never interrupt an active transfer.
func (m *jobManager) clearFinished(kind string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	removed := 0
	for id, job := range m.jobs {
		if job == nil || job.Status == "running" {
			continue
		}
		if kind == "cloud.transfer" {
			if !strings.HasPrefix(job.Kind, "cloud.") {
				continue
			}
		} else if kind != "" && job.Kind != kind {
			continue
		}
		delete(m.jobs, id)
		removed++
	}
	if removed > 0 {
		m.saveLocked()
	}
	return removed
}

func (m *jobManager) snapshot(id string) (*backgroundJob, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	job, ok := m.jobs[id]
	if !ok {
		return nil, false
	}
	copy := *job
	copy.cancel = nil
	return &copy, true
}

func (m *jobManager) list() []*backgroundJob {
	m.mu.RLock()
	result := make([]*backgroundJob, 0, len(m.jobs))
	for _, job := range m.jobs {
		copy := *job
		copy.cancel = nil
		result = append(result, &copy)
	}
	m.mu.RUnlock()
	sort.Slice(result, func(i, j int) bool { return result[i].CreatedAt.After(result[j].CreatedAt) })
	return result
}

func (s *Server) handleJobsList(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{"jobs": s.jobs.list()})
}

func (s *Server) handleJobGet(w http.ResponseWriter, r *http.Request) {
	job, ok := s.jobs.snapshot(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "任务不存在")
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *Server) handleJobCancel(w http.ResponseWriter, r *http.Request) {
	if !s.jobs.cancelJob(r.PathValue("id")) {
		writeError(w, http.StatusConflict, "任务不存在或已结束")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

func (s *Server) handleJobsClear(w http.ResponseWriter, r *http.Request) {
	kind := strings.TrimSpace(r.URL.Query().Get("kind"))
	if kind == "" {
		kind = "cloud.transfer"
	}
	if kind != "cloud.transfer" && kind != "cloud.download" && kind != "cloud.upload" && kind != "cloud.copy" && kind != "cloud.move" {
		writeError(w, http.StatusBadRequest, "不支持清理此类任务")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "cleared",
		"count":  s.jobs.clearFinished(kind),
	})
}
