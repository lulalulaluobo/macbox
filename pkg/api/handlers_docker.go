package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/luluen/mac-nas/pkg/docker"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// Docker Handlers
func (s *Server) handleDockerOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := s.dockerClient.GetOverview(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (s *Server) handleDockerContainers(w http.ResponseWriter, r *http.Request) {
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
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	force := r.URL.Query().Get("force") == "true"
	if err := s.dockerClient.RemoveContainer(r.Context(), id, force); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerStart(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	if err := s.dockerClient.StartContainer(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerStop(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	if err := s.dockerClient.StopContainer(r.Context(), id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerRestart(w http.ResponseWriter, r *http.Request) {
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	if err := s.dockerClient.RestartContainer(r.Context(), id); err != nil {
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
	logs, err := s.dockerClient.GetLogs(r.Context(), id, tail)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"logs": logs})
}

// Docker Images Handlers
func (s *Server) handleDockerImages(w http.ResponseWriter, r *http.Request) {
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
	if !s.beginDockerOperation(w) {
		return
	}
	defer s.endDockerOperation()
	id := r.PathValue("id")
	force := r.URL.Query().Get("force") == "true"
	if err := s.dockerClient.RemoveImage(r.Context(), id, force); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleDockerPruneImages(w http.ResponseWriter, r *http.Request) {
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
		writeError(w, http.StatusInternalServerError, err.Error())
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
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

// Docker Networks & Mirrors Handlers
func (s *Server) handleDockerNetworks(w http.ResponseWriter, r *http.Request) {
	networks, err := s.dockerClient.ListNetworks(r.Context())
	if err != nil {
		writeJSON(w, http.StatusOK, []docker.DockerNetwork{})
		return
	}
	writeJSON(w, http.StatusOK, networks)
}

func (s *Server) handleDockerGetMirrors(w http.ResponseWriter, r *http.Request) {
	mirrors, err := s.dockerClient.GetRegistryMirrors(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"mirrors": mirrors})
}

func (s *Server) handleDockerSetMirrors(w http.ResponseWriter, r *http.Request) {
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
