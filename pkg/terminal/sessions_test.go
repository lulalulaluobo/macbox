package terminal

import (
	"testing"
	"time"
)

func TestReapExpiredStopsAndRemovesSession(t *testing.T) {
	m := NewSessionManager()
	defer m.Close()

	session := &terminalSession{
		id:           "expired",
		lastActivity: time.Now().Add(-terminalSessionIdleTTL - time.Minute),
		done:         make(chan struct{}),
	}
	m.mu.Lock()
	m.sessions[session.id] = session
	m.mu.Unlock()

	m.reapExpired(time.Now())

	m.mu.Lock()
	_, exists := m.sessions[session.id]
	m.mu.Unlock()
	if exists {
		t.Fatal("expired session remained registered")
	}
	select {
	case <-session.done:
	default:
		t.Fatal("expired session was removed without being stopped")
	}
}
