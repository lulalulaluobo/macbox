package terminal

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for local NAS management
	},
}

type resizeMessage struct {
	Type string `json:"type"`
	Rows uint16 `json:"rows"`
	Cols uint16 `json:"cols"`
}

// HandleTerminalWS upgrades an HTTP connection to WebSocket and connects it to a live PTY session
// running limactl shell <instanceName>
func HandleTerminalWS(w http.ResponseWriter, r *http.Request, instanceName string) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[MacNAS Terminal] WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	if instanceName == "" {
		instanceName = "macnas"
	}

	container := r.URL.Query().Get("container")
	var cmd *exec.Cmd
	if container != "" {
		// Connect to container's interactive shell, fallback bash -> sh
		cmd = exec.Command("limactl", "shell", instanceName, "bash", "-c", fmt.Sprintf("docker exec -it %s sh -c 'bash || sh'", container))
	} else {
		cmd = exec.Command("limactl", "shell", instanceName)
	}
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Printf("[MacNAS Terminal] PTY start error: %v", err)
		_ = conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("\r\n\x1b[31m[MacNAS Error] 启动终端会话失败: %v\x1b[0m\r\n", err)))
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
