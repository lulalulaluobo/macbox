package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/luluen/mac-nas/pkg/config"
	"github.com/luluen/mac-nas/pkg/vm"
	"github.com/shirou/gopsutil/v3/mem"
)

// VM Handlers
func (s *Server) handleVMPrerequisites(w http.ResponseWriter, r *http.Request) {
	path, err := exec.LookPath("limactl")
	result := map[string]interface{}{
		"limaInstalled": err == nil,
		"ready":         err == nil,
		"storageReady":  true,
	}
	if err != nil {
		result["message"] = "未找到 limactl，请先安装 Lima。安装后点击重新检查。"
		if runtime.GOOS == "darwin" {
			if brewPath, brewInstalled := vm.FindHomebrew(); brewInstalled {
				result["brewInstalled"] = true
				result["brewPath"] = brewPath
				result["canInstall"] = true
				result["installCommand"] = "brew install lima"
				result["installHint"] = "可直接点击安装，MacNAS 将通过本机 Homebrew 安装 Lima。"
			} else {
				result["brewInstalled"] = false
				result["canInstall"] = false
				result["installCommand"] = `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
				result["installHint"] = "未检测到 Homebrew。请先在终端执行下方官方安装命令，完成后返回重新检查。"
			}
		}
		writeJSON(w, http.StatusOK, result)
		return
	}

	result["limaPath"] = path
	if versionOut, versionErr := exec.CommandContext(r.Context(), path, "--version").Output(); versionErr == nil {
		result["version"] = strings.TrimSpace(string(versionOut))
	}
	if vmStatus, statusErr := s.vmMgr.GetStatusContext(r.Context()); statusErr == nil && vmStatus != nil && vmStatus.Status != "NotCreated" {
		if diskErr := s.vmMgr.ValidateDataDiskContext(r.Context()); diskErr != nil {
			result["storageReady"] = false
			result["storageMessage"] = diskErr.Error()
			result["ready"] = false
		}
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleVMInstallLima(w http.ResponseWriter, _ *http.Request) {
	if runtime.GOOS != "darwin" {
		writeError(w, http.StatusBadRequest, "Lima 自动安装仅支持 macOS")
		return
	}
	if !s.vmMgr.BeginVMAction("installing-lima") {
		writeError(w, http.StatusConflict, "已有虚拟机操作正在进行")
		return
	}
	if !s.beginBackgroundWork() {
		s.vmMgr.EndVMAction()
		writeError(w, http.StatusServiceUnavailable, "服务正在关闭")
		return
	}
	ctx, cancel := s.operationContext(20 * time.Minute)
	job := s.jobs.addWithStage("lima.install", "installing", 10, "正在通过 Homebrew 安装 Lima", cancel)
	go func() {
		defer s.endBackgroundWork()
		defer s.vmMgr.EndVMAction()
		defer cancel()
		s.jobs.update(job.ID, "installing", 55, "Homebrew 正在下载并安装 Lima")
		err := vm.InstallLima(ctx)
		if err != nil {
			log.Printf("[MacNAS] Lima install error: %v", err)
		} else {
			s.jobs.update(job.ID, "verifying", 90, "Lima 已安装，正在验证 limactl")
		}
		s.jobs.finish(job.ID, err)
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "installing", "message": "正在通过 Homebrew 安装 Lima", "jobId": job.ID})
}

func (s *Server) handleVMStart(w http.ResponseWriter, r *http.Request) {
	if !s.vmMgr.BeginVMAction("starting") {
		writeError(w, http.StatusConflict, "已有虚拟机操作正在进行")
		return
	}
	if !s.beginBackgroundWork() {
		s.vmMgr.EndVMAction()
		writeError(w, http.StatusServiceUnavailable, "服务正在关闭")
		return
	}
	ctx, cancel := s.operationContext(10 * time.Minute)
	job := s.jobs.addWithStage("vm.start", "checking", 0, "正在检查 Lima、数据盘和虚拟机配置", cancel)
	go func() {
		defer s.endBackgroundWork()
		defer s.vmMgr.EndVMAction()
		defer cancel()
		err := s.vmMgr.StartWithProgress(ctx, s.projectRoot, func(stage string, progress int, message string) {
			s.jobs.update(job.ID, stage, progress, message)
		})
		if err != nil {
			log.Printf("[MacNAS] VM Start error: %v", err)
		} else {
			s.vmMgr.SetConfigDirty(false)
			if err := s.sambaMgr.EnsurePassword(ctx); err != nil {
				log.Printf("[MacNAS] ensure Samba password after VM start failed: %v", err)
			}
		}
		s.jobs.finish(job.ID, err)
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "starting", "message": "虚拟机启动中...", "jobId": job.ID})
}

func (s *Server) handleVMStop(w http.ResponseWriter, r *http.Request) {
	if !s.vmMgr.BeginVMAction("stopping") {
		writeError(w, http.StatusConflict, "已有虚拟机操作正在进行")
		return
	}
	if !s.beginBackgroundWork() {
		s.vmMgr.EndVMAction()
		writeError(w, http.StatusServiceUnavailable, "服务正在关闭")
		return
	}
	ctx, cancel := s.operationContext(2 * time.Minute)
	job := s.jobs.add("vm.stop", "虚拟机停止中", cancel)
	go func() {
		defer s.endBackgroundWork()
		defer s.vmMgr.EndVMAction()
		defer cancel()
		err := s.vmMgr.Stop(ctx)
		if err != nil {
			log.Printf("[MacNAS] VM Stop error: %v", err)
		}
		s.jobs.finish(job.ID, err)
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "stopping", "message": "虚拟机停止中...", "jobId": job.ID})
}

func (s *Server) handleVMRestart(w http.ResponseWriter, r *http.Request) {
	if !s.vmMgr.BeginVMAction("restarting") {
		writeError(w, http.StatusConflict, "已有虚拟机操作正在进行")
		return
	}
	if !s.beginBackgroundWork() {
		s.vmMgr.EndVMAction()
		writeError(w, http.StatusServiceUnavailable, "服务正在关闭")
		return
	}
	ctx, cancel := s.operationContext(10 * time.Minute)
	job := s.jobs.add("vm.restart", "虚拟机重启中", cancel)
	go func() {
		defer s.endBackgroundWork()
		defer s.vmMgr.EndVMAction()
		defer cancel()
		err := s.vmMgr.Restart(ctx, s.projectRoot)
		if err != nil {
			log.Printf("[MacNAS] VM Restart error: %v", err)
		} else {
			s.vmMgr.SetConfigDirty(false)
			if err := s.sambaMgr.EnsurePassword(ctx); err != nil {
				log.Printf("[MacNAS] ensure Samba password after VM restart failed: %v", err)
			}
		}
		s.jobs.finish(job.ID, err)
	}()
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "restarting", "message": "虚拟机重启中...", "jobId": job.ID})
}

// Storage Handlers
func (s *Server) regenerateVMConfig() error {
	cfgDir, err := config.ConfigDir()
	if err != nil {
		return err
	}
	tmplPath := filepath.Join(s.projectRoot, "templates", "vm", "macnas.yaml.tmpl")
	return s.vmMgr.GenerateConfigFile(tmplPath, filepath.Join(cfgDir, "macnas.yaml"))
}

func (s *Server) restoreConfigSnapshot(snapshot *config.Config) error {
	if snapshot == nil {
		return fmt.Errorf("配置快照为空")
	}
	return config.Update(s.cfg, func(updated *config.Config) error {
		*updated = *snapshot
		return nil
	})
}

// VM Hardware Specs Configuration Handlers
func (s *Server) handleVMConfigGet(w http.ResponseWriter, r *http.Request) {
	cfgSnapshot, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取虚拟机配置失败")
		return
	}
	totalMemGB := 16
	if vMem, err := mem.VirtualMemory(); err == nil && vMem.Total > 0 {
		totalMemGB = int(vMem.Total / 1024 / 1024 / 1024)
	}

	vmStat, _ := s.vmMgr.GetStatusContext(r.Context())
	vmStatus := "unknown"
	if vmStat != nil {
		vmStatus = vmStat.Status
	}

	resp := map[string]interface{}{
		"cpus":               cfgSnapshot.VM.CPUs,
		"memory":             cfgSnapshot.VM.Memory,
		"diskSize":           cfgSnapshot.VM.DiskSize,
		"hostCpus":           runtime.NumCPU(),
		"hostMemoryGB":       totalMemGB,
		"vmStatus":           vmStatus,
		"isDynamicMemory":    true,
		"balloonDescription": "基于 Apple Virtualization.framework (vz) 原生 Virtio-Balloon 气球驱动。配置的内存为 VM 最大使用配额，系统按需动态分水，闲置内存由 macOS 自动回收。",
		"diskDescription":    "系统根盘用于存储 Ubuntu 核心系统与 Docker 运行层。支持安全在线/重启扩容（只增不减以保障分区文件完整性）。",
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleVMConfigUpdate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CPUs     int `json:"cpus"`
		Memory   int `json:"memory"`
		DiskSize int `json:"diskSize"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数解析失败")
		return
	}
	cfgSnapshot, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取虚拟机配置失败")
		return
	}

	if req.CPUs < 1 || req.CPUs > runtime.NumCPU() {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("CPU 核心数必须在 1 到 %d 之间", runtime.NumCPU()))
		return
	}

	if req.Memory < 2 || req.Memory > 64 {
		writeError(w, http.StatusBadRequest, "内存分配必须在 2 GiB 到 64 GiB 之间")
		return
	}

	if req.DiskSize < cfgSnapshot.VM.DiskSize {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("系统盘容量只支持扩容（当前为 %d GiB，不能缩减）", cfgSnapshot.VM.DiskSize))
		return
	}

	if err := s.vmMgr.UpdateSpecs(req.CPUs, req.Memory, req.DiskSize, s.projectRoot); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	updatedConfig, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取更新后的虚拟机配置失败")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":          "success",
		"requiresRestart": true,
		"message":         "虚拟机硬件规格已更新！请重启虚拟机以加载新配置生效。",
		"cpus":            updatedConfig.VM.CPUs,
		"memory":          updatedConfig.VM.Memory,
		"diskSize":        updatedConfig.VM.DiskSize,
	})
}
