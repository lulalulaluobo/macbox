package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/lulalulaluobo/macbox/pkg/cloud"
	"github.com/lulalulaluobo/macbox/pkg/config"
	"github.com/lulalulaluobo/macbox/pkg/terminal"
)

type quarkQRSession struct {
	mu        sync.Mutex
	token     string
	qrURL     string
	expiresAt time.Time
	status    string
	cookie    string
	account   string
}

type cloudFileResponse struct {
	Fid       string `json:"fid"`
	Name      string `json:"name"`
	IsDir     bool   `json:"isDir"`
	Size      int64  `json:"size"`
	UpdatedAt int64  `json:"updatedAt"`
}

type cloudDownloadRequest struct {
	Fid         string `json:"fid"`
	Name        string `json:"name"`
	IsDir       bool   `json:"isDir"`
	Size        int64  `json:"size"`
	Destination string `json:"destination"`
}

type cloudDownloadEntry struct {
	fid      string
	relative string
	size     int64
}

type cloudFileTransferRequest struct {
	Fids      []string `json:"fids"`
	TargetFid string   `json:"targetFid"`
}

const maxCloudUploadSize int64 = 10 << 30

func (s *Server) handleQuarkQRBegin(w http.ResponseWriter, r *http.Request) {
	challenge, err := cloud.BeginQuarkQRLogin(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	id := newJobID()
	s.cloudAuthMu.Lock()
	if len(s.quarkQR) > 20 {
		for key, session := range s.quarkQR {
			session.mu.Lock()
			expired := time.Now().After(session.expiresAt)
			session.mu.Unlock()
			if expired {
				delete(s.quarkQR, key)
			}
		}
	}
	s.quarkQR[id] = &quarkQRSession{token: challenge.Token, qrURL: challenge.URL, expiresAt: challenge.ExpiresAt, status: "pending"}
	s.cloudAuthMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"loginId":   id,
		"qrURL":     challenge.URL,
		"imageURL":  "/api/storage/cloud-auth/quark/qr/" + id + "/image",
		"expiresAt": challenge.ExpiresAt,
	})
}

func (s *Server) quarkQRSession(id string) (*quarkQRSession, bool) {
	s.cloudAuthMu.Lock()
	session, ok := s.quarkQR[id]
	s.cloudAuthMu.Unlock()
	return session, ok
}

func (s *Server) handleQuarkQRImage(w http.ResponseWriter, r *http.Request) {
	session, ok := s.quarkQRSession(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "扫码会话不存在或已过期")
		return
	}
	session.mu.Lock()
	qrURL, expiresAt := session.qrURL, session.expiresAt
	session.mu.Unlock()
	if time.Now().After(expiresAt) {
		writeError(w, http.StatusGone, "二维码已过期，请重新生成")
		return
	}
	png, err := cloud.QuarkQRPNG(qrURL)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "生成二维码失败")
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(png)
}

func (s *Server) handleQuarkQRPoll(w http.ResponseWriter, r *http.Request) {
	session, ok := s.quarkQRSession(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "扫码会话不存在或已过期")
		return
	}
	session.mu.Lock()
	if time.Now().After(session.expiresAt) {
		session.status = "expired"
	}
	status, account, token := session.status, session.account, session.token
	session.mu.Unlock()
	if status == "expired" {
		writeJSON(w, http.StatusOK, map[string]any{"status": "expired"})
		return
	}
	if status == "connected" {
		writeJSON(w, http.StatusOK, map[string]any{"status": status, "account": account})
		return
	}

	result, err := cloud.PollQuarkQRLogin(r.Context(), token)
	if err != nil {
		// Polling network failures are transient from the browser's point of
		// view. Keep the QR session alive and let the next poll retry.
		writeJSON(w, http.StatusOK, map[string]any{"status": "pending", "message": err.Error()})
		return
	}
	if result.Pending {
		writeJSON(w, http.StatusOK, map[string]string{"status": "pending"})
		return
	}
	session.mu.Lock()
	session.status = "connected"
	session.cookie = result.Cookie
	session.account = result.Account
	session.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"status": "connected", "account": result.Account})
}

