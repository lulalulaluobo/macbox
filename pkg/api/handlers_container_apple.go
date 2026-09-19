// Apple `container` CLI bridges for the /api/docker handler family. When the
// apple engine is selected, read handlers convert `container` output into the
// docker response shapes; compose, prune and mirrors are rejected with 501.
package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/containerapple"
	"github.com/lulalulaluobo/macbox/pkg/containerengine"
	"github.com/lulalulaluobo/macbox/pkg/docker"
)

// appleContainerIDPattern matches `container` instance names/IDs; the leading
// dash exclusion keeps values from being parsed as CLI flags.
var appleContainerIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// appleEngineMode reports the configured container.mode for API responses.
func (s *Server) appleEngineMode() string {
	if snapshot, err := config.Snapshot(s.cfg); err == nil {
		return snapshot.Container.Mode
	}
	return "auto"
}

func (s *Server) appleContainerActive(ctx context.Context) bool {
	if s.appleClient == nil {
		return false
	}
	mode, dockerMode := "auto", "auto"
	if snapshot, err := config.Snapshot(s.cfg); err == nil {
		mode = snapshot.Container.Mode
		dockerMode = snapshot.VM.DockerMode
	}
	switch mode {
	case "docker":
		return false
	case "apple":
		return true
	}
	// vm mode pins the engine to the Lima VM; never auto-fall-back to Apple.
	if dockerMode == "vm" {
		return false
	}
	// auto: only take over when no docker engine (host or Lima VM) answers.
	info := s.dockerClient.EngineInfo(ctx)
	source, _ := info["source"].(string)
	return source == "none"
}

func (s *Server) appleUnsupported(w http.ResponseWriter, r *http.Request, feature string) bool {
	if !s.appleContainerActive(r.Context()) {
		return false
	}
	writeError(w, http.StatusNotImplemented, fmt.Sprintf("当前使用 Apple container 引擎，%s 暂不支持", feature))
	return true
}

// composeEngine guards Compose-dependent routes. Outside the Apple engine it
// passes through unchanged. With Apple selected and the experimental bridge
// off it returns 501; on but without mocker it returns 503 with install
// instructions; ready requests run with the mocker CLI injected into the
// context so the docker package executes `compose` commands on macOS.
func (s *Server) composeEngine(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.appleContainerActive(r.Context()) {
			next(w, r)
			return
		}
		snapshot, err := config.Snapshot(s.cfg)
		if err != nil || !snapshot.Container.AppleCompose {
			writeError(w, http.StatusNotImplemented, "当前使用 Apple container 引擎，Compose 相关功能暂不支持。可在 设置 → 实验性功能 中开启 mocker Compose 兼容层")
			return
		}
		cli, ok := containerengine.MockerCLI()
		if !ok {
			writeError(w, http.StatusServiceUnavailable, "未检测到 mocker CLI，请执行: brew tap us/tap && brew install mocker")
			return
		}
		next(w, r.WithContext(docker.WithComposeCLI(r.Context(), cli)))
	}
}

// handleAppleComposeGet reports the experimental bridge state for Settings UI.
func (s *Server) handleAppleComposeGet(w http.ResponseWriter, r *http.Request) {
	enabled := false
	if snapshot, err := config.Snapshot(s.cfg); err == nil {
		enabled = snapshot.Container.AppleCompose
	}
	cli, installed := containerengine.MockerCLI()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled":         enabled,
		"mockerInstalled": installed,
		"mockerPath":      cli,
	})
}

