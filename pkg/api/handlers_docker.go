package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/containerengine"
	"github.com/lulalulaluobo/macbox/pkg/docker"
)

// Docker Handlers
func (s *Server) handleDockerOverview(w http.ResponseWriter, r *http.Request) {
	if s.appleContainerActive(r.Context()) {
		s.handleAppleOverview(w, r)
		return
	}
	overview, err := s.dockerClient.GetOverview(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

// handleDockerEngine reports which container engine MacBox is currently
// routing Docker commands to (host engine, Lima VM, or Apple container).
func (s *Server) handleDockerEngine(w http.ResponseWriter, r *http.Request) {
	if s.appleContainerActive(r.Context()) {
		running, _, _ := s.appleClient.SystemStatus(r.Context())
		bridgeEnabled := false
		if snapshot, err := config.Snapshot(s.cfg); err == nil {
			bridgeEnabled = snapshot.Container.AppleCompose
		}
		mockerPath, mockerInstalled := containerengine.MockerCLI()
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"mode":                s.appleEngineMode(),
			"engine":              map[string]interface{}{"kind": "apple-container", "name": "Apple container", "cliPath": s.appleClient.CLIPath(), "running": running},
			"source":              "apple",
			"appleComposeEnabled": bridgeEnabled,
			"mockerInstalled":     mockerInstalled,
			"mockerPath":          mockerPath,
		})
		return
	}
	writeJSON(w, http.StatusOK, s.dockerClient.EngineInfo(r.Context()))
}

func (s *Server) handleDockerContainers(w http.ResponseWriter, r *http.Request) {
	if s.appleContainerActive(r.Context()) {
		s.handleAppleContainers(w, r)
		return
	}
	containers, err := s.dockerClient.ListContainers(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, []docker.ContainerInfo{})
		return
	}
	writeJSON(w, http.StatusOK, containers)
}

func (s *Server) handleDockerContainerAction(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Action string `json:"action"` // start, stop, restart, remove
		Force  bool   `json:"force"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request payload")
		return
	}
	if s.appleContainerActive(r.Context()) {
		s.handleAppleContainerAction(w, r, id, req.Action, req.Force)
		return
	}
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()

	var err error
	switch req.Action {
	case "start":
		err = s.dockerClient.StartContainer(r.Context(), id)
	case "stop":
		err = s.dockerClient.StopContainer(r.Context(), id)
	case "restart":
		err = s.dockerClient.RestartContainer(r.Context(), id)
	case "remove":
		err = s.dockerClient.RemoveContainer(r.Context(), id, req.Force)
	default:
		writeError(w, http.StatusBadRequest, "Unsupported container action")
		return
	}

	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerRemoveContainer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	force := r.URL.Query().Get("force") == "true"
	if s.appleContainerActive(r.Context()) {
		s.handleAppleContainerAction(w, r, id, "remove", force)
		return
	}
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	if err := s.dockerClient.RemoveContainer(r.Context(), id, force); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerLogs(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	tailStr := r.URL.Query().Get("tail")
	tail := docker.NormalizeLogTail(0)
	if n, err := strconv.Atoi(tailStr); err == nil && n > 0 {
		tail = docker.NormalizeLogTail(n)
	}
	if s.appleContainerActive(r.Context()) {
		s.handleAppleLogs(w, r, id, tail)
		return
	}
	logs, err := s.dockerClient.GetLogs(r.Context(), id, tail)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"logs": logs})
}

// Docker Images Handlers
func (s *Server) handleDockerImages(w http.ResponseWriter, r *http.Request) {
	if s.appleContainerActive(r.Context()) {
		s.handleAppleImages(w, r)
		return
	}
	images, err := s.dockerClient.ListImages(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, []docker.ImageInfo{})
		return
	}
	writeJSON(w, http.StatusOK, images)
}

func (s *Server) handleDockerPullImage(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Image string `json:"image"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Image) == "" {
		writeError(w, http.StatusBadRequest, "镜像名称不能为空")
		return
	}
	if s.appleContainerActive(r.Context()) {
		s.handleApplePullImage(w, r, strings.TrimSpace(req.Image))
		return
	}
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()

	var buf cappedBuffer
	if err := s.dockerClient.PullImage(r.Context(), req.Image, &buf); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"logs":   buf.String(),
	})
}

func (s *Server) handleDockerRemoveImage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	force := r.URL.Query().Get("force") == "true"
	if s.appleContainerActive(r.Context()) {
		s.handleAppleRemoveImage(w, r, id, force)
		return
	}
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	if err := s.dockerClient.RemoveImage(r.Context(), id, force); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerPruneImages(w http.ResponseWriter, r *http.Request) {
	if s.appleUnsupported(w, r, "镜像清理") {
		return
	}
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	out, err := s.dockerClient.PruneImages(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "success",
		"output": out,
	})
}

