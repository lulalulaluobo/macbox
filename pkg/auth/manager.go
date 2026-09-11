package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

// User represents a Web Console user
type User struct {
	ID          string     `json:"id"`
	Username    string     `json:"username"`
	DisplayName string     `json:"displayName"`
	Role        string     `json:"role"` // "admin" (超级管理员) or "user" (普通用户)
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	LastLoginAt *time.Time `json:"lastLoginAt,omitempty"`
	Enabled     bool       `json:"enabled"`
}

// UserStorage is serialized to users.json
type userStorage struct {
	Users []*storedUser `json:"users"`
}

type storedUser struct {
	ID           string     `json:"id"`
	Username     string     `json:"username"`
	DisplayName  string     `json:"displayName"`
	PasswordHash string     `json:"passwordHash"`
	Salt         string     `json:"salt"`
	Role         string     `json:"role"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	LastLoginAt  *time.Time `json:"lastLoginAt,omitempty"`
	Enabled      bool       `json:"enabled"`
}

type Session struct {
	Token      string    `json:"token"`
	UserID     string    `json:"userId"`
	Username   string    `json:"username"`
	Role       string    `json:"role"`
	CreatedAt  time.Time `json:"createdAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

const (
	defaultSessionTTL  = 24 * time.Hour
	rememberSessionTTL = 30 * 24 * time.Hour
	sessionIdleTTL     = 24 * time.Hour
)

type loginAttempt struct {
	failures    int
	firstFailed time.Time
	lastFailed  time.Time
	lockedUntil time.Time
}

var ErrTooManyLoginAttempts = errors.New("登录尝试过多，请稍后再试")

const (
	minPasswordBytes    = 12
	maxPasswordBytes    = 72 // bcrypt's maximum input size
	maxUsernameBytes    = 128
	maxDisplayNameBytes = 256
)

// InitialAdminUsername and InitialAdminPassword are the deliberately fixed
// bootstrap credentials for a fresh local installation. The setup endpoint is
// loopback-only and can be used only while no console account exists.
const (
	InitialAdminUsername = "admin"
	InitialAdminPassword = "admin123"
)

func validateAuthUsername(username string) error {
	if len([]byte(username)) < 3 || len([]byte(username)) > maxUsernameBytes {
		return errors.New("用户名长度必须在 3 到 128 个字节之间")
	}
	for _, r := range username {
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return errors.New("用户名不能包含空白或控制字符")
		}
	}
	if strings.ContainsAny(username, "/\\:;*?\"<>|") {
		return errors.New("用户名包含非法字符")
	}
	return nil
}

func validateDisplayName(displayName string) error {
	if len([]byte(displayName)) > maxDisplayNameBytes {
		return errors.New("显示名称不能超过 256 个字节")
	}
	for _, r := range displayName {
		if unicode.IsControl(r) {
			return errors.New("显示名称不能包含控制字符")
		}
	}
	return nil
}

func validateAuthPassword(password string) error {
	if len([]byte(password)) < minPasswordBytes {
		return fmt.Errorf("密码长度至少为 %d 个字节", minPasswordBytes)
	}
	if len([]byte(password)) > maxPasswordBytes {
		return fmt.Errorf("密码长度不能超过 %d 个字节", maxPasswordBytes)
	}
	if strings.IndexFunc(password, unicode.IsControl) >= 0 {
		return errors.New("密码不能包含控制字符")
	}
	return nil
}

type Manager struct {
	mu          sync.RWMutex
	storagePath string
	users       map[string]*storedUser  // keyed by ID
	userByName  map[string]*storedUser  // keyed by lower username
	sessions    map[string]*Session     // keyed by token
	loginLimits map[string]loginAttempt // keyed by client address + username
}

func NewManager(configDir string) (*Manager, error) {
	if strings.TrimSpace(configDir) == "" {
		return nil, errors.New("认证配置目录不能为空")
	}
	if err := os.MkdirAll(configDir, 0700); err != nil {
		return nil, err
	}
	if err := os.Chmod(configDir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(configDir, "users.json")
	m := &Manager{
		storagePath: path,
		users:       make(map[string]*storedUser),
		userByName:  make(map[string]*storedUser),
		sessions:    make(map[string]*Session),
		loginLimits: make(map[string]loginAttempt),
	}

	if err := m.load(); err != nil {
		return nil, err
	}
	if _, err := os.Stat(m.storagePath); err == nil {
		if err := os.Chmod(m.storagePath, 0600); err != nil {
			return nil, err
		}
	}

	return m, nil
}

// NeedsSetup reports whether the fixed first administrator still needs to be
// initialized.
func (m *Manager) NeedsSetup() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.users) == 0
}

