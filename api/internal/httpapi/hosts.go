package httpapi

import (
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"easyssh/api/internal/cryptox"
	"easyssh/api/internal/model"
	gossh "golang.org/x/crypto/ssh"
	"gorm.io/gorm"
)

type API struct {
	db                   *gorm.DB
	vault                *cryptox.Vault
	serviceSubscribersMu sync.Mutex
	serviceSubscribers   map[chan []byte]struct{}
}

func New(db *gorm.DB, vault *cryptox.Vault) *API {
	return &API{db: db, vault: vault, serviceSubscribers: make(map[chan []byte]struct{})}
}

type hostInput struct {
	Name       string   `json:"name"`
	Address    string   `json:"address"`
	Port       int      `json:"port"`
	Username   string   `json:"username"`
	AuthType   string   `json:"authType"`
	Password   string   `json:"password"`
	PrivateKey string   `json:"privateKey"`
	Group      string   `json:"group"`
	Tags       []string `json:"tags"`
	Note       string   `json:"note"`
}
type hostView struct {
	ID              uint       `json:"id"`
	Name            string     `json:"name"`
	Address         string     `json:"address"`
	Port            int        `json:"port"`
	Username        string     `json:"username"`
	AuthType        string     `json:"authType"`
	Group           string     `json:"group"`
	Tags            []string   `json:"tags"`
	Note            string     `json:"note"`
	Status          string     `json:"status"`
	HasCredential   bool       `json:"hasCredential"`
	LastConnectedAt *time.Time `json:"lastConnectedAt"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
	mux.HandleFunc("GET /api/v1/hosts", a.listHosts)
	mux.HandleFunc("POST /api/v1/hosts", a.createHost)
	mux.HandleFunc("GET /api/v1/hosts/{id}", a.getHost)
	mux.HandleFunc("PUT /api/v1/hosts/{id}", a.updateHost)
	mux.HandleFunc("DELETE /api/v1/hosts/{id}", a.deleteHost)
	mux.HandleFunc("POST /api/v1/hosts/{id}/test", a.testSavedHost)
	mux.HandleFunc("POST /api/v1/hosts/test", a.testInput)
	mux.HandleFunc("GET /api/v1/hosts/{id}/terminal", a.terminal)
	mux.HandleFunc("GET /api/v1/hosts/{id}/files/home", a.fileHome)
	mux.HandleFunc("GET /api/v1/hosts/{id}/files", a.listRemoteFiles)
	mux.HandleFunc("DELETE /api/v1/hosts/{id}/files", a.deleteRemoteFile)
	mux.HandleFunc("GET /api/v1/hosts/{id}/files/download", a.downloadRemoteFile)
	mux.HandleFunc("POST /api/v1/hosts/{id}/files/upload", a.uploadRemoteFile)
	mux.HandleFunc("GET /api/v1/settings/ai", a.getSettings)
	mux.HandleFunc("PUT /api/v1/settings/ai", a.saveSettings)
	mux.HandleFunc("POST /api/v1/hosts/{id}/agent/tasks", a.createAgentTask)
	mux.HandleFunc("GET /api/v1/hosts/{id}/agent/tasks", a.listAgentTasks)
	mux.HandleFunc("POST /api/v1/agent/tasks/{id}/approve", a.approveAgentTask)
	mux.HandleFunc("POST /api/v1/agent/tasks/{id}/reject", a.rejectAgentTask)
	mux.HandleFunc("GET /api/v1/assistant/conversations", a.listAssistantConversations)
	mux.HandleFunc("POST /api/v1/assistant/conversations", a.createAssistantConversation)
	mux.HandleFunc("GET /api/v1/hosts/{id}/assistant/conversations", a.listHostAssistantConversations)
	mux.HandleFunc("POST /api/v1/hosts/{id}/assistant/conversations", a.createHostAssistantConversation)
	mux.HandleFunc("GET /api/v1/assistant/conversations/{id}", a.getAssistantConversation)
	mux.HandleFunc("POST /api/v1/assistant/conversations/{id}/messages", a.sendAssistantMessage)
	mux.HandleFunc("POST /api/v1/assistant/approvals/{id}/approve", a.approveAssistantCall)
	mux.HandleFunc("POST /api/v1/assistant/approvals/{id}/reject", a.rejectAssistantCall)
	mux.HandleFunc("GET /api/v1/services", a.listServices)
	mux.HandleFunc("POST /api/v1/services", a.createService)
	mux.HandleFunc("PUT /api/v1/services/{id}", a.updateService)
	mux.HandleFunc("DELETE /api/v1/services/{id}", a.deleteService)
	mux.HandleFunc("POST /api/v1/services/{id}/check", a.checkServiceNow)
	mux.HandleFunc("GET /api/v1/services/{id}/checks", a.listServiceChecks)
	mux.HandleFunc("GET /api/v1/services/events", a.serviceEvents)
	return cors(mux)
}
func (a *API) listHosts(w http.ResponseWriter, _ *http.Request) {
	var hosts []model.Host
	if err := a.db.Order("updated_at desc").Find(&hosts).Error; err != nil {
		fail(w, 500, err)
		return
	}
	result := make([]hostView, 0, len(hosts))
	for _, h := range hosts {
		result = append(result, view(h))
	}
	writeJSON(w, 200, result)
}
func (a *API) getHost(w http.ResponseWriter, r *http.Request) {
	if h, ok := a.find(w, r); ok {
		writeJSON(w, 200, view(h))
	}
}
func (a *API) createHost(w http.ResponseWriter, r *http.Request) {
	var in hostInput
	if !decode(w, r, &in) || !validate(w, in) {
		return
	}
	h, err := a.fromInput(in, nil)
	if err != nil {
		fail(w, 500, err)
		return
	}
	if err = a.db.Create(&h).Error; err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, 201, view(h))
}
func (a *API) updateHost(w http.ResponseWriter, r *http.Request) {
	old, ok := a.find(w, r)
	if !ok {
		return
	}
	var in hostInput
	if !decode(w, r, &in) || !validate(w, in) {
		return
	}
	h, err := a.fromInput(in, &old)
	if err != nil {
		fail(w, 500, err)
		return
	}
	h.ID = old.ID
	h.CreatedAt = old.CreatedAt
	if err = a.db.Save(&h).Error; err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, 200, view(h))
}
func (a *API) deleteHost(w http.ResponseWriter, r *http.Request) {
	h, ok := a.find(w, r)
	if !ok {
		return
	}
	if err := a.db.Delete(&h).Error; err != nil {
		fail(w, 500, err)
		return
	}
	w.WriteHeader(204)
}
func (a *API) testSavedHost(w http.ResponseWriter, r *http.Request) {
	h, ok := a.find(w, r)
	if !ok {
		return
	}
	start := time.Now()
	err := a.sshTest(h)
	status := "online"
	if err != nil {
		status = "offline"
	}
	a.db.Model(&h).Update("last_status", status)
	if err == nil {
		now := time.Now()
		a.db.Model(&h).Update("last_connected_at", &now)
	}
	testResponse(w, start, err)
}
func (a *API) testInput(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	var in hostInput
	if !decode(w, r, &in) || !validate(w, in) {
		return
	}
	h, err := a.fromInput(in, nil)
	if err == nil {
		err = a.sshTest(h)
	}
	testResponse(w, start, err)
}

func (a *API) find(w http.ResponseWriter, r *http.Request) (model.Host, bool) {
	id, err := strconv.ParseUint(r.PathValue("id"), 10, 64)
	if err != nil {
		failMessage(w, 400, "invalid host id")
		return model.Host{}, false
	}
	var h model.Host
	if err = a.db.First(&h, uint(id)).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			failMessage(w, 404, "host not found")
		} else {
			fail(w, 500, err)
		}
		return h, false
	}
	return h, true
}
func (a *API) fromInput(in hostInput, old *model.Host) (model.Host, error) {
	h := model.Host{Name: strings.TrimSpace(in.Name), Address: strings.TrimSpace(in.Address), Port: in.Port, Username: strings.TrimSpace(in.Username), AuthType: in.AuthType, GroupName: strings.TrimSpace(in.Group), Tags: strings.Join(in.Tags, ","), Note: strings.TrimSpace(in.Note), LastStatus: "unknown"}
	if old != nil {
		h.PasswordEncrypted = old.PasswordEncrypted
		h.PrivateKeyEncrypted = old.PrivateKeyEncrypted
		h.LastStatus = old.LastStatus
		h.LastConnectedAt = old.LastConnectedAt
	}
	var err error
	if in.Password != "" {
		h.PasswordEncrypted, err = a.vault.Encrypt(in.Password)
		h.PrivateKeyEncrypted = ""
	}
	if err == nil && in.PrivateKey != "" {
		h.PrivateKeyEncrypted, err = a.vault.Encrypt(in.PrivateKey)
		h.PasswordEncrypted = ""
	}
	return h, err
}
func (a *API) sshTest(h model.Host) error {
	auth, err := a.sshAuth(h)
	if err != nil {
		return err
	}
	client, err := gossh.Dial("tcp", net.JoinHostPort(h.Address, strconv.Itoa(h.Port)), &gossh.ClientConfig{User: h.Username, Auth: []gossh.AuthMethod{auth}, HostKeyCallback: gossh.InsecureIgnoreHostKey(), Timeout: 8 * time.Second})
	if err != nil {
		return err
	}
	return client.Close()
}
func view(h model.Host) hostView {
	tags := []string{}
	if h.Tags != "" {
		tags = strings.Split(h.Tags, ",")
	}
	return hostView{h.ID, h.Name, h.Address, h.Port, h.Username, h.AuthType, h.GroupName, tags, h.Note, h.LastStatus, h.PasswordEncrypted != "" || h.PrivateKeyEncrypted != "", h.LastConnectedAt, h.CreatedAt, h.UpdatedAt}
}
func validate(w http.ResponseWriter, in hostInput) bool {
	if strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.Address) == "" || strings.TrimSpace(in.Username) == "" {
		failMessage(w, 400, "name, address and username are required")
		return false
	}
	if in.Port < 1 || in.Port > 65535 {
		failMessage(w, 400, "port must be between 1 and 65535")
		return false
	}
	if in.AuthType != "password" && in.AuthType != "key" {
		failMessage(w, 400, "authType must be password or key")
		return false
	}
	return true
}
func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	if err := json.NewDecoder(r.Body).Decode(value); err != nil {
		failMessage(w, 400, "invalid JSON body")
		return false
	}
	return true
}
func testResponse(w http.ResponseWriter, start time.Time, err error) {
	if err != nil {
		writeJSON(w, 422, map[string]any{"success": false, "message": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "message": "SSH connection successful", "latencyMs": time.Since(start).Milliseconds()})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, err error) { failMessage(w, status, err.Error()) }
func failMessage(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"message": message})
}
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "http://localhost:5173" || origin == "http://127.0.0.1:5173" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
