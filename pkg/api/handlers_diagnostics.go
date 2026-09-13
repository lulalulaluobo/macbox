package api

import (
	"context"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/vm"
)

type diagnosticCheck struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Status  string `json:"status"` // pass, warn, fail
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
	Repair  string `json:"repair,omitempty"`
}

// handleSystemDiagnostics is intentionally read-only. It consolidates the
// checks that previously appeared as unrelated “Load failed” messages so an
// administrator can see which boundary failed and what action is appropriate.
func (s *Server) handleSystemDiagnostics(w http.ResponseWriter, r *http.Request) {
	cfgSnapshot, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取系统配置失败")
		return
	}
	checks := make([]diagnosticCheck, 0, 6)
	allOK := true
	add := func(check diagnosticCheck) {
		if check.Status == "fail" {
			allOK = false
		}
		checks = append(checks, check)
	}

	limaPath, limaInstalled := vm.FindLima()
	if !limaInstalled {
		add(diagnosticCheck{
			ID: "lima", Title: "Lima 环境", Status: "fail",
			Message: "未找到 limactl", Repair: "请先安装 Lima，然后返回重新检查",
		})
	} else {
		detail := limaPath
		versionCtx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		if output, versionErr := exec.CommandContext(versionCtx, limaPath, "--version").Output(); versionErr == nil {
			detail = strings.TrimSpace(string(output))
		}
		cancel()
		add(diagnosticCheck{ID: "lima", Title: "Lima 环境", Status: "pass", Message: "已安装并可执行", Detail: detail})
	}

	probeCtx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	vmStatus, vmErr := s.vmMgr.GetStatusContext(probeCtx)
	if vmErr != nil {
		add(diagnosticCheck{ID: "vm", Title: "Lima 虚拟机", Status: "fail", Message: "无法读取虚拟机状态", Detail: vmErr.Error(), Repair: "检查 Lima 安装和实例日志"})
	} else {
		switch vmStatus.Status {
		case "Running":
			add(diagnosticCheck{ID: "vm", Title: "Lima 虚拟机", Status: "pass", Message: "虚拟机正在运行", Detail: vmStatus.Name})
		case "NotCreated":
			add(diagnosticCheck{ID: "vm", Title: "Lima 虚拟机", Status: "warn", Message: "虚拟机实例尚未创建", Repair: "从初始化向导启动首次初始化"})
		default:
			add(diagnosticCheck{ID: "vm", Title: "Lima 虚拟机", Status: "fail", Message: fmt.Sprintf("虚拟机状态为 %s", vmStatus.Status), Repair: "检查启动任务或点击重试"})
		}

		if vmStatus.Status != "NotCreated" {
			if diskErr := s.vmMgr.ValidateDataDiskContext(probeCtx); diskErr != nil {
				add(diagnosticCheck{ID: "data-disk", Title: "数据盘", Status: "fail", Message: "数据盘契约校验失败", Detail: diskErr.Error(), Repair: "重新挂载数据盘，或在存储设置中解除失效绑定"})
			} else {
				add(diagnosticCheck{ID: "data-disk", Title: "数据盘", Status: "pass", Message: "数据盘可访问"})
			}
		}
		if vmStatus.Status == "Running" && vmStatus.SSHLocalPort > 0 {
			add(diagnosticCheck{ID: "ssh", Title: "SSH 管理通道", Status: "pass", Message: "root 密钥管理通道已就绪"})
		} else if vmStatus.Status == "Running" {
			add(diagnosticCheck{ID: "ssh", Title: "SSH 管理通道", Status: "fail", Message: "虚拟机已运行，但 SSH 管理端口尚未就绪", Repair: "等待 SSH 服务启动后重新检查"})
		} else {
			add(diagnosticCheck{ID: "ssh", Title: "SSH 管理通道", Status: "warn", Message: "虚拟机未运行，暂时无法检查 SSH"})
		}
	}

	if vmStatus != nil && vmStatus.Status == "Running" && vmStatus.DockerReady {
		add(diagnosticCheck{ID: "docker", Title: "Docker 服务", Status: "pass", Message: "Docker Socket 已就绪"})
	} else if vmStatus != nil && vmStatus.Status == "Running" {
		add(diagnosticCheck{ID: "docker", Title: "Docker 服务", Status: "warn", Message: "虚拟机已运行，但 Docker 尚未就绪", Repair: "等待服务启动完成后重新检查"})
	} else {
		add(diagnosticCheck{ID: "docker", Title: "Docker 服务", Status: "warn", Message: "虚拟机未运行，暂时无法检查 Docker"})
	}

	probes, probeErr := s.vmMgr.ProbeLocalMounts(probeCtx)
	if probeErr != nil {
		add(diagnosticCheck{ID: "local-mounts", Title: "本机目录直通", Status: "warn", Message: "挂载探针暂时不可用", Detail: probeErr.Error(), Repair: "等待虚拟机运行后重新检查"})
	} else {
		configured, healthy := 0, 0
		for _, probe := range probes {
			if !probe.ExpectedEnabled {
				continue
			}
			configured++
			if probe.Healthy {
				healthy++
			}
		}
		switch {
		case configured == 0:
			add(diagnosticCheck{ID: "local-mounts", Title: "本机目录直通", Status: "pass", Message: "没有启用本机目录直通"})
		case healthy == configured:
			add(diagnosticCheck{ID: "local-mounts", Title: "本机目录直通", Status: "pass", Message: fmt.Sprintf("%d 个启用的直通目录均已验证", healthy)})
		default:
			add(diagnosticCheck{ID: "local-mounts", Title: "本机目录直通", Status: "fail", Message: fmt.Sprintf("%d/%d 个启用目录验证通过", healthy, configured), Repair: "确认本机目录仍存在，并重启虚拟机应用挂载变更"})
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ok":           allOK,
		"checkedAt":    time.Now().UTC(),
		"instanceName": cfgSnapshot.VM.Name,
		"checks":       checks,
	})
}
