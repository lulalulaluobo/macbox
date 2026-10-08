package api

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/remote"
)

func (s *Server) handleTailscaleStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	vmStatus, err := s.vmMgr.GetStatusContext(ctx)
	if err != nil || vmStatus == nil || vmStatus.Status != "Running" {
		writeJSON(w, http.StatusOK, remote.Status{State: "vmStopped", Message: "请先启动运行系统"})
		return
	}
	status, err := s.remoteMgr.Status(ctx)
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleTailscaleAction(w http.ResponseWriter, r *http.Request) {
	action := r.PathValue("action")
	messages := map[string]string{"install": "正在准备远程访问", "connect": "正在连接远程服务", "pause": "正在暂停远程访问", "logout": "正在退出设备登录"}
	message, ok := messages[action]
	if !ok {
		writeError(w, http.StatusNotFound, "操作不存在")
		return
	}
	if !s.remoteMgr.Begin(action) {
		writeError(w, http.StatusConflict, "请等待当前操作完成")
		return
	}
	if !s.vmMgr.BeginVMAction("remote-access") {
		s.remoteMgr.End()
		writeError(w, http.StatusConflict, "请等待系统操作完成")
		return
	}
	checkCtx, checkCancel := context.WithTimeout(r.Context(), 5*time.Second)
	vmStatus, err := s.vmMgr.GetStatusContext(checkCtx)
	checkCancel()
	if err != nil || vmStatus == nil || vmStatus.Status != "Running" {
		s.vmMgr.EndVMAction()
		s.remoteMgr.End()
		writeError(w, http.StatusConflict, "请先启动运行系统")
		return
	}
	if !s.beginBackgroundWork() {
		s.vmMgr.EndVMAction()
		s.remoteMgr.End()
		writeError(w, http.StatusServiceUnavailable, "服务正在关闭")
		return
	}
	timeout := time.Minute
	if action == "install" {
		timeout = 20 * time.Minute
	}
	ctx, cancel := s.operationContext(timeout)
	job := s.jobs.addWithStage("remote."+action, "connecting", 5, message, cancel)
	// Flush the job response before pause/logout can close this connection.
	writeJSON(w, http.StatusAccepted, map[string]string{"jobId": job.ID, "message": message})
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
	go func() {
		defer s.endBackgroundWork()
		defer s.vmMgr.EndVMAction()
		defer s.remoteMgr.End()
		defer cancel()
		var err error
		switch action {
		case "install":
			s.jobs.update(job.ID, "installing", 15, "正在安装官方客户端")
			err = s.remoteMgr.Install(ctx)
			if err == nil {
				s.jobs.update(job.ID, "connecting", 85, "正在准备账号授权")
				err = s.remoteMgr.Connect(ctx)
			}
		case "connect":
			err = s.remoteMgr.Connect(ctx)
		case "pause":
			err = s.remoteMgr.Pause(ctx)
		case "logout":
			err = s.remoteMgr.Logout(ctx)
		}
		if ctx.Err() != nil {
			err = fmt.Errorf("操作已中止，请刷新连接状态")
		}
		s.jobs.finish(job.ID, err)
	}()
}

// Keep application links usable when the console is opened over Tailscale.
// Only our own assigned address qualifies; an arbitrary Host cannot redirect
// application links. The existing Host/Origin and login checks remain active.
func (s *Server) applicationHostIP(r *http.Request) string {
	localIP := s.vmMgr.NetworkStatus(r.Context()).IP
	ip := net.ParseIP(normalizeRequestHost(r.Host)).To4()
	if ip == nil || ip[0] != 100 || ip[1] < 64 || ip[1] > 127 || s.remoteMgr == nil {
		return localIP
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	status, err := s.remoteMgr.Status(ctx)
	if err == nil && status.State == "connected" && status.IP == ip.String() {
		return status.IP
	}
	return localIP
}