func (m *Manager) load() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	data, err := os.ReadFile(m.storagePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var storage userStorage
	if err := json.Unmarshal(data, &storage); err != nil {
		return err
	}

	for _, u := range storage.Users {
		if err := validateStoredUser(u); err != nil {
			return err
		}
		if _, exists := m.users[u.ID]; exists {
			return fmt.Errorf("认证数据包含重复用户 ID")
		}
		if _, exists := m.userByName[strings.ToLower(u.Username)]; exists {
			return fmt.Errorf("认证数据包含重复用户名")
		}
		m.users[u.ID] = u
		m.userByName[strings.ToLower(u.Username)] = u
	}
	return nil
}

func validateStoredUser(u *storedUser) error {
	if u == nil || len([]byte(u.ID)) < 1 || len([]byte(u.ID)) > 256 || strings.TrimSpace(u.ID) == "" ||
		strings.IndexFunc(u.ID, unicode.IsControl) >= 0 || strings.ContainsAny(u.ID, "/\\") {
		return errors.New("认证数据包含无效用户")
	}
	if err := validateAuthUsername(u.Username); err != nil {
		return errors.New("认证数据包含无效用户名")
	}
	if err := validateDisplayName(u.DisplayName); err != nil {
		return errors.New("认证数据包含无效显示名称")
	}
	if u.Role != "admin" && u.Role != "user" {
		return errors.New("认证数据包含无效用户角色")
	}
	if strings.TrimSpace(u.PasswordHash) == "" {
		return errors.New("认证数据缺少密码哈希")
	}
	if isBcryptHash(u.PasswordHash) {
		if _, err := bcrypt.Cost([]byte(u.PasswordHash)); err != nil {
			return errors.New("认证数据包含无效密码哈希")
		}
	} else {
		decoded, err := hex.DecodeString(u.PasswordHash)
		if err != nil || len(decoded) != sha256.Size {
			return errors.New("认证数据包含无效密码哈希")
		}
	}
	return nil
}

