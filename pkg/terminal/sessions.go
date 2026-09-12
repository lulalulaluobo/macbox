package terminal

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

const (
	// Keep enough scrollback for a refresh during an AI or maintenance task,
	// but do not let a noisy process grow the MacNAS backend without bound.
	maxTerminalHistoryBytes = 512 << 10
	terminalSessionIdleTTL  = 24 * time.Hour
	finishedSessionIdleTTL  = 30 * time.Minute
	terminalReaperInterval  = 10 * time.Minute
	maxTerminalSessions     = 32
)

type terminalSessionOptions struct {
	InstanceName string
	LoginUser    string
	Container    string
}

// SessionManager owns PTY processes independently from individual browser
// WebSocket connections. A browser refresh can therefore reconnect to the
// same task instead of terminating the process that is doing the work.
type SessionManager struct {
	ctx    context.Context
	cancel context.CancelFunc

	mu        sync.Mutex
	sessions  map[string]*terminalSession
	closeOnce sync.Once
}

type terminalSession struct {
	id      string
	options terminalSessionOptions
	cmd     *exec.Cmd
	ptmx    *os.File

	writeMu sync.Mutex
	ptyMu   sync.Mutex
	conn    *websocket.Conn
	history []byte

	activityMu   sync.Mutex
	lastActivity time.Time
	finished     bool
	done         chan struct{}
	doneOnce     sync.Once
}

func NewSessionManager() *SessionManager {
	ctx, cancel := context.WithCancel(context.Background())
	m := &SessionManager{
		ctx:      ctx,
		cancel:   cancel,
		sessions: make(map[string]*terminalSession),
	}
	go m.reapLoop()
	return m
}

// Open returns an existing matching session when requestedID is known. A
// stale browser session ID (for example after a backend restart) transparently
// starts a new session so the UI is not stuck retrying a dead connection.
func (m *SessionManager) Open(options terminalSessionOptions, requestedID string) (*terminalSession, bool, error) {
	if m == nil {
		return nil, false, fmt.Errorf("终端会话管理器未初始化")
	}

	now := time.Now()
	m.mu.Lock()
	m.reapLocked(now)
	if requestedID != "" {
		if existing, ok := m.sessions[requestedID]; ok && existing.matches(options) {
			existing.touch()
			m.mu.Unlock()
			return existing, false, nil
		}
	}
	if len(m.sessions) >= maxTerminalSessions {
		m.mu.Unlock()
		return nil, false, fmt.Errorf("终端会话数量已达到上限，请关闭不再使用的终端后重试")
	}
	m.mu.Unlock()

	session, err := m.start(options)
	if err != nil {
		return nil, false, err
	}

	m.mu.Lock()
	// A concurrent refresh can race with this creation. Prefer the first
	// session and stop the duplicate to avoid orphaning a PTY.
	if requestedID != "" {
		if existing, ok := m.sessions[requestedID]; ok && existing.matches(options) {
			m.mu.Unlock()
			session.stop()
			existing.touch()
			return existing, false, nil
		}
	}
	m.sessions[session.id] = session
	m.mu.Unlock()
	return session, true, nil
}

func (m *SessionManager) start(options terminalSessionOptions) (*terminalSession, error) {
	cmd := terminalCommand(m.ctx, options.InstanceName, options.LoginUser, options.Container)
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}

	session := &terminalSession{
		id:           newTerminalSessionID(),
		options:      options,
		cmd:          cmd,
		ptmx:         ptmx,
		lastActivity: time.Now(),
		done:         make(chan struct{}),
	}
	go session.readLoop()
	return session, nil
}

func (m *SessionManager) reapLoop() {
	ticker := time.NewTicker(terminalReaperInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			m.mu.Lock()
			stale := m.reapLocked(time.Now())
			m.mu.Unlock()
			for _, session := range stale {
				session.stop()
			}
		case <-m.ctx.Done():
			return
		}
	}
}

func (m *SessionManager) reapLocked(now time.Time) []*terminalSession {
	stale := make([]*terminalSession, 0)
	for id, session := range m.sessions {
		if now.Sub(session.activity()) <= session.expiry() {
			continue
		}
		delete(m.sessions, id)
		stale = append(stale, session)
	}
	return stale
}

func (m *SessionManager) Close() {
	if m == nil {
		return
	}
	m.closeOnce.Do(func() {
		m.cancel()
		m.mu.Lock()
		sessions := make([]*terminalSession, 0, len(m.sessions))
		for id, session := range m.sessions {
			delete(m.sessions, id)
			sessions = append(sessions, session)
		}
		m.mu.Unlock()
		for _, session := range sessions {
			session.stop()
		}
	})
}

