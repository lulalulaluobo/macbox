package auth

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	testAdminUsername = "admin"
	testAdminPassword = "correct-horse-battery-staple"
)

func TestFreshManagerRequiresExplicitSetup(t *testing.T) {
	mgr, err := NewManager(t.TempDir())
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	if !mgr.NeedsSetup() {
		t.Fatal("fresh manager should require setup")
	}
	if _, _, err := mgr.Login(testAdminUsername, testAdminPassword, false); err == nil {
		t.Fatal("bootstrap credentials must not work before setup")
	}

	user, err := mgr.CreateInitialAdmin(CreateUserRequest{
		Username: testAdminUsername,
		Password: testAdminPassword,
		Role:     "user",
	})
	if err != nil {
		t.Fatalf("CreateInitialAdmin() error = %v", err)
	}
	if user.Role != "admin" || mgr.NeedsSetup() {
		t.Fatalf("initial user = %#v, setupRequired = %v", user, mgr.NeedsSetup())
	}
	if _, _, err := mgr.Login(testAdminUsername, testAdminPassword, false); err != nil {
		t.Fatalf("bootstrap credentials should login after setup: %v", err)
	}
	if _, err := mgr.CreateInitialAdmin(CreateUserRequest{
		Username: "second",
		Password: "another-strong-password",
	}); err == nil {
		t.Fatal("second initial setup should be rejected")
	}
}

func TestInitialAdminCredentialsAreChosenDuringSetup(t *testing.T) {
	mgr, err := NewManager(t.TempDir())
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	if _, err := mgr.CreateInitialAdmin(CreateUserRequest{Username: "operator", Password: "another-strong-password"}); err != nil {
		t.Fatalf("CreateInitialAdmin should accept a user-chosen strong credential: %v", err)
	}
	if _, _, err := mgr.Login("operator", "another-strong-password", false); err != nil {
		t.Fatalf("chosen initial credential should login: %v", err)
	}

	weakMgr, err := NewManager(t.TempDir())
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	if _, err := weakMgr.CreateInitialAdmin(CreateUserRequest{Username: "operator", Password: "short"}); err == nil {
		t.Fatal("CreateInitialAdmin accepted a weak password")
	}
	if !weakMgr.NeedsSetup() {
		t.Fatal("failed setup changed manager state")
	}
}

func TestIsInitialAdmin(t *testing.T) {
	mgr, err := NewManager(t.TempDir())
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	first, err := mgr.CreateInitialAdmin(CreateUserRequest{
		Username: "first-admin",
		Password: "another-strong-password",
	})
	if err != nil {
		t.Fatalf("CreateInitialAdmin() error = %v", err)
	}
	second, err := mgr.CreateUser(CreateUserRequest{
		Username: "second-admin",
		Password: "different-strong-password",
		Role:     "admin",
	})
	if err != nil {
		t.Fatalf("CreateUser() error = %v", err)
	}
	if !mgr.IsInitialAdmin(first.ID) {
		t.Fatal("first administrator was not recognized as the initial administrator")
	}
	if mgr.IsInitialAdmin(second.ID) {
		t.Fatal("second administrator was incorrectly recognized as the initial administrator")
	}
}

func TestAuthPasswordUsesEightCharacterStrongMinimum(t *testing.T) {
	validMgr, err := NewManager(t.TempDir())
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	if _, err := validMgr.CreateInitialAdmin(CreateUserRequest{Username: "operator", Password: "Abcdefg1"}); err != nil {
		t.Fatalf("eight-character mixed password should be accepted: %v", err)
	}

	for _, password := range []string{"abcdefgh", "12345678", "aaaaaaaa"} {
		mgr, err := NewManager(t.TempDir())
		if err != nil {
			t.Fatalf("NewManager() error = %v", err)
		}
		if _, err := mgr.CreateInitialAdmin(CreateUserRequest{Username: "operator", Password: password}); err == nil {
			t.Fatalf("weak password %q was accepted", password)
		}
	}
}

func TestLoginRateLimit(t *testing.T) {
	mgr, err := NewManager(t.TempDir())
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	if _, err := mgr.CreateInitialAdmin(CreateUserRequest{
		Username: testAdminUsername,
		Password: testAdminPassword,
	}); err != nil {
		t.Fatalf("CreateInitialAdmin() error = %v", err)
	}

	for i := 0; i < 5; i++ {
		if _, _, err := mgr.LoginFrom("admin", "wrong-password", false, "127.0.0.1"); err == nil {
			t.Fatal("wrong password should fail")
		}
	}
	if _, _, err := mgr.LoginFrom(testAdminUsername, testAdminPassword, false, "127.0.0.1"); !errors.Is(err, ErrTooManyLoginAttempts) {
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
		Username: testAdminUsername,
		Password: testAdminPassword,
	})
	if err != nil {
		t.Fatalf("CreateInitialAdmin() error = %v", err)
	}

	if !strings.HasPrefix(mgr.users[user.ID].PasswordHash, "$2") {
		t.Fatalf("new password hash = %q, want bcrypt hash", mgr.users[user.ID].PasswordHash)
	}
	token, _, err := mgr.Login(testAdminUsername, testAdminPassword, false)
	if err != nil {
		t.Fatalf("Login() error = %v", err)
	}
	if err := mgr.ChangePassword(user.ID, testAdminPassword, "a-different-password-456"); err != nil {
		t.Fatalf("ChangePassword() error = %v", err)
	}
	if _, err := mgr.ValidateToken(token); err == nil {
		t.Fatal("password change must revoke the old session")
	}
}

func TestReplaceUsersJSONReplacesUsersAndRevokesSessions(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir)
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	if _, err := mgr.CreateInitialAdmin(CreateUserRequest{
		Username: testAdminUsername,
		Password: testAdminPassword,
	}); err != nil {
		t.Fatalf("CreateInitialAdmin() error = %v", err)
	}
	token, _, err := mgr.Login(testAdminUsername, testAdminPassword, false)
	if err != nil {
		t.Fatalf("Login() error = %v", err)
	}

	data, err := os.ReadFile(filepath.Join(dir, "users.json"))
	if err != nil {
		t.Fatalf("read users.json: %v", err)
	}
	if err := mgr.ReplaceUsersJSON(data); err != nil {
		t.Fatalf("ReplaceUsersJSON() error = %v", err)
	}
	if _, err := mgr.ValidateToken(token); err == nil {
		t.Fatal("replacing users must revoke existing sessions")
	}
	if mgr.NeedsSetup() {
		t.Fatal("replacing users with an administrator should not require setup")
	}
}

func TestUpdateUserValidationIsAtomic(t *testing.T) {
	dir := t.TempDir()
	mgr, err := NewManager(dir)
	if err != nil {
		t.Fatalf("NewManager() error = %v", err)
	}
	user, err := mgr.CreateInitialAdmin(CreateUserRequest{
		Username: testAdminUsername,
		Password: testAdminPassword,
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

	badPassword := "short"
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