func (m *Manager) saveLocked() error {
	var list []*storedUser
	for _, u := range m.users {
		list = append(list, u)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	storage := userStorage{Users: list}
	data, err := json.MarshalIndent(storage, "", "  ")
	if err != nil {
		return err
	}

	tmpFile, err := os.CreateTemp(filepath.Dir(m.storagePath), ".users.json-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if err := tmpFile.Chmod(0600); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, m.storagePath); err != nil {
		return err
	}
	return os.Chmod(m.storagePath, 0600)
}

// legacyHashPassword verifies hashes written by versions before bcrypt was
// introduced. New and changed passwords always use bcrypt below.
func legacyHashPassword(password, salt string) string {
	key := []byte(salt)
	msg := []byte(password)
	for i := 0; i < 10000; i++ {
		h := hmac.New(sha256.New, key)
		h.Write(msg)
		msg = h.Sum(nil)
	}
	return hex.EncodeToString(msg)
}

func hashPassword(password string) (string, error) {
	if len([]byte(password)) > maxPasswordBytes {
		return "", fmt.Errorf("密码长度不能超过 %d 个字节", maxPasswordBytes)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("生成密码哈希失败: %w", err)
	}
	return string(hash), nil
}

func isBcryptHash(hash string) bool {
	return strings.HasPrefix(hash, "$2a$") || strings.HasPrefix(hash, "$2b$") || strings.HasPrefix(hash, "$2y$")
}

func verifyPassword(password, salt, expectedHash string) bool {
	if isBcryptHash(expectedHash) {
		return bcrypt.CompareHashAndPassword([]byte(expectedHash), []byte(password)) == nil
	}
	computed := legacyHashPassword(password, salt)
	return subtle.ConstantTimeCompare([]byte(computed), []byte(expectedHash)) == 1
}

func (m *Manager) Login(username, password string, rememberMe bool) (string, *User, error) {
	return m.LoginFrom(username, password, rememberMe, "")
}

// LoginFrom authenticates a user and applies a small per-client/per-account
// failure backoff. clientKey should be the remote IP supplied by the HTTP
// layer; keeping it here makes the protection apply to every login caller.
func (m *Manager) LoginFrom(username, password string, rememberMe bool, clientKey string) (string, *User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	username = strings.TrimSpace(username)
	if len(username) < 3 || len(username) > 128 || len([]byte(password)) > 1024 {
		return "", nil, errors.New("用户名或密码错误")
	}
	accountKey := "account\x00" + strings.ToLower(username)
	ipKey := ""
	if clientKey = strings.TrimSpace(clientKey); clientKey != "" {
		if len(clientKey) > 128 {
			clientKey = clientKey[:128]
		}
		ipKey = "ip\x00" + clientKey
	}
	now := time.Now()
	m.pruneLoginLimitsLocked(now)
	if m.isLoginLocked(accountKey, now) || (ipKey != "" && m.isLoginLocked(ipKey, now)) {
		return "", nil, ErrTooManyLoginAttempts
	}

	u, exists := m.userByName[strings.ToLower(username)]
	if !exists {
		m.recordLoginFailureLocked(accountKey, now)
		if ipKey != "" {
			m.recordLoginFailureLocked(ipKey, now)
		}
		return "", nil, errors.New("用户名或密码错误")
	}

	if !u.Enabled {
		m.recordLoginFailureLocked(accountKey, now)
		if ipKey != "" {
			m.recordLoginFailureLocked(ipKey, now)
		}
		return "", nil, errors.New("用户名或密码错误")
	}

	if !verifyPassword(password, u.Salt, u.PasswordHash) {
		m.recordLoginFailureLocked(accountKey, now)
		if ipKey != "" {
			m.recordLoginFailureLocked(ipKey, now)
		}
		return "", nil, errors.New("用户名或密码错误")
	}
	if !isBcryptHash(u.PasswordHash) {
		// Upgrade legacy hashes after a successful login. Failure to generate a
		// new hash does not turn a valid login into an outage; the next login or
		// password change can retry the migration.
		if upgraded, hashErr := hashPassword(password); hashErr == nil {
			u.PasswordHash = upgraded
			u.Salt = ""
		}
	}
	delete(m.loginLimits, accountKey)
	if ipKey != "" {
		delete(m.loginLimits, ipKey)
	}

	// Update last login time
	u.LastLoginAt = &now
	if err := m.saveLocked(); err != nil {
		return "", nil, fmt.Errorf("保存登录状态失败: %w", err)
	}

	// Create session token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", nil, errors.New("无法创建安全会话")
	}
	token := hex.EncodeToString(tokenBytes)
	m.pruneSessionsLocked(now)

	duration := defaultSessionTTL
	if rememberMe {
		duration = rememberSessionTTL
	}

	m.sessions[token] = &Session{
		Token:      token,
		UserID:     u.ID,
		Username:   u.Username,
		Role:       u.Role,
		CreatedAt:  now,
		LastSeenAt: now,
		ExpiresAt:  now.Add(duration),
	}

	return token, toPublicUser(u), nil
}

func (m *Manager) isLoginLocked(key string, now time.Time) bool {
	attempt, ok := m.loginLimits[key]
	return ok && now.Before(attempt.lockedUntil)
}

func (m *Manager) recordLoginFailureLocked(key string, now time.Time) {
	attempt := m.loginLimits[key]
	if attempt.firstFailed.IsZero() || now.Sub(attempt.firstFailed) > 15*time.Minute {
		attempt = loginAttempt{firstFailed: now}
	}
	attempt.failures++
	attempt.lastFailed = now
	if attempt.failures >= 5 {
		backoff := time.Duration(1<<min(attempt.failures-5, 5)) * time.Minute
		attempt.lockedUntil = now.Add(backoff)
	}
	m.loginLimits[key] = attempt
}

func (m *Manager) pruneLoginLimitsLocked(now time.Time) {
	for key, attempt := range m.loginLimits {
		if now.Sub(attempt.lastFailed) > 15*time.Minute && now.After(attempt.lockedUntil) {
			delete(m.loginLimits, key)
		}
	}
	// Avoid allowing unauthenticated traffic to grow this map without bound.
	if len(m.loginLimits) <= 10000 {
		return
	}
	for key := range m.loginLimits {
		delete(m.loginLimits, key)
		if len(m.loginLimits) <= 9000 {
			break
		}
	}
}

func (m *Manager) Logout(token string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, token)
}

func (m *Manager) revokeSessionsLocked(userID string) {
	for token, session := range m.sessions {
		if session.UserID == userID {
			delete(m.sessions, token)
		}
	}
}

func (m *Manager) pruneSessionsLocked(now time.Time) {
	for token, session := range m.sessions {
		if now.After(session.ExpiresAt) || now.Sub(session.LastSeenAt) > sessionIdleTTL {
			delete(m.sessions, token)
		}
	}
	// A session is memory-only, but an attacker should not be able to grow the
	// map indefinitely by repeatedly authenticating with valid credentials.
	for len(m.sessions) > 10000 {
		for token := range m.sessions {
			delete(m.sessions, token)
			break
		}
	}
}

