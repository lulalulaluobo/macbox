package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/lulalulaluobo/macbox/pkg/auth"
	"github.com/lulalulaluobo/macbox/pkg/config"
)

func (s *Server) syncInitialAdminSMBCredentials(ctx context.Context, user *auth.User, password string) error {
	if user == nil || user.Role != "admin" || s.authMgr == nil || s.sambaMgr == nil ||
		!s.authMgr.IsInitialAdmin(user.ID) {
		return nil
	}
	syncCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := s.sambaMgr.SyncCredentials(syncCtx, user.Username, password); err != nil {
		log.Printf("[MacBox Samba] 首位超级管理员凭据同步失败: %v", err)
		return err
	}
	return nil
}

func smbCredentialSyncWarning(err error) string {
	if err == nil {
		return ""
	}
	return "SMB 凭据同步失败；Web 账号操作已完成，请确认 VM 正在运行后重新登录再试"
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, token string, rememberMe bool) {
	maxAge := int((24 * time.Hour) / time.Second)
	if rememberMe {
		maxAge = int((30 * 24 * time.Hour) / time.Second)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		Expires:  time.Now().Add(time.Duration(maxAge) * time.Second),
		HttpOnly: true,
		Secure:   s.requestIsHTTPS(r),
		SameSite: http.SameSiteStrictMode,
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		Secure:   s.requestIsHTTPS(r),
		SameSite: http.SameSiteStrictMode,
	})
}

func (s *Server) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	if s.authMgr == nil {
		writeError(w, http.StatusServiceUnavailable, "认证服务暂不可用")
		return
	}
	var req struct {
		Username   string `json:"username"`
		Password   string `json:"password"`
		RememberMe bool   `json:"rememberMe"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求参数解析错误")
		return
	}

	token, user, err := s.authMgr.LoginFrom(req.Username, req.Password, req.RememberMe, s.requestIP(r))
	if err != nil {
		if errors.Is(err, auth.ErrTooManyLoginAttempts) {
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, err.Error())
			return
		}
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	smbWarning := smbCredentialSyncWarning(s.syncInitialAdminSMBCredentials(r.Context(), user, req.Password))
	s.setSessionCookie(w, r, token, req.RememberMe)
	response := map[string]interface{}{
		"user": user,
	}
	if smbWarning != "" {
		response["warning"] = smbWarning
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	if s.authMgr == nil {
		writeError(w, http.StatusServiceUnavailable, "认证服务暂不可用")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"setupRequired": s.authMgr.NeedsSetup()})
}

func (s *Server) handleAuthSetup(w http.ResponseWriter, r *http.Request) {
	if !s.isLoopbackRequest(r) {
		writeError(w, http.StatusForbidden, "首次管理员初始化仅允许在 MacBox 主机本机执行")
		return
	}
	if s.authMgr == nil {
		writeError(w, http.StatusServiceUnavailable, "认证服务暂不可用")
		return
	}
	var req auth.CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求数据格式错误")
		return
	}
	if err := config.ValidateSambaUsername(strings.TrimSpace(req.Username)); err != nil {
		writeError(w, http.StatusBadRequest, "管理员用户名也必须可用于 SMB 登录: "+err.Error())
		return
	}
	req.Role = "admin"
	user, err := s.authMgr.CreateInitialAdmin(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	smbWarning := smbCredentialSyncWarning(s.syncInitialAdminSMBCredentials(r.Context(), user, req.Password))
	response := map[string]interface{}{
		"status": "ok",
		"user":   user,
	}
	if smbWarning != "" {
		response["warning"] = smbWarning
	}
	writeJSON(w, http.StatusCreated, response)
}

func (s *Server) handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token == "" {
		if sessionCookie, err := r.Cookie(sessionCookieName); err == nil {
			token = sessionCookie.Value
		}
	}
	if token != "" && s.authMgr != nil {
		s.authMgr.Logout(token)
	}
	s.clearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleAuthMe(w http.ResponseWriter, r *http.Request) {
	user := getCurrentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "未登录")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"user": user,
	})
}

func (s *Server) handleAuthChangePassword(w http.ResponseWriter, r *http.Request) {
	user := getCurrentUser(r)
	if user == nil {
		writeError(w, http.StatusUnauthorized, "请先登录")
		return
	}

	var req struct {
		OldPassword string `json:"oldPassword"`
		NewPassword string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求数据格式错误")
		return
	}

	if err := s.authMgr.ChangePassword(user.ID, req.OldPassword, req.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	smbWarning := smbCredentialSyncWarning(s.syncInitialAdminSMBCredentials(r.Context(), user, req.NewPassword))
	response := map[string]interface{}{
		"status":    "ok",
		"message":   "密码修改成功",
		"smbSynced": smbWarning == "",
	}
	if smbWarning != "" {
		response["message"] = "管理员密码已修改，但 SMB 凭据同步失败"
		response["warning"] = smbWarning
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleAuthListUsers(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}

	users := s.authMgr.ListUsers()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"users": users,
	})
}

func (s *Server) handleAuthCreateUser(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}

	var req auth.CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求数据格式错误")
		return
	}

	newUser, err := s.authMgr.CreateUser(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "ok",
		"user":   newUser,
	})
}

func (s *Server) handleAuthUpdateUser(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}

	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "用户 ID 不能为空")
		return
	}
	isInitialAdmin := s.authMgr.IsInitialAdmin(id)

	var req auth.UpdateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "请求数据格式错误")
		return
	}

	updatedUser, err := s.authMgr.UpdateUser(id, req)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if isInitialAdmin && req.NewPassword != nil && *req.NewPassword != "" {
		if err := s.syncInitialAdminSMBCredentials(r.Context(), updatedUser, *req.NewPassword); err != nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"status":    "ok",
				"user":      updatedUser,
				"smbSynced": false,
				"warning":   smbCredentialSyncWarning(err),
			})
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "ok",
		"user":   updatedUser,
	})
}

func (s *Server) handleAuthDeleteUser(w http.ResponseWriter, r *http.Request) {
	currentUser := s.requireAdmin(w, r)
	if currentUser == nil {
		return
	}

	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "用户 ID 不能为空")
		return
	}

	if err := s.authMgr.DeleteUser(id, currentUser.ID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"message": "用户已成功删除",
	})
}