func (s *Server) handleQuarkMountFromQR(w http.ResponseWriter, r *http.Request) {
	session, ok := s.quarkQRSession(r.PathValue("id"))
	if !ok {
		writeError(w, http.StatusNotFound, "扫码会话不存在或已过期")
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}
	session.mu.Lock()
	cookie, account, status := session.cookie, session.account, session.status
	session.mu.Unlock()
	if status != "connected" || cookie == "" {
		writeError(w, http.StatusConflict, "请先完成扫码登录")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "夸克网盘"
	}
	mount := config.CloudMount{
		ID: "quark-" + strconv.FormatInt(time.Now().UnixNano(), 10), Provider: "quark", Name: name,
		Cookie: cookie, RootFid: "0", Account: account, Status: "checking",
	}
	if err := config.ValidateCloudMount(mount); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	client, err := cloud.NewQuarkClient(cookie)
	if err == nil {
		err = client.Test(r.Context())
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "夸克账号验证失败: "+err.Error())
		return
	}
	mount.Status = "connected"
	mount.LastChecked = time.Now().UTC()
	if err := config.Update(s.cfg, func(updated *config.Config) error {
		updated.Cloud.Mounts = append(updated.Cloud.Mounts, mount)
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "保存云盘配置失败")
		return
	}
	s.cloudAuthMu.Lock()
	delete(s.quarkQR, r.PathValue("id"))
	s.cloudAuthMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"status": "connected", "mount": mount})
}