func (m *Manager) ValidateToken(token string) (*User, error) {
	if token == "" {
		return nil, errors.New("missing token")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	session, exists := m.sessions[token]

	if !exists {
		return nil, errors.New("invalid or expired session")
	}

	now := time.Now()
	if now.After(session.ExpiresAt) || now.Sub(session.LastSeenAt) > sessionIdleTTL {
		delete(m.sessions, token)
		return nil, errors.New("session expired")
	}

	u, userExists := m.users[session.UserID]

	if !userExists || !u.Enabled {
		delete(m.sessions, token)
		return nil, errors.New("user disabled or not found")
	}
	session.LastSeenAt = now
	session.Role = u.Role

	return toPublicUser(u), nil
}

func (m *Manager) ListUsers() []*User {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var list []*User
	for _, u := range m.users {
		list = append(list, toPublicUser(u))
	}
	return list
}

func (m *Manager) GetUser(id string) (*User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	u, ok := m.users[id]
	if !ok {
		return nil, errors.New("user not found")
	}
	return toPublicUser(u), nil
}

type CreateUserRequest struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
	Role        string `json:"role"` // "admin" or "user"
}

func (m *Manager) CreateUser(req CreateUserRequest) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.createUserLocked(req, false)
}

// CreateInitialAdmin atomically creates the first administrator. It is kept
// separate from normal user creation so a second setup request cannot race the
// empty-state check.
func (m *Manager) CreateInitialAdmin(req CreateUserRequest) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.users) != 0 {
		return nil, errors.New("管理员初始化已完成")
	}
	if req.Username != InitialAdminUsername || req.Password != InitialAdminPassword {
		return nil, fmt.Errorf("首次初始化仅允许使用固定管理员账号 %s / %s", InitialAdminUsername, InitialAdminPassword)
	}
	req.Role = "admin"
	return m.createUserLocked(req, true)
}

func (m *Manager) createUserLocked(req CreateUserRequest, allowBootstrapPassword bool) (*User, error) {
	username := strings.TrimSpace(req.Username)
	if err := validateAuthUsername(username); err != nil {
		return nil, err
	}

	isBootstrapCredential := allowBootstrapPassword && username == InitialAdminUsername && req.Password == InitialAdminPassword
	if !isBootstrapCredential {
		if err := validateAuthPassword(req.Password); err != nil {
			return nil, err
		}
	}

	role := strings.ToLower(strings.TrimSpace(req.Role))
	if role == "" {
		role = "user"
	} else if role != "admin" && role != "user" {
		return nil, errors.New("用户角色无效")
	}

	if _, exists := m.userByName[strings.ToLower(username)]; exists {
		return nil, fmt.Errorf("用户名 '%s' 已存在", username)
	}

	hash, err := hashPassword(req.Password)
	if err != nil {
		return nil, err
	}
	now := time.Now()

	// Generate clean ID
	idBytes := make([]byte, 6)
	if _, err := rand.Read(idBytes); err != nil {
		return nil, fmt.Errorf("generate user id: %w", err)
	}
	id := fmt.Sprintf("u-%s-%s", strings.ToLower(username), hex.EncodeToString(idBytes))

	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = username
	}
	if err := validateDisplayName(displayName); err != nil {
		return nil, err
	}

	newUser := &storedUser{
		ID:           id,
		Username:     username,
		DisplayName:  displayName,
		PasswordHash: hash,
		Role:         role,
		CreatedAt:    now,
		UpdatedAt:    now,
		Enabled:      true,
	}

	m.users[newUser.ID] = newUser
	m.userByName[strings.ToLower(username)] = newUser

	if err := m.saveLocked(); err != nil {
		delete(m.users, newUser.ID)
		delete(m.userByName, strings.ToLower(username))
		return nil, err
	}

	return toPublicUser(newUser), nil
}

type UpdateUserRequest struct {
	DisplayName *string `json:"displayName,omitempty"`
	Role        *string `json:"role,omitempty"`
	Enabled     *bool   `json:"enabled,omitempty"`
	NewPassword *string `json:"newPassword,omitempty"`
}

