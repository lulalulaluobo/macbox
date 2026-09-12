package api

import (
	"encoding/json"
	"fmt"
	"github.com/luluen/mac-nas/pkg/terminal"
	"net/http"
	"strconv"
	"strings"
)

// Web Terminal Handlers
func (s *Server) handleTerminalWS(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("user") == "" {
		defUser := s.termSettingsMgr.Get().DefaultLoginUser
		if defUser == "root" {
			q := r.URL.Query()
			q.Set("user", "root")
			r.URL.RawQuery = q.Encode()
		}
	}
	terminal.HandleTerminalWS(w, r, s.vmMgr.InstanceName(), s.allowedOrigins, s.terminalMgr)
}

// File System Handlers
func (s *Server) handleTerminalFilesList(w http.ResponseWriter, r *http.Request) {
	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		targetPath = "/data"
	}

	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, hasMore, err := terminal.ListFilesPageContext(r.Context(), s.vmMgr.InstanceName(), targetPath, offset, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":     "success",
		"path":       targetPath,
		"items":      items,
		"hasMore":    hasMore,
		"nextOffset": offset + len(items),
	})
}

func (s *Server) handleTerminalFileRead(w http.ResponseWriter, r *http.Request) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		writeError(w, http.StatusBadRequest, "缺少文件路径")
		return
	}

	content, err := terminal.ReadFileContext(r.Context(), s.vmMgr.InstanceName(), filePath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"path":    filePath,
		"content": content,
	})
}

func (s *Server) handleTerminalFileWrite(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}

	if req.Path == "" {
		writeError(w, http.StatusBadRequest, "文件路径不能为空")
		return
	}

	if err := terminal.WriteFileContext(r.Context(), s.vmMgr.InstanceName(), req.Path, req.Content); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "文件保存成功"})
}

func (s *Server) handleTerminalFileMkdir(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}

	if req.Path == "" {
		writeError(w, http.StatusBadRequest, "文件夹路径不能为空")
		return
	}

	if err := terminal.CreateDirContext(r.Context(), s.vmMgr.InstanceName(), req.Path); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "文件夹创建成功"})
}

func (s *Server) handleTerminalFileUpload(w http.ResponseWriter, r *http.Request) {
	const maxUploadSize int64 = 10 << 30
	if r.ContentLength > maxUploadSize {
		writeError(w, http.StatusRequestEntityTooLarge, "上传文件不能超过 10 GiB")
		return
	}
	if s.uploadSlots != nil {
		select {
		case s.uploadSlots <- struct{}{}:
			defer func() { <-s.uploadSlots }()
		default:
			writeError(w, http.StatusTooManyRequests, "当前已有多个文件在上传，请稍后重试")
			return
		}
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
	// Keep the destination outside the multipart body so the upload can be
	// streamed directly to the VM without ParseMultipartForm spooling it to
	// the host's temporary directory.
	targetDir := r.URL.Query().Get("targetDir")
	if targetDir == "" {
		targetDir = "/data"
	}

	if err := terminal.UploadFile(w, r, s.vmMgr.InstanceName(), targetDir); err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(err.Error(), "request body too large") {
			status = http.StatusRequestEntityTooLarge
		}
		writeError(w, status, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "文件上传成功"})
}

func (s *Server) handleTerminalFileDelete(w http.ResponseWriter, r *http.Request) {
	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		writeError(w, http.StatusBadRequest, "缺少路径参数")
		return
	}

	if err := terminal.DeletePathContext(r.Context(), s.vmMgr.InstanceName(), targetPath); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "删除成功"})
}

func (s *Server) handleTerminalFileDownload(w http.ResponseWriter, r *http.Request) {
	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		writeError(w, http.StatusBadRequest, "缺少路径参数")
		return
	}

	terminal.DownloadFile(w, r, s.vmMgr.InstanceName(), targetPath)
}

