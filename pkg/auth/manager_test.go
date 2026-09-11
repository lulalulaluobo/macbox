package auth

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFreshManagerRequiresExplicitSetup(t *testing.T) {
	mgr, err := NewManager(t.TempDir())
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	if !mgr.NeedsSetup() {
		t.Fatal("fresh manager should require setup")
	}
	if _, _, err := mgr.Login("admin", "admin123", false); err == nil {
		t.Fatal("known default credentials must not work on a fresh manager")
	}

	user, err := mgr.CreateInitialAdmin(CreateUserRequest{
		Username: "admin",
		Password: "a-strong-password-123",
		Role:     "user",
	})
	if err != nil {
		t.Fatalf("CreateInitialAdmin() error = %v", err)
	}
	if user.Role != "admin" || mgr.NeedsSetup() {
		t.Fatalf("initial user = %#v, setupRequired = %v", user, mgr.NeedsSetup())
	}
	if _, err := mgr.CreateInitialAdmin(CreateUserRequest{
		Username: "second",
		Password: "another-strong-password",
	}); err == nil {
		t.Fatal("second initial setup should be rejected")
	}
}

func TestLoginRateLimit(t *testing.T) {
	mgr, err := NewManager(t.TempDir())
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	if _, err := mgr.CreateInitialAdmin(CreateUserRequest{
		Username: "admin",
		Password: "a-strong-password-123",
	}); err != nil {
		t.Fatalf("CreateInitialAdmin() error = %v", err)
	}

	for i := 0; i < 5; i++ {
		if _, _, err := mgr.LoginFrom("admin", "wrong-password", false, "127.0.0.1"); err == nil {
			t.Fatal("wrong password should fail")
		}
	}
	if _, _, err := mgr.LoginFrom("admin", "a-strong-password-123", false, "127.0.0.1"); !errors.Is(err, ErrTooManyLoginAttempts) {
		t.Fatalf("expected rate limit error, got %v", err)
	}
}

func TestLoginRateLimitCoversIPAcrossUsernames(t *testing.T) {
	mgr, err := NewManager(t.TempDir())
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	for i := 0; i < 5; i++ {
		if _, _, err := mgr.LoginFrom("unknown-user-"+string(rune('a'+i)), "wrong-password", false, "192.0.2.10"); err == nil {
			t.Fatal("unknown username should fail")
		}
	}
	if _, _, err := mgr.LoginFrom("another-user", "wrong-password", false, "192.0.2.10"); !errors.Is(err, ErrTooManyLoginAttempts) {
		t.Fatalf("expected IP-wide rate limit, got %v", err)
	}
}

func TestNewManagerRejectsCorruptUserRecord(t *testing.T) {
	dir := t.TempDir()
	data := `{"users":[null]}`
	if err := os.WriteFile(filepath.Join(dir, "users.json"), []byte(data), 0600); err != nil {
		t.Fatalf("write corrupt user data: %v", err)
	}
	if _, err := NewManager(dir); err == nil {
		t.Fatal("NewManager accepted a corrupt user record")
	}
}

func TestNewPasswordsUseBcryptAndPasswordChangeRevokesSessions(t *testing.T) {
	mgr, err := NewManager(t.TempDir())
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	user, err := mgr.CreateInitialAdmin(CreateUserRequest{
		Username: "admin",
		Password: "a-strong-password-123",
	})
	if err != nil {
		t.Fatalf("CreateInitialAdmin() error = %v", err)
	}

	if !strings.HasPrefix(mgr.users[user.ID].PasswordHash, "$2") {
		t.Fatalf("new password hash = %q, want bcrypt hash", mgr.users[user.ID].PasswordHash)
	}
	token, _, err := mgr.Login("admin", "a-strong-password-123", false)
	if err != nil {
		t.Fatalf("Login() error = %v", err)
	}
	if err := mgr.ChangePassword(user.ID, "a-strong-password-123", "a-different-password-456"); err != nil {
		t.Fatalf("ChangePassword() error = %v", err)
	}
	if _, err := mgr.ValidateToken(token); err == nil {
		t.Fatal("password change must revoke the old session")
	}
}

func TestUpdateUserValidationIsAtomic(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir)
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	user, err := mgr.CreateInitialAdmin(CreateUserRequest{
		Username: "admin",
		Password: "a-strong-password-123",
	})
	if err != nil {
		t.Fatalf("CreateInitialAdmin() error = %v", err)
	}
	regular, err := mgr.CreateUser(CreateUserRequest{
		Username:    "operator",
		Password:    "operator-password-123",
		DisplayName: "Operator",
	})
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}

	badPassword := "too-short"
	disabled := false
	if _, err := mgr.UpdateUser(regular.ID, UpdateUserRequest{
		DisplayName: stringPtr("Changed"),
		Enabled:     &disabled,
		NewPassword: &badPassword,
		Role:        stringPtr("admin"),
	}); err == nil {
		t.Fatal("UpdateUser() accepted an invalid password")
	}

	unchanged, err := mgr.GetUser(regular.ID)
	if err != nil {
		t.Fatalf("GetUser() error = %v", err)
	}
	if unchanged.DisplayName != "Operator" || !unchanged.Enabled || unchanged.Role != "user" {
		t.Fatalf("failed update changed in-memory user: %#v", unchanged)
	}

	reloaded, err := NewManager(dir)
	if err != nil {
		t.Fatalf("reload manager: %v", err)
	}
	persisted, err := reloaded.GetUser(regular.ID)
	if err != nil {
		t.Fatalf("GetUser() after reload: %v", err)
	}
	if persisted.DisplayName != "Operator" || !persisted.Enabled || persisted.Role != "user" {
		t.Fatalf("failed update changed persisted user: %#v", persisted)
	}
	if user.Role != "admin" {
		t.Fatalf("initial admin was unexpectedly changed: %#v", user)
	}
}

func stringPtr(value string) *string {
	return &value
}
