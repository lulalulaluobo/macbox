package api

import (
	"net/http"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/buildinfo"
	"github.com/lulalulaluobo/macbox/pkg/update"
)

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if ip := directRequestIP(r); ip == nil || !ip.IsLoopback() {
		writeError(w, http.StatusForbidden, "仅供本机启动检查")
		return
	}
	if s.authInitErr != nil {
		writeError(w, http.StatusServiceUnavailable, "认证初始化失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"version": buildinfo.Version, "status": "ready"})
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, update.Info())
}
func (s *Server) handleUpdateHistory(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{"history": s.updateMgr.History()})
}
func (s *Server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := s.operationContext(45 * time.Second)
	defer cancel()
	release, err := update.Check(ctx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, release)
}
func (s *Server) handleUpdateStart(w http.ResponseWriter, r *http.Request) {
	s.startUpdate(w, r, false)
}
func (s *Server) handleUpdateRollback(w http.ResponseWriter, r *http.Request) {
	s.startUpdate(w, r, true)
}
func (s *Server) startUpdate(w http.ResponseWriter, r *http.Request, rollback bool) {
	s.controlMu.Lock()
	defer s.controlMu.Unlock()
	if s.updateMgr.Active() {
		writeError(w, http.StatusConflict, "已有版本切换正在进行")
		return
	}
	if s.vmMgr.GetVMAction() != "" || len(s.uploadSlots) > 0 {
		writeError(w, http.StatusConflict, "请等待虚拟机操作和上传完成")
		return
	}
	s.dockerOpMu.Lock()
	dockerBusy := s.dockerOpActive
	s.dockerOpMu.Unlock()
	s.storageOpMu.Lock()
	storageBusy := s.storageOpActive
	s.storageOpMu.Unlock()
	s.mountSyncMu.Lock()
	mountBusy := s.mountSyncActive
	s.mountSyncMu.Unlock()
	if dockerBusy || storageBusy || mountBusy {
		writeError(w, http.StatusConflict, "请等待应用和存储操作完成")
		return
	}
	for _, job := range s.jobs.list() {
		if job.Status == "running" {
			writeError(w, http.StatusConflict, "请等待当前后台任务完成")
			return
		}
	}
	var release *update.Release
	if !rollback {
		ctx, cancel := s.operationContext(45 * time.Second)
		defer cancel()
		var err error
		release, err = update.Check(ctx)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
	}
	id, err := s.updateMgr.Start(release, rollback)
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"id": id, "message": "版本切换已开始，完成后请重新登录"})
}

func (s *Server) handleNetwork(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.vmMgr.NetworkStatus(r.Context()))
}
func (s *Server) handleNetworkSetup(w http.ResponseWriter, r *http.Request) {
	// Restart regenerates the bridge configuration while retaining the VM disks.
	s.handleVMRestart(w, r)
}