func (s *Server) handleTerminalArchive(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Operation   string   `json:"operation"`
		Format      string   `json:"format"`
		Destination string   `json:"destination"`
		SourcePaths []string `json:"sourcePaths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析错误")
		return
	}
	if req.Operation == "" || req.Format == "" || req.Destination == "" || len(req.SourcePaths) == 0 {
		writeError(w, http.StatusBadRequest, "压缩操作、格式、目标路径和源路径均不能为空")
		return
	}

	if err := terminal.ArchivePathsContext(r.Context(), s.vmMgr.InstanceName(), req.Operation, req.Format, req.Destination, req.SourcePaths); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	message := "文件压缩成功"
	if strings.EqualFold(req.Operation, "extract") {
		message = "文件解压成功"
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": message})
}

func (s *Server) handleTerminalFileRename(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OldPath string `json:"oldPath"`
		NewPath string `json:"newPath"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析错误")
		return
	}

	if req.OldPath == "" || req.NewPath == "" {
		writeError(w, http.StatusBadRequest, "原路径和新路径均不能为空")
		return
	}

	if err := terminal.RenamePathContext(r.Context(), s.vmMgr.InstanceName(), req.OldPath, req.NewPath); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "success", "message": "重命名成功"})
}

func (s *Server) handleTerminalFileRaw(w http.ResponseWriter, r *http.Request) {
	targetPath := r.URL.Query().Get("path")
	if targetPath == "" {
		writeError(w, http.StatusBadRequest, "缺少路径参数")
		return
	}

	terminal.StreamMediaFile(w, r, s.vmMgr.InstanceName(), targetPath)
}

func (s *Server) handleTerminalFilesCopy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SrcPaths []string `json:"srcPaths"`
		DestDir  string   `json:"destDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析错误")
		return
	}
	if len(req.SrcPaths) == 0 || req.DestDir == "" {
		writeError(w, http.StatusBadRequest, "源文件与目标目录均不能为空")
		return
	}

	if err := terminal.CopyPathsContext(r.Context(), s.vmMgr.InstanceName(), req.SrcPaths, req.DestDir); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("已成功复制 %d 个项目到目标目录", len(req.SrcPaths)),
	})
}

func (s *Server) handleTerminalFilesMove(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SrcPaths []string `json:"srcPaths"`
		DestDir  string   `json:"destDir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析错误")
		return
	}
	if len(req.SrcPaths) == 0 || req.DestDir == "" {
		writeError(w, http.StatusBadRequest, "源文件与目标目录均不能为空")
		return
	}

	if err := terminal.MovePathsContext(r.Context(), s.vmMgr.InstanceName(), req.SrcPaths, req.DestDir); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("已成功移动 %d 个项目到目标目录", len(req.SrcPaths)),
	})
}

func (s *Server) handleTerminalFilesTrash(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Paths []string `json:"paths"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析错误")
		return
	}
	if len(req.Paths) == 0 {
		writeError(w, http.StatusBadRequest, "未选择要移入回收站的项目")
		return
	}

	if err := terminal.MoveToTrashContext(r.Context(), s.vmMgr.InstanceName(), req.Paths); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("已将 %d 个项目移入回收站", len(req.Paths)),
	})
}

func (s *Server) handleTerminalFilesTrashList(w http.ResponseWriter, r *http.Request) {
	items, err := terminal.ListTrashContext(r.Context(), s.vmMgr.InstanceName())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "success",
		"items":  items,
	})
}

func (s *Server) handleTerminalFilesRestore(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析错误")
		return
	}
	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "未选择要还原的项目")
		return
	}

	if err := terminal.RestoreTrashContext(r.Context(), s.vmMgr.InstanceName(), req.IDs); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "success",
		"message": fmt.Sprintf("已成功还原 %d 个项目", len(req.IDs)),
	})
}

func (s *Server) handleTerminalFilesTrashDelete(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数解析错误")
		return
	}
	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "未选择要删除的项目")
		return
	}

	count, err := terminal.DeleteTrashItemsContext(r.Context(), s.vmMgr.InstanceName(), req.IDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"message": fmt.Sprintf("已成功将 %d 个项目移入 Mac 本机废纸篓 (~/.Trash)", count),
		"count":   count,
	})
}

func (s *Server) handleTerminalFilesEmptyTrash(w http.ResponseWriter, r *http.Request) {
	count, err := terminal.EmptyTrashContext(r.Context(), s.vmMgr.InstanceName())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "success",
		"message": fmt.Sprintf("回收站已清空，所有 %d 个项目已安全移入 Mac 本机废纸篓 (~/.Trash)", count),
		"count":   count,
	})
}