func (m *Manager) UpdateUser(id string, req UpdateUserRequest) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	u, exists := m.users[id]
	if !exists {
		return nil, errors.New("用户不存在")
	}
	original := *u
	candidate := original
	securityChanged := false
	requestedRole := ""
	if req.Role != nil {
		requestedRole = strings.ToLower(strings.TrimSpace(*req.Role))
		if requestedRole != "admin" && requestedRole != "user" {
			return nil, errors.New("用户角色无效")
		}
	}

	// Check super administrator constraint:
	// If demoting an admin or disabling an admin, ensure at least one other active admin remains!
	if (req.Role != nil && requestedRole != "admin" && u.Role == "admin") ||
		(req.Enabled != nil && !*req.Enabled && u.Role == "admin") {
		activeAdmins := 0
		for _, other := range m.users {
			if other.ID != u.ID && other.Role == "admin" && other.Enabled {
				activeAdmins++
			}
		}
		if activeAdmins == 0 {
			return nil, errors.New("系统必须至少保留一位启用的超级管理员，无法降级或禁用最后一个超级管理员")
		}
	}

	if req.DisplayName != nil {
		displayName := strings.TrimSpace(*req.DisplayName)
		if err := validateDisplayName(displayName); err != nil {
			return nil, err
		}
		if displayName == "" {
			displayName = u.Username
		}
		candidate.DisplayName = displayName
	}

	if req.Role != nil {
		securityChanged = securityChanged || candidate.Role != requestedRole
		candidate.Role = requestedRole
	}

	if req.Enabled != nil {
		securityChanged = securityChanged || candidate.Enabled != *req.Enabled
		candidate.Enabled = *req.Enabled
	}

	if req.NewPassword != nil && *req.NewPassword != "" {
		pwd := *req.NewPassword
		if err := validateAuthPassword(pwd); err != nil {
			return nil, fmt.Errorf("新密码无效: %w", err)
		}
		hash, err := hashPassword(pwd)
		if err != nil {
			return nil, err
		}
		candidate.Salt = ""
		candidate.PasswordHash = hash
		securityChanged = true
	}

	candidate.UpdatedAt = time.Now()
	*u = candidate
	if err := m.saveLocked(); err != nil {
		*u = original
		return nil, err
	}
	if securityChanged {
		m.revokeSessionsLocked(id)
	}

	return toPublicUser(u), nil
}

func (m *Manager) DeleteUser(targetID, currentUserID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	u, exists := m.users[targetID]
	if !exists {
		return errors.New("用户不存在")
	}

	// 1. Cannot delete self
	if targetID == currentUserID {
		return errors.New("不能删除当前正在登录的账户。若要删除此管理员，请使用另一个超级管理员登录后再操作")
	}

	// 2. Cannot delete last admin
	if u.Role == "admin" {
		adminCount := 0
		for _, other := range m.users {
			if other.ID != targetID && other.Role == "admin" && other.Enabled {
				adminCount++
			}
		}
		if adminCount == 0 {
			return errors.New("系统必须至少保留一位超级管理员，请先新建或授权其他超级管理员后再删除")
		}
	}

	// Remove all active sessions for this user, but retain a rollback copy until
	// the user record has been durably saved.
	userSessions := make(map[string]*Session)
	for token, session := range m.sessions {
		if session.UserID == targetID {
			userSessions[token] = session
			delete(m.sessions, token)
		}
	}

	delete(m.users, targetID)
	delete(m.userByName, strings.ToLower(u.Username))

	if err := m.saveLocked(); err != nil {
		m.users[targetID] = u
		m.userByName[strings.ToLower(u.Username)] = u
		for token, session := range userSessions {
			m.sessions[token] = session
		}
		return err
	}
	return nil
}

func (m *Manager) ChangePassword(userID, oldPassword, newPassword string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	u, exists := m.users[userID]
	if !exists {
		return errors.New("用户不存在")
	}

	if !verifyPassword(oldPassword, u.Salt, u.PasswordHash) {
		return errors.New("原密码错误")
	}

	if err := validateAuthPassword(newPassword); err != nil {
		return fmt.Errorf("新密码无效: %w", err)
	}

	hash, err := hashPassword(newPassword)
	if err != nil {
		return err
	}
	original := *u
	u.Salt = ""
	u.PasswordHash = hash
	u.UpdatedAt = time.Now()

	if err := m.saveLocked(); err != nil {
		*u = original
		return err
	}
	m.revokeSessionsLocked(userID)
	return nil
}

func toPublicUser(u *storedUser) *User {
	return &User{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		Role:        u.Role,
		CreatedAt:   u.CreatedAt,
		UpdatedAt:   u.UpdatedAt,
		LastLoginAt: u.LastLoginAt,
		Enabled:     u.Enabled,
	}
}