// Docker Compose Handlers
func (s *Server) handleDockerComposeList(w http.ResponseWriter, r *http.Request) {
	if s.appleContainerActive(r.Context()) {
		// Reached only via composeEngine, which guarantees the mocker CLI is
		// injected into ctx. Container inventory comes from the Apple
		// `container` list (it already carries mocker compose project labels).
		containers, err := s.appleClient.List(r.Context())
		if err != nil {
			writeJSON(w, http.StatusOK, []docker.ComposeProject{})
			return
		}
		infos := make([]docker.ContainerInfo, 0, len(containers))
		for _, c := range containers {
			infos = append(infos, convertAppleContainer(c))
		}
		projects, err := s.dockerClient.ListComposeProjectsWithContainers(r.Context(), infos)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, projects)
		return
	}
	projects, err := s.dockerClient.ListComposeProjects(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, []docker.ComposeProject{})
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

func (s *Server) handleDockerComposeGetYaml(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	yamlContent, err := s.dockerClient.GetComposeYaml(r.Context(), name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"name": name,
		"yaml": yamlContent,
	})
}

func (s *Server) handleDockerComposeDeploy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
		YAML string `json:"yaml"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()

	var buf cappedBuffer
	if err := s.dockerClient.DeployCompose(r.Context(), req.Name, req.YAML, &buf); err != nil {
		detail := buf.String()
		if detail != "" {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("%v\n%s", err, detail))
		} else {
			writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"logs":   buf.String(),
	})
}

func (s *Server) handleDockerComposeDeployStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "当前连接不支持实时部署日志")
		return
	}

	var req struct {
		Name string `json:"name"`
		YAML string `json:"yaml"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher.Flush()

	sw := &appSSEWriter{w: w, flusher: flusher}
	if err := s.dockerClient.DeployCompose(r.Context(), req.Name, req.YAML, sw); err != nil {
		log.Printf("[MacBox] Compose deploy stream failed for %q: %v", req.Name, err)
		_ = writeSSEEvent(w, flusher, "error", map[string]string{"error": "Compose 部署失败，请查看上方实时日志"})
		return
	}
	_ = writeSSEEvent(w, flusher, "done", map[string]string{"status": "success", "name": req.Name})
}

func (s *Server) handleDockerComposeAction(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var req struct {
		Action string `json:"action"` // start, stop, restart, down, pull
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()

	var buf cappedBuffer
	if err := s.dockerClient.ComposeAction(r.Context(), name, req.Action, &buf); err != nil {
		detail := buf.String()
		if detail != "" {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("%v\n%s", err, detail))
		} else {
			writeError(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status": "success",
		"output": buf.String(),
	})
}

func (s *Server) handleDockerComposeDelete(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	name := r.PathValue("name")
	deleteVolumes := r.URL.Query().Get("volumes") == "true"
	if deleteVolumes && r.URL.Query().Get("confirm") != "DELETE_DATA" {
		writeError(w, http.StatusBadRequest, "删除 Compose 数据卷需要显式确认")
		return
	}
	if err := s.dockerClient.DeleteComposeProject(r.Context(), name, deleteVolumes); err != nil {
		writeError(w, dockerComposeDeleteErrorStatus(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":         "success",
		"volumesDeleted": deleteVolumes,
	})
}

func dockerComposeDeleteErrorStatus(err error) int {
	if errors.Is(err, docker.ErrSystemComposeProject) {
		return http.StatusConflict
	}
	return http.StatusInternalServerError
}

// Docker Networks & Mirrors Handlers
func (s *Server) handleDockerNetworks(w http.ResponseWriter, r *http.Request) {
	if s.appleContainerActive(r.Context()) {
		writeJSON(w, http.StatusOK, []docker.DockerNetwork{})
		return
	}
	networks, err := s.dockerClient.ListNetworks(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, []docker.DockerNetwork{})
		return
	}
	writeJSON(w, http.StatusOK, networks)
}

func (s *Server) handleDockerGetMirrors(w http.ResponseWriter, r *http.Request) {
	if s.appleUnsupported(w, r, "镜像加速设置") {
		return
	}
	mirrors, err := s.dockerClient.GetRegistryMirrors(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"mirrors": mirrors})
}

func (s *Server) handleDockerSetMirrors(w http.ResponseWriter, r *http.Request) {
	if s.appleUnsupported(w, r, "镜像加速设置") {
		return
	}
	var req struct {
		Mirrors []string `json:"mirrors"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	if err := s.dockerClient.SetRegistryMirrors(r.Context(), req.Mirrors); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

const maxBufferedCommandOutputBytes = 4 << 20

type cappedBuffer struct {
	mu        sync.Mutex
	buf       bytes.Buffer
	truncated bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	remaining := maxBufferedCommandOutputBytes - b.buf.Len()
	if remaining > 0 {
		if len(p) <= remaining {
			_, _ = b.buf.Write(p)
		} else {
			_, _ = b.buf.Write(p[:remaining])
			b.truncated = true
		}
	} else {
		b.truncated = true
	}
	return len(p), nil
}

func (b *cappedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	result := b.buf.String()
	if b.truncated {
		result += "\n[输出已截断，日志超过 4 MiB 上限]\n"
	}
	return result
}