// handleAppleComposeSet toggles the experimental bridge.
func (s *Server) handleAppleComposeSet(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Enabled *bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Enabled == nil {
		writeError(w, http.StatusBadRequest, "请求体需包含 enabled 布尔值")
		return
	}
	if err := config.Update(s.cfg, func(c *config.Config) error {
		c.Container.AppleCompose = *req.Enabled
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.handleAppleComposeGet(w, r)
}

func (s *Server) appleContainerID(w http.ResponseWriter, id string) (string, bool) {
	if id == "" || !appleContainerIDPattern.MatchString(id) {
		writeError(w, http.StatusBadRequest, "容器标识格式无效")
		return "", false
	}
	return id, true
}

func convertAppleContainer(c containerapple.Container) docker.ContainerInfo {
	state := c.State()
	if state == "" {
		state = "unknown"
	}
	info := docker.ContainerInfo{
		ID:        c.Name(),
		Names:     c.Name(),
		Image:     c.ImageRef(),
		State:     state,
		Status:    state,
		CreatedAt: c.Configuration.CreationDate,
		Project:   c.Project(),
		CPUPerc:   "-",
		MemUsage:  "-",
		MemPerc:   "-",
		NetIO:     "-",
		BlockIO:   "-",
	}
	if info.Image == "" {
		info.Image = "<none>"
	}
	return info
}

func splitAppleImageName(name string) (repository, tag string) {
	if name == "" {
		return "<none>", "<none>"
	}
	lastSlash := strings.LastIndex(name, "/")
	colon := strings.LastIndex(name, ":")
	if colon > lastSlash {
		return name[:colon], name[colon+1:]
	}
	return name, "latest"
}

func (s *Server) appleContainersAndImages(ctx context.Context) ([]containerapple.Container, []containerapple.Image) {
	containers, err := s.appleClient.List(ctx)
	if err != nil {
		containers = nil
	}
	images, err := s.appleClient.ImageList(ctx)
	if err != nil {
		images = nil
	}
	return containers, images
}

func (s *Server) handleAppleContainers(w http.ResponseWriter, r *http.Request) {
	containers, _ := s.appleClient.List(r.Context())
	infos := make([]docker.ContainerInfo, 0, len(containers))
	for _, c := range containers {
		infos = append(infos, convertAppleContainer(c))
	}
	writeJSON(w, http.StatusOK, infos)
}

func (s *Server) handleAppleImages(w http.ResponseWriter, r *http.Request) {
	containers, images := s.appleContainersAndImages(r.Context())
	usage := map[string]int{}
	for _, c := range containers {
		usage[c.ImageRef()]++
	}
	infos := make([]docker.ImageInfo, 0, len(images))
	for _, img := range images {
		repo, tag := splitAppleImageName(img.Configuration.Name)
		inUse := usage[img.Configuration.Name] > 0
		infos = append(infos, docker.ImageInfo{
			ID:         img.Configuration.Name,
			Repository: repo,
			Tag:        tag,
			Size:       formatBytes(img.Configuration.Descriptor.Size),
			SizeBytes:  img.Configuration.Descriptor.Size,
			CreatedAt:  img.Configuration.CreationDate,
			Containers: usage[img.Configuration.Name],
			InUse:      inUse,
		})
	}
	writeJSON(w, http.StatusOK, infos)
}

func (s *Server) handleAppleOverview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	containers, images := s.appleContainersAndImages(ctx)
	running := 0
	for _, c := range containers {
		if c.Running() {
			running++
		}
	}
	usedRefs := map[string]bool{}
	for _, c := range containers {
		usedRefs[c.ImageRef()] = true
	}
	inUse := 0
	for _, img := range images {
		if usedRefs[img.Configuration.Name] {
			inUse++
		}
	}
	sysRunning, sysDetail, _ := s.appleClient.SystemStatus(ctx)
	version := s.appleClient.Version(ctx)

	healthy := sysRunning
	message := "Apple container 服务运行中"
	if !sysRunning {
		message = "Apple container 服务未运行（macbox container system start 可启动）"
		if sysDetail != "" {
			message += "：" + sysDetail
		}
	} else if len(containers) == 0 {
		message = "Apple container 服务正常，暂无容器实例"
	}

	autoStart := false
	if snapshot, err := config.Snapshot(s.cfg); err == nil {
		autoStart = snapshot.System.PreventSleep
	}

	writeJSON(w, http.StatusOK, docker.DockerOverview{
		Healthy:           healthy,
		HealthMessage:     message,
		DockerReady:       sysRunning,
		DockerVersion:     version,
		StorageLocation:   "Apple container（macOS 原生容器）",
		AutoStart:         autoStart,
		ContainersTotal:   len(containers),
		ContainersRunning: running,
		ContainersStopped: len(containers) - running,
		ImagesTotal:       len(images),
		ImagesInUse:       inUse,
	})
}

func (s *Server) handleAppleContainerAction(w http.ResponseWriter, r *http.Request, id, action string, force bool) {
	if _, ok := s.appleContainerID(w, id); !ok {
		return
	}
	ctx := r.Context()
	var err error
	switch action {
	case "start":
		err = s.appleClient.Start(ctx, id)
	case "stop":
		err = s.appleClient.Stop(ctx, id, 10*time.Second)
	case "restart":
		if err = s.appleClient.Stop(ctx, id, 10*time.Second); err == nil {
			err = s.appleClient.Start(ctx, id)
		}
	case "remove":
		err = s.appleClient.Delete(ctx, id, force)
	default:
		writeError(w, http.StatusBadRequest, "Apple container 不支持该操作")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func (s *Server) handleAppleLogs(w http.ResponseWriter, r *http.Request, id string, tail int) {
	if _, ok := s.appleContainerID(w, id); !ok {
		return
	}
	logs, err := s.appleClient.LogsStream(r.Context(), id, tail)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"logs": string(logs)})
}

func (s *Server) handleApplePullImage(w http.ResponseWriter, r *http.Request, image string) {
	if err := s.appleClient.ImagePull(r.Context(), image); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "success", "logs": "镜像拉取完成"})
}

func (s *Server) handleAppleRemoveImage(w http.ResponseWriter, r *http.Request, id string, force bool) {
	if id == "" {
		writeError(w, http.StatusBadRequest, "镜像标识不能为空")
		return
	}
	if err := s.appleClient.ImageDelete(r.Context(), id, force); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success"})
}

func formatBytes(size int64) string {
	if size <= 0 {
		return "-"
	}
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%dB", size)
	}
	div, exp := int64(unit), 0
	for n := size / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f%ciB", float64(size)/float64(div), "KMGTP"[exp])
}