func (s *Server) handleCloudMountsList(w http.ResponseWriter, r *http.Request) {
	snapshot, err := config.Snapshot(s.cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取云盘配置失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mounts": snapshot.Cloud.Mounts})
}

func (s *Server) cloudMount(id string) (config.CloudMount, error) {
	snapshot, err := config.Snapshot(s.cfg)
	if err != nil {
		return config.CloudMount{}, err
	}
	for _, mount := range snapshot.Cloud.Mounts {
		if mount.ID == id {
			return mount, nil
		}
	}
	return config.CloudMount{}, fmt.Errorf("云盘挂载不存在")
}

func (s *Server) handleCloudMountCheck(w http.ResponseWriter, r *http.Request) {
	mount, err := s.cloudMount(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	client, err := cloud.NewQuarkClient(mount.Cookie)
	if err == nil {
		err = client.Test(r.Context())
	}
	status, message := "connected", "云盘连接正常"
	if err != nil {
		status, message = "error", err.Error()
	}
	if updateErr := config.Update(s.cfg, func(updated *config.Config) error {
		for i := range updated.Cloud.Mounts {
			if updated.Cloud.Mounts[i].ID == mount.ID {
				updated.Cloud.Mounts[i].Status = status
				updated.Cloud.Mounts[i].Message = message
				updated.Cloud.Mounts[i].LastChecked = time.Now().UTC()
			}
		}
		return nil
	}); updateErr != nil {
		writeError(w, http.StatusInternalServerError, "保存云盘状态失败")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": status, "message": message})
}

func (s *Server) handleCloudMountDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.cloudMount(id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	if err := config.Update(s.cfg, func(updated *config.Config) error {
		filtered := updated.Cloud.Mounts[:0]
		for _, mount := range updated.Cloud.Mounts {
			if mount.ID != id {
				filtered = append(filtered, mount)
			}
		}
		updated.Cloud.Mounts = filtered
		return nil
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "删除云盘配置失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) cloudClient(id string) (*cloud.Client, config.CloudMount, error) {
	mount, err := s.cloudMount(id)
	if err != nil {
		return nil, config.CloudMount{}, err
	}
	client, err := cloud.NewQuarkClient(mount.Cookie)
	if err != nil {
		return nil, config.CloudMount{}, err
	}
	return client, mount, nil
}

func (s *Server) handleCloudFilesList(w http.ResponseWriter, r *http.Request) {
	client, mount, err := s.cloudClient(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	parentFid := r.URL.Query().Get("fid")
	if parentFid == "" {
		parentFid = mount.RootFid
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, hasMore, err := client.List(r.Context(), parentFid, offset, limit)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	result := make([]cloudFileResponse, 0, len(items))
	for _, item := range items {
		result = append(result, cloudFileResponse{Fid: item.Fid, Name: item.Name, IsDir: item.IsDir, Size: item.Size, UpdatedAt: item.UpdatedAt})
	}
	writeJSON(w, http.StatusOK, map[string]any{"mount": mount, "parentFid": parentFid, "items": result, "hasMore": hasMore, "nextOffset": offset + len(result)})
}

func (s *Server) handleCloudFolderCreate(w http.ResponseWriter, r *http.Request) {
	client, _, err := s.cloudClient(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	var req struct {
		ParentFid string `json:"parentFid"`
		Name      string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}
	if err := client.CreateFolder(r.Context(), req.ParentFid, req.Name); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "created"})
}

func (s *Server) handleCloudFileRename(w http.ResponseWriter, r *http.Request) {
	client, _, err := s.cloudClient(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	var req struct {
		Fid  string `json:"fid"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}
	if err := client.Rename(r.Context(), req.Fid, req.Name); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "renamed"})
}

func (s *Server) handleCloudFileDelete(w http.ResponseWriter, r *http.Request) {
	client, _, err := s.cloudClient(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	fid := r.URL.Query().Get("fid")
	if err := client.Delete(r.Context(), []string{fid}); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleCloudFileCopy(w http.ResponseWriter, r *http.Request) {
	s.handleCloudFileTransfer(w, r, true)
}

func (s *Server) handleCloudFileMove(w http.ResponseWriter, r *http.Request) {
	s.handleCloudFileTransfer(w, r, false)
}

func (s *Server) handleCloudFileTransfer(w http.ResponseWriter, r *http.Request, copyFiles bool) {
	client, _, err := s.cloudClient(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	var req cloudFileTransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}
	if req.TargetFid == "" {
		req.TargetFid = "0"
	}
	if copyFiles {
		err = client.Copy(r.Context(), req.Fids, req.TargetFid)
	} else {
		err = client.Move(r.Context(), req.Fids, req.TargetFid)
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	status := "moved"
	if copyFiles {
		status = "copied"
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": status})
}

func (s *Server) handleCloudUpload(w http.ResponseWriter, r *http.Request) {
	if r.ContentLength > maxCloudUploadSize+(1<<20) {
		writeError(w, http.StatusRequestEntityTooLarge, "上传文件不能超过 10 GiB")
		return
	}
	slotAcquired := false
	if s.uploadSlots != nil {
		select {
		case s.uploadSlots <- struct{}{}:
			slotAcquired = true
		default:
			writeError(w, http.StatusTooManyRequests, "当前已有多个文件在上传，请稍后重试")
			return
		}
	}
	releaseSlot := func() {
		if slotAcquired {
			<-s.uploadSlots
			slotAcquired = false
		}
	}
	defer releaseSlot()

	r.Body = http.MaxBytesReader(w, r.Body, maxCloudUploadSize+(1<<20))
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "上传请求格式无效")
		return
	}
	part, err := reader.NextPart()
	if err == io.EOF {
		writeError(w, http.StatusBadRequest, "上传文件不能为空")
		return
	}
	if err != nil || part.FormName() != "file" {
		writeError(w, http.StatusBadRequest, "上传请求必须包含 file 文件字段")
		return
	}
	fileName := path.Base(strings.ReplaceAll(part.FileName(), "\\", "/"))
	if err := validateCloudFileName(fileName); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	parentFid := r.URL.Query().Get("parentFid")
	if parentFid == "" {
		parentFid = "0"
	}
	if _, _, err := s.cloudClient(r.PathValue("id")); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	tempFile, err := os.CreateTemp("", "macbox-quark-upload-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "准备上传临时文件失败")
		return
	}
	tempPath := tempFile.Name()
	keepTemp := false
	defer func() {
		_ = tempFile.Close()
		if !keepTemp {
			_ = os.Remove(tempPath)
		}
	}()
	written, err := io.Copy(tempFile, io.LimitReader(part, maxCloudUploadSize+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "读取上传文件失败")
		return
	}
	if written > maxCloudUploadSize {
		writeError(w, http.StatusRequestEntityTooLarge, "上传文件不能超过 10 GiB")
		return
	}
	if err := tempFile.Close(); err != nil {
		writeError(w, http.StatusInternalServerError, "保存上传临时文件失败")
		return
	}

	ctx, cancel := context.WithCancel(s.serverCtx)
	job := s.jobs.addWithStage("cloud.upload", "queued", 0, "准备上传到夸克网盘", cancel)
	mountID := r.PathValue("id")
	ownsSlot := slotAcquired
	slotAcquired = false
	keepTemp = true
	go func() {
		if ownsSlot {
			defer func() { <-s.uploadSlots }()
		}
		defer os.Remove(tempPath)
		err := s.runCloudUpload(ctx, job.ID, mountID, tempPath, parentFid, fileName, written)
		s.jobs.finish(job.ID, err)
	}()
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "started", "jobId": job.ID})
}

func (s *Server) runCloudUpload(ctx context.Context, jobID, mountID, tempPath, parentFid, fileName string, total int64) error {
	client, _, err := s.cloudClient(mountID)
	if err != nil {
		return err
	}
	s.jobs.updateTransfer(jobID, "uploading", 0, "正在上传到夸克网盘", fileName, 0, total, 0)
	started := time.Now()
	err = client.UploadFile(ctx, tempPath, parentFid, fileName, func(done, size int64) {
		progress := 0
		if size > 0 {
			progress = int(done * 100 / size)
		}
		speed := int64(float64(done) / maxDurationSeconds(time.Since(started)))
		s.jobs.updateTransfer(jobID, "uploading", progress, "正在上传到夸克网盘", fileName, done, size, speed)
	})
	if err != nil {
		return fmt.Errorf("上传 %s 失败: %w", fileName, err)
	}
	s.jobs.updateTransfer(jobID, "completed", 100, "已上传到夸克网盘", fileName, total, total, int64(float64(total)/maxDurationSeconds(time.Since(started))))
	return nil
}

func (s *Server) handleCloudDownload(w http.ResponseWriter, r *http.Request) {
	var req cloudDownloadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "参数错误")
		return
	}
	if req.Destination == "" {
		req.Destination = "/data/downloads"
	}
	destination := path.Clean(req.Destination)
	if destination != "/data" && !strings.HasPrefix(destination, "/data/") {
		writeError(w, http.StatusBadRequest, "下载目标必须位于 MacBox 数据目录下")
		return
	}
	req.Destination = destination
	if err := validateCloudFileName(req.Name); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, _, err := s.cloudClient(r.PathValue("id")); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	ctx, cancel := context.WithCancel(s.serverCtx)
	job := s.jobs.addWithStage("cloud.download", "queued", 0, "准备下载到 MacBox", cancel)
	mountID := r.PathValue("id")
	go func() {
		err := s.runCloudDownload(ctx, job.ID, mountID, req)
		s.jobs.finish(job.ID, err)
	}()
	writeJSON(w, http.StatusAccepted, map[string]any{"status": "started", "jobId": job.ID})
}

func validateCloudFileName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." || len([]byte(name)) > 255 || strings.ContainsAny(name, "/\\") || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return fmt.Errorf("云端文件名称无效")
	}
	return nil
}

func (s *Server) runCloudDownload(ctx context.Context, jobID, mountID string, req cloudDownloadRequest) error {
	client, _, err := s.cloudClient(mountID)
	if err != nil {
		return err
	}
	if err := terminal.CreateDirContext(ctx, s.vmMgr.InstanceName(), path.Clean(req.Destination)); err != nil {
		return fmt.Errorf("准备下载目录失败: %w", err)
	}
	entries := []cloudDownloadEntry{{fid: req.Fid, relative: req.Name, size: req.Size}}
	if req.IsDir {
		if err := terminal.CreateDirContext(ctx, s.vmMgr.InstanceName(), path.Join(req.Destination, req.Name)); err != nil {
			return fmt.Errorf("准备云端文件夹失败: %w", err)
		}
		entries = entries[:0]
		if err := collectCloudFiles(ctx, client, req.Fid, req.Name, &entries, 0); err != nil {
			return err
		}
	}
	var total int64
	for _, entry := range entries {
		total += entry.size
	}
	if total > 0 {
		s.jobs.updateTransfer(jobID, "downloading", 0, fmt.Sprintf("共 %d 个文件", len(entries)), "", 0, total, 0)
	} else {
		s.jobs.updateTransfer(jobID, "downloading", 0, fmt.Sprintf("共 %d 个文件", len(entries)), "", 0, 0, 0)
	}
	started := time.Now()
	var done int64
	for index, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		stream, err := client.Download(ctx, entry.fid)
		if err != nil {
			return fmt.Errorf("下载 %s 失败: %w", entry.relative, err)
		}
		if entry.size == 0 && stream.Size > 0 {
			if total == 0 {
				total = stream.Size
			} else {
				total += stream.Size
			}
		}
		target := path.Join(req.Destination, entry.relative)
		if err := terminal.CreateDirContext(ctx, s.vmMgr.InstanceName(), path.Dir(target)); err != nil {
			stream.Body.Close()
			return fmt.Errorf("准备文件目录失败: %w", err)
		}
		var reporter *cloudProgressReader
		reporter = &cloudProgressReader{reader: stream.Body, onBytes: func(n int64) {
			done += n
			now := time.Now()
			if done%(512<<10) < n || now.Sub(reporter.lastUpdate) >= 500*time.Millisecond {
				reporter.lastUpdate = now
				speed := int64(float64(done) / maxDurationSeconds(now.Sub(started)))
				progress := 0
				if total > 0 {
					progress = int((done * 100) / total)
				}
				s.jobs.updateTransfer(jobID, "downloading", progress, fmt.Sprintf("正在下载 (%d/%d)", index+1, len(entries)), entry.relative, done, total, speed)
			}
		}}
		err = terminal.WriteStreamContext(ctx, s.vmMgr.InstanceName(), target, reporter)
		stream.Body.Close()
		if err != nil {
			return fmt.Errorf("保存 %s 失败: %w", entry.relative, err)
		}
	}
	speed := int64(float64(done) / maxDurationSeconds(time.Since(started)))
	s.jobs.updateTransfer(jobID, "completed", 100, fmt.Sprintf("已下载 %d 个文件", len(entries)), "", done, total, speed)
	return nil
}

func collectCloudFiles(ctx context.Context, client *cloud.Client, fid, relative string, entries *[]cloudDownloadEntry, depth int) error {
	if depth > 32 {
		return fmt.Errorf("云端目录层级过深")
	}
	items, err := client.ListAll(ctx, fid)
	if err != nil {
		return fmt.Errorf("读取云端目录失败: %w", err)
	}
	if len(*entries)+len(items) > 10000 {
		return fmt.Errorf("一次最多下载 10000 个云端文件")
	}
	for _, item := range items {
		if err := validateCloudFileName(item.Name); err != nil {
			return err
		}
		childPath := path.Join(relative, item.Name)
		if item.IsDir {
			if err := collectCloudFiles(ctx, client, item.Fid, childPath, entries, depth+1); err != nil {
				return err
			}
		} else {
			*entries = append(*entries, cloudDownloadEntry{fid: item.Fid, relative: childPath, size: item.Size})
		}
	}
	return nil
}

type cloudProgressReader struct {
	reader     io.Reader
	onBytes    func(int64)
	lastUpdate time.Time
}

func (r *cloudProgressReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if n > 0 && r.onBytes != nil {
		r.onBytes(int64(n))
	}
	return n, err
}

func maxDurationSeconds(duration time.Duration) float64 {
	seconds := duration.Seconds()
	if seconds < 0.001 {
		return 0.001
	}
	return seconds
}
