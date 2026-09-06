package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"

	"easyssh/api/internal/model"
	"github.com/gorilla/websocket"
	gossh "golang.org/x/crypto/ssh"
)

var terminalUpgrader = websocket.Upgrader{
	HandshakeTimeout: 10 * time.Second,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		return origin == "" || origin == "http://localhost:5173" || origin == "http://127.0.0.1:5173"
	},
}

type terminalMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

func (a *API) terminal(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(r.PathValue("id"), 10, 64)
	if err != nil {
		failMessage(w, 400, "invalid host id")
		return
	}
	var host model.Host
	if err = a.db.First(&host, uint(id)).Error; err != nil {
		failMessage(w, 404, "host not found")
		return
	}
	conn, err := terminalUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	auth, err := a.sshAuth(host)
	if err != nil {
		sendTerminalControl(conn, "error", err.Error())
		return
	}
	client, err := gossh.Dial("tcp", net.JoinHostPort(host.Address, strconv.Itoa(host.Port)), &gossh.ClientConfig{User: host.Username, Auth: []gossh.AuthMethod{auth}, HostKeyCallback: gossh.InsecureIgnoreHostKey(), Timeout: 10 * time.Second})
	if err != nil {
		sendTerminalControl(conn, "error", err.Error())
		a.setHostStatus(host.ID, "offline", false)
		return
	}
	defer client.Close()
	session, err := client.NewSession()
	if err != nil {
		sendTerminalControl(conn, "error", err.Error())
		return
	}
	defer session.Close()
	if err = session.RequestPty("xterm-256color", 24, 80, gossh.TerminalModes{gossh.ECHO: 1, gossh.TTY_OP_ISPEED: 38400, gossh.TTY_OP_OSPEED: 38400}); err != nil {
		sendTerminalControl(conn, "error", err.Error())
		return
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		sendTerminalControl(conn, "error", err.Error())
		return
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		sendTerminalControl(conn, "error", err.Error())
		return
	}
	stderr, _ := session.StderrPipe()
	if err = session.Shell(); err != nil {
		sendTerminalControl(conn, "error", err.Error())
		return
	}
	started := time.Now()
	logEntry := model.TerminalSession{HostID: host.ID, HostAddress: host.Address, Username: host.Username, StartedAt: started, Status: "connected"}
	a.db.Create(&logEntry)
	a.setHostStatus(host.ID, "online", true)
	defer func() {
		ended := time.Now()
		a.db.Model(&logEntry).Updates(map[string]any{"ended_at": &ended, "duration": int64(ended.Sub(started).Seconds()), "status": "closed"})
	}()
	writeMu := &sync.Mutex{}
	sendControlLocked(conn, writeMu, "connected", "")
	done := make(chan struct{})
	var once sync.Once
	stop := func() { once.Do(func() { close(done) }) }
	copyOutput := func(reader io.Reader) {
		buf := make([]byte, 32*1024)
		for {
			n, readErr := reader.Read(buf)
			if n > 0 {
				writeMu.Lock()
				writeErr := conn.WriteMessage(websocket.BinaryMessage, buf[:n])
				writeMu.Unlock()
				if writeErr != nil {
					stop()
					return
				}
			}
			if readErr != nil {
				stop()
				return
			}
		}
	}
	go copyOutput(stdout)
	if stderr != nil {
		go copyOutput(stderr)
	}
	go func() {
		defer stop()
		for {
			_, payload, readErr := conn.ReadMessage()
			if readErr != nil {
				return
			}
			var msg terminalMessage
			if json.Unmarshal(payload, &msg) != nil {
				continue
			}
			switch msg.Type {
			case "input":
				_, _ = stdin.Write([]byte(msg.Data))
			case "resize":
				if msg.Cols > 0 && msg.Rows > 0 {
					_ = session.WindowChange(msg.Rows, msg.Cols)
				}
			}
		}
	}()
	<-done
}

func (a *API) sshAuth(host model.Host) (gossh.AuthMethod, error) {
	if host.AuthType == "key" {
		value, err := a.vault.Decrypt(host.PrivateKeyEncrypted)
		if err != nil {
			return nil, err
		}
		if value == "" {
			return nil, fmt.Errorf("private key is not configured")
		}
		signer, err := gossh.ParsePrivateKey([]byte(value))
		if err != nil {
			return nil, fmt.Errorf("invalid private key: %w", err)
		}
		return gossh.PublicKeys(signer), nil
	}
	value, err := a.vault.Decrypt(host.PasswordEncrypted)
	if err != nil {
		return nil, err
	}
	if value == "" {
		return nil, fmt.Errorf("password is not configured")
	}
	return gossh.Password(value), nil
}
func (a *API) setHostStatus(id uint, status string, connected bool) {
	updates := map[string]any{"last_status": status}
	if connected {
		now := time.Now()
		updates["last_connected_at"] = &now
	}
	a.db.Model(&model.Host{}).Where("id = ?", id).Updates(updates)
}
func sendTerminalControl(conn *websocket.Conn, messageType, message string) {
	_ = conn.WriteJSON(map[string]string{"type": messageType, "message": message})
}
func sendControlLocked(conn *websocket.Conn, mu *sync.Mutex, messageType, message string) {
	mu.Lock()
	defer mu.Unlock()
	sendTerminalControl(conn, messageType, message)
}