func (s *terminalSession) matches(options terminalSessionOptions) bool {
	return s.options == options
}

func (s *terminalSession) expiry() time.Duration {
	s.activityMu.Lock()
	finished := s.finished
	s.activityMu.Unlock()
	if finished {
		return finishedSessionIdleTTL
	}
	return terminalSessionIdleTTL
}

func (s *terminalSession) activity() time.Time {
	s.activityMu.Lock()
	defer s.activityMu.Unlock()
	return s.lastActivity
}

func (s *terminalSession) touch() {
	s.activityMu.Lock()
	s.lastActivity = time.Now()
	s.activityMu.Unlock()
}

func (s *terminalSession) attach(conn *websocket.Conn) {
	s.writeMu.Lock()
	if s.conn != nil && s.conn != conn {
		_ = s.conn.Close()
	}
	s.conn = conn
	if len(s.history) > 0 {
		if err := conn.WriteMessage(websocket.BinaryMessage, s.history); err != nil {
			_ = conn.Close()
			s.conn = nil
		}
	}
	s.writeMu.Unlock()
	s.touch()
}

func (s *terminalSession) detach(conn *websocket.Conn) {
	s.writeMu.Lock()
	if s.conn == conn {
		s.conn = nil
	}
	s.writeMu.Unlock()
	s.touch()
}

func (s *terminalSession) writeInput(data []byte) error {
	s.ptyMu.Lock()
	defer s.ptyMu.Unlock()
	if s.ptmx == nil {
		return io.ErrClosedPipe
	}
	s.touch()
	_, err := s.ptmx.Write(data)
	return err
}

func (s *terminalSession) resize(rows, cols uint16) error {
	if rows == 0 || cols == 0 {
		return nil
	}
	s.ptyMu.Lock()
	defer s.ptyMu.Unlock()
	if s.ptmx == nil {
		return io.ErrClosedPipe
	}
	s.touch()
	return pty.Setsize(s.ptmx, &pty.Winsize{Rows: rows, Cols: cols})
}

func (s *terminalSession) readLoop() {
	buf := make([]byte, 4096)
	for {
		n, err := s.ptmx.Read(buf)
		if n > 0 {
			s.appendOutput(buf[:n])
		}
		if err != nil {
			break
		}
	}

	s.ptyMu.Lock()
	_ = s.ptmx.Close()
	s.ptyMu.Unlock()
	if s.cmd.Process != nil {
		_ = s.cmd.Wait()
	}

	s.activityMu.Lock()
	s.finished = true
	s.activityMu.Unlock()
	s.appendOutput([]byte("\r\n\x1b[33m[MacNAS] 终端任务已结束，刷新后仍可查看本次输出。\x1b[0m\r\n"))
	s.doneOnce.Do(func() { close(s.done) })

	s.writeMu.Lock()
	if s.conn != nil {
		_ = s.conn.Close()
		s.conn = nil
	}
	s.writeMu.Unlock()
}

func (s *terminalSession) appendOutput(data []byte) {
	if len(data) == 0 {
		return
	}
	s.writeMu.Lock()
	if len(data) >= maxTerminalHistoryBytes {
		s.history = append([]byte(nil), data[len(data)-maxTerminalHistoryBytes:]...)
	} else {
		s.history = append(s.history, data...)
		if len(s.history) > maxTerminalHistoryBytes {
			s.history = append([]byte(nil), s.history[len(s.history)-maxTerminalHistoryBytes:]...)
		}
	}
	if s.conn != nil {
		if err := s.conn.WriteMessage(websocket.BinaryMessage, data); err != nil {
			_ = s.conn.Close()
			s.conn = nil
		}
	}
	s.writeMu.Unlock()
	s.touch()
}

func (s *terminalSession) stop() {
	s.doneOnce.Do(func() { close(s.done) })
	s.ptyMu.Lock()
	if s.ptmx != nil {
		_ = s.ptmx.Close()
	}
	if s.cmd != nil && s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	s.ptyMu.Unlock()
	s.writeMu.Lock()
	if s.conn != nil {
		_ = s.conn.Close()
		s.conn = nil
	}
	s.writeMu.Unlock()
}

func newTerminalSessionID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		log.Printf("[MacNAS Terminal] session id generation failed: %v", err)
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(raw[:])
}
