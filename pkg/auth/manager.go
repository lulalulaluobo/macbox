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
	"strings"
	"sync"
	"time"
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
	Token     string    `json:"token"`
	UserID    string    `json:"userId"`
	Username  string    `json:"username"`
	Role      string    `json:"role"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type Manager struct {
	mu          sync.RWMutex
	storagePath string
	users       map[string]*storedUser // keyed by ID
	userByName  map[string]*storedUser // keyed by lower username
	sessions    map[string]*Session    // keyed by token
}

func NewManager(configDir string) (*Manager, error) {
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return nil, err
	}
	path := filepath.Join(configDir, "users.json")
	m := &Manager{
		storagePath: path,
		users:       make(map[string]*storedUser),
		userByName:  make(map[string]*storedUser),
		sessions:    make(map[string]*Session),
	}

	if err := m.load(); err != nil {
		return nil, err
	}

	// If no users exist, initialize default admin/admin123
	if len(m.users) == 0 {
		if err := m.initDefaultAdmin(); err != nil {
			return nil, fmt.Errorf("failed to init default admin: %w", err)
		}
	}

	return m, nil
}

func (m *Manager) initDefaultAdmin() error {
	salt := generateSalt(16)
	hash := hashPassword("admin123", salt)
	now := time.Now()

	admin := &storedUser{
		ID:           "u-admin",
		Username:     "admin",
		DisplayName:  "系统管理员",
		PasswordHash: hash,
		Salt:         salt,
		Role:         "admin",
		CreatedAt:    now,
		UpdatedAt:    now,
		Enabled:      true,
	}

	m.users[admin.ID] = admin
	m.userByName[strings.ToLower(admin.Username)] = admin
	return m.saveLocked()
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
		m.users[u.ID] = u
		m.userByName[strings.ToLower(u.Username)] = u
	}
	return nil
}

func (m *Manager) saveLocked() error {
	var list []*storedUser
	for _, u := range m.users {
		list = append(list, u)
	}
	storage := userStorage{Users: list}
	data, err := json.MarshalIndent(storage, "", "  ")
	if err != nil {
		return err
	}

	tmp := m.storagePath + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, m.storagePath)
}

// Password hashing using SHA256 PBKDF2-like stretching
func generateSalt(length int) string {
	b := make([]byte, length)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func hashPassword(password, salt string) string {
	key := []byte(salt)
	msg := []byte(password)
	for i := 0; i < 10000; i++ {
		h := hmac.New(sha256.New, key)
		h.Write(msg)
		msg = h.Sum(nil)
	}
	return hex.EncodeToString(msg)
}

func verifyPassword(password, salt, expectedHash string) bool {
	computed := hashPassword(password, salt)
	return subtle.ConstantTimeCompare([]byte(computed), []byte(expectedHash)) == 1
}

func (m *Manager) Login(username, password string, rememberMe bool) (string, *User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	u, exists := m.userByName[strings.ToLower(strings.TrimSpace(username))]
	if !exists {
		return "", nil, errors.New("用户名或密码错误")
	}

	if !u.Enabled {
		return "", nil, errors.New("该账户已被禁用，请联系管理员")
	}

	if !verifyPassword(password, u.Salt, u.PasswordHash) {
		return "", nil, errors.New("用户名或密码错误")
	}

	// Update last login time
	now := time.Now()
	u.LastLoginAt = &now
	_ = m.saveLocked()

	// Create session token
	tokenBytes := make([]byte, 32)
	_, _ = rand.Read(tokenBytes)
	token := hex.EncodeToString(tokenBytes)

	duration := 24 * time.Hour * 7
	if rememberMe {
		duration = 24 * time.Hour * 30
	}

	m.sessions[token] = &Session{
		Token:     token,
		UserID:    u.ID,
		Username:  u.Username,
		Role:      u.Role,
		ExpiresAt: now.Add(duration),
	}

	return token, toPublicUser(u), nil
}

func (m *Manager) Logout(token string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, token)
}

func (m *Manager) ValidateToken(token string) (*User, error) {
	if token == "" {
		return nil, errors.New("missing token")
	}

	m.mu.RLock()
	session, exists := m.sessions[token]
	m.mu.RUnlock()

	if !exists {
		return nil, errors.New("invalid or expired session")
	}

	if time.Now().After(session.ExpiresAt) {
		m.mu.Lock()
		delete(m.sessions, token)
		m.mu.Unlock()
		return nil, errors.New("session expired")
	}

	m.mu.RLock()
	u, userExists := m.users[session.UserID]
	m.mu.RUnlock()

	if !userExists || !u.Enabled {
		return nil, errors.New("user disabled or not found")
	}

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
	username := strings.TrimSpace(req.Username)
	if len(username) < 3 {
		return nil, errors.New("用户名长度至少为 3 个字符")
	}
	if strings.ContainsAny(username, " \t\n/\\:;*?\"<>|") {
		return nil, errors.New("用户名包含非法字符")
	}

	if len(req.Password) < 6 {
		return nil, errors.New("密码长度至少为 6 个字符")
	}

	role := strings.ToLower(req.Role)
	if role != "admin" && role != "user" {
		role = "user"
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.userByName[strings.ToLower(username)]; exists {
		return nil, fmt.Errorf("用户名 '%s' 已存在", username)
	}

	salt := generateSalt(16)
	hash := hashPassword(req.Password, salt)
	now := time.Now()

	// Generate clean ID
	idBytes := make([]byte, 6)
	_, _ = rand.Read(idBytes)
	id := fmt.Sprintf("u-%s-%s", strings.ToLower(username), hex.EncodeToString(idBytes))

	displayName := strings.TrimSpace(req.DisplayName)
	if displayName == "" {
		displayName = username
	}

	newUser := &storedUser{
		ID:           id,
		Username:     username,
		DisplayName:  displayName,
		PasswordHash: hash,
		Salt:         salt,
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

	// Check super administrator constraint:
	// If demoting an admin or disabling an admin, ensure at least one other active admin remains!
	if (req.Role != nil && *req.Role != "admin" && u.Role == "admin") ||
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
		u.DisplayName = strings.TrimSpace(*req.DisplayName)
	}

	if req.Role != nil {
		newRole := strings.ToLower(*req.Role)
		if newRole == "admin" || newRole == "user" {
			u.Role = newRole
		}
	}

	if req.Enabled != nil {
		u.Enabled = *req.Enabled
	}

	if req.NewPassword != nil && strings.TrimSpace(*req.NewPassword) != "" {
		pwd := strings.TrimSpace(*req.NewPassword)
		if len(pwd) < 6 {
			return nil, errors.New("新密码长度至少为 6 个字符")
		}
		salt := generateSalt(16)
		u.Salt = salt
		u.PasswordHash = hashPassword(pwd, salt)
	}

	u.UpdatedAt = time.Now()
	if err := m.saveLocked(); err != nil {
		return nil, err
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

	// Remove all active sessions for this user
	for token, sess := range m.sessions {
		if sess.UserID == targetID {
			delete(m.sessions, token)
		}
	}

	delete(m.users, targetID)
	delete(m.userByName, strings.ToLower(u.Username))

	return m.saveLocked()
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

	if len(strings.TrimSpace(newPassword)) < 6 {
		return errors.New("新密码长度至少为 6 个字符")
	}

	salt := generateSalt(16)
	u.Salt = salt
	u.PasswordHash = hashPassword(strings.TrimSpace(newPassword), salt)
	u.UpdatedAt = time.Now()

	return m.saveLocked()
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
