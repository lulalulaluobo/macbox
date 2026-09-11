package terminal

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"github.com/luluen/mac-nas/pkg/config"
)

var validContainerRef = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)

const maxTerminalMessageBytes = 256 << 10

type resizeMessage struct {
	Type string `json:"type"`
	Rows uint16 `json:"rows"`
	Cols uint16 `json:"cols"`
}

// managementCommand starts a fresh process for macnasctl so repaired
// supplementary groups (docker/macnas) are visible immediately. Keep sudo -i
// out of this path because its login-shell handling rewrites multiline -c
// scripts passed to Python.
func managementCommand(ctx context.Context, instanceName string, command ...string) *exec.Cmd {
	args := append([]string{"shell", instanceName, "sudo", "-u", "macnasctl", "--"}, command...)
	return exec.CommandContext(ctx, "limactl", args...)
}

// HandleTerminalWS upgrades an HTTP connection to WebSocket and connects it to a live PTY session
// running limactl shell <instanceName>
func HandleTerminalWS(w http.ResponseWriter, r *http.Request, instanceName string, allowedOrigins ...map[string]struct{}) {
	normalizedInstanceName, err := config.NormalizeVMName(instanceName)
	if err != nil {
		http.Error(w, "虚拟机名称无效", http.StatusBadRequest)
		return
	}
	instanceName = normalizedInstanceName

	allowed := map[string]struct{}{}
	if len(allowedOrigins) > 0 && allowedOrigins[0] != nil {
		allowed = allowedOrigins[0]
	}
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
		log.Printf("[MacNAS Terminal] WebSocket upgrade error: %v", err)
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

	var cmd *exec.Cmd
	if container != "" {
		if !validContainerRef.MatchString(container) {
			_ = conn.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31m[MacNAS Error] 容器名称无效\x1b[0m\r\n"))
			return
		}
		dockerArgs := []string{"docker", "exec"}
		if loginUser == "root" {
			dockerArgs = append(dockerArgs, "-u", "0")
		}
		dockerArgs = append(dockerArgs, "-it", container, "sh")
		cmd = managementCommand(r.Context(), instanceName, dockerArgs...)
	} else {
		if loginUser == "root" {
			cmd = exec.CommandContext(r.Context(), "limactl", "shell", instanceName, "sudo", "-i")
		} else {
			cmd = managementCommand(r.Context(), instanceName, "bash", "-l")
		}
	}
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Printf("[MacNAS Terminal] PTY start error: %v", err)
		_ = conn.WriteMessage(websocket.TextMessage, []byte("\r\n\x1b[31m[MacNAS Error] 启动终端会话失败，请检查虚拟机状态。\x1b[0m\r\n"))
		return
	}
	defer func() {
		_ = ptmx.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()

	var once sync.Once
	closeSession := func() {
		_ = ptmx.Close()
		_ = conn.Close()
	}

	// Read from PTY and write to WebSocket
	go func() {
		defer once.Do(closeSession)
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				if err != io.EOF {
					// Client or PTY closed
				}
				return
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				return
			}
		}
	}()

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
					_ = pty.Setsize(ptmx, &pty.Winsize{
						Rows: resizeMsg.Rows,
						Cols: resizeMsg.Cols,
					})
				}
				continue
			}
		}

		// Forward raw bytes to PTY stdin
		if _, err := ptmx.Write(p); err != nil {
			break
		}
	}

	once.Do(closeSession)
}
