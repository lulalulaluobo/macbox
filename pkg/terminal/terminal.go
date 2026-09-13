package terminal

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/lulalulaluobo/macbox/pkg/config"
)

var validContainerRef = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)

const maxTerminalMessageBytes = 256 << 10

type resizeMessage struct {
	Type string `json:"type"`
	Rows uint16 `json:"rows"`
	Cols uint16 `json:"cols"`
}

// managementCommand starts a fresh process for the MacBox VM management
// account so repaired supplementary groups are visible immediately. Keep
// sudo -i out of this path because its login-shell handling rewrites
// multiline -c scripts passed to Python.
func managementCommand(ctx context.Context, instanceName string, command ...string) *exec.Cmd {
	managementUser := "macboxctl"
	args := append([]string{"shell", instanceName, "sudo", "-u", managementUser, "--"}, command...)
	return exec.CommandContext(ctx, "limactl", args...)
}

// privilegedCommand runs a data-plane command as VM root. File operations are
// deliberately path-anchored in their scripts, but existing MacBox data can be
// root-owned (for example files imported by Docker or older releases), so
// read/archive streams must not fail solely because macboxctl cannot read it.
func privilegedCommand(ctx context.Context, instanceName string, command ...string) *exec.Cmd {
	args := append([]string{"shell", instanceName, "sudo"}, command...)
	return exec.CommandContext(ctx, "limactl", args...)
}

func terminalCommand(ctx context.Context, instanceName, loginUser, container string) *exec.Cmd {
	var cmd *exec.Cmd
	if container != "" {
		dockerArgs := []string{"docker", "exec"}
		if loginUser == "root" {
			dockerArgs = append(dockerArgs, "-u", "0")
		}
		dockerArgs = append(dockerArgs, "-it", container, "sh")
		cmd = managementCommand(ctx, instanceName, dockerArgs...)
	} else if loginUser == "root" {
		cmd = exec.CommandContext(ctx, "limactl", "shell", instanceName, "sudo", "-i")
	} else {
		cmd = managementCommand(ctx, instanceName, "bash", "-l")
	}
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")
	return cmd
}

// HandleTerminalWS upgrades an HTTP connection to WebSocket and attaches it
// to a managed PTY session. The PTY is deliberately owned by SessionManager,
// not the request context, so a browser refresh only detaches the viewer.
func HandleTerminalWS(w http.ResponseWriter, r *http.Request, instanceName string, allowed map[string]struct{}, sessions *SessionManager) {
	normalizedInstanceName, err := config.NormalizeVMName(instanceName)
	if err != nil {
		http.Error(w, "虚拟机名称无效", http.StatusBadRequest)
		return
	}
	instanceName = normalizedInstanceName

	upgrader := websocket.Upgrader{
		CheckOrigin: func(req *http.Request) bool {
			origin := strings.TrimSpace(req.Header.Get("Origin"))
			if origin == "" || origin == "http://"+req.Host || origin == "https://"+req.Host {
				return true
			}
			_, ok := allowed[origin]
			return ok
		},
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[MacBox Terminal] WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()
	// A terminal keystroke is small, but pasted content can be large. Bound
	// each frame so a client cannot make the WebSocket implementation allocate
	// unbounded memory before the PTY sees the input.
	conn.SetReadLimit(maxTerminalMessageBytes)

	container := r.URL.Query().Get("container")
	loginUser := r.URL.Query().Get("user") // "root" or "default"
	if loginUser != "root" && loginUser != "default" && loginUser != "" {
		loginUser = "default"
	}
	if container != "" && !validContainerRef.MatchString(container) {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31m[MacBox Error] 容器名称无效\x1b[0m\r\n"))
		return
	}
	if sessions == nil {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31m[MacBox Error] 终端会话管理器未初始化。\x1b[0m\r\n"))
		return
	}

	options := terminalSessionOptions{
		InstanceName: instanceName,
		LoginUser:    loginUser,
		Container:    container,
	}
	session, created, err := sessions.Open(options, r.URL.Query().Get("session"))
	if err != nil {
		log.Printf("[MacBox Terminal] session open error: %v", err)
		_ = conn.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31m[MacBox Error] 启动终端会话失败，请检查虚拟机状态。\x1b[0m\r\n"))
		return
	}
	if err := conn.WriteJSON(map[string]any{
		"type":    "session",
		"id":      session.id,
		"resumed": !created,
	}); err != nil {
		return
	}
	session.attach(conn)
	defer session.detach(conn)

	// Read from WebSocket and write to PTY
	for {
		messageType, p, err := conn.ReadMessage()
		if err != nil {
			break
		}

		if messageType == websocket.TextMessage {
			// Check if message is a resize signal
			var resizeMsg resizeMessage
			if err := json.Unmarshal(p, &resizeMsg); err == nil && resizeMsg.Type == "resize" {
				if resizeMsg.Rows > 0 && resizeMsg.Cols > 0 {
					_ = session.resize(resizeMsg.Rows, resizeMsg.Cols)
				}
				continue
			}
		}

		// Forward raw bytes to PTY stdin
		if err := session.writeInput(p); err != nil {
			break
		}
	}
}
