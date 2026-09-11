package httpapi

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"easyssh/api/internal/model"
	glebarezsqlite "github.com/glebarez/sqlite"
	gossh "golang.org/x/crypto/ssh"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"net/http"
)

type databaseInput struct {
	ConnectionID *uint    `json:"connectionId"`
	Name         string   `json:"name"`
	Type         string   `json:"type"`
	Address      string   `json:"address"`
	Port         int      `json:"port"`
	DatabaseName string   `json:"databaseName"`
	Username     string   `json:"username"`
	Password     string   `json:"password"`
	SQLitePath   string   `json:"sqlitePath"`
	SSLMode      string   `json:"sslMode"`
	UseSSHTunnel bool     `json:"useSshTunnel"`
	SSHHostID    *uint    `json:"sshHostId"`
	Group        string   `json:"group"`
	Tags         []string `json:"tags"`
	Note         string   `json:"note"`
}

type databaseView struct {
	ID            uint       `json:"id"`
	Name          string     `json:"name"`
	Type          string     `json:"type"`
	Address       string     `json:"address"`
	Port          int        `json:"port"`
	DatabaseName  string     `json:"databaseName"`
	Username      string     `json:"username"`
	SQLitePath    string     `json:"sqlitePath"`
	SSLMode       string     `json:"sslMode"`
	UseSSHTunnel  bool       `json:"useSshTunnel"`
	SSHHostID     *uint      `json:"sshHostId"`
	Group         string     `json:"group"`
	Tags          []string   `json:"tags"`
	Note          string     `json:"note"`
	Status        string     `json:"status"`
	LastError     string     `json:"lastError"`
	HasCredential bool       `json:"hasCredential"`
	LastTestedAt  *time.Time `json:"lastTestedAt"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

func (a *API) listDatabaseConnections(w http.ResponseWriter, _ *http.Request) {
	var items []model.DatabaseConnection
	if err := a.db.Order("updated_at desc").Find(&items).Error; err != nil {
		fail(w, 500, err)
		return
	}
	result := make([]databaseView, 0, len(items))
	for _, item := range items {
		result = append(result, databaseConnectionView(item))
	}
	writeJSON(w, 200, result)
}

func (a *API) getDatabaseConnection(w http.ResponseWriter, r *http.Request) {
	item, ok := a.findDatabaseConnection(w, r)
	if ok {
		writeJSON(w, 200, databaseConnectionView(item))
	}
}

func (a *API) createDatabaseConnection(w http.ResponseWriter, r *http.Request) {
	var in databaseInput
	if !decode(w, r, &in) || !validateDatabaseInput(w, in) {
		return
	}
	item, err := a.databaseConnectionFromInput(in, nil)
	if err != nil {
		fail(w, 500, err)
		return
	}
	if err = a.db.Create(&item).Error; err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, 201, databaseConnectionView(item))
}

func (a *API) updateDatabaseConnection(w http.ResponseWriter, r *http.Request) {
	old, ok := a.findDatabaseConnection(w, r)
	if !ok {
		return
	}
	var in databaseInput
	if !decode(w, r, &in) || !validateDatabaseInput(w, in) {
		return
	}
	item, err := a.databaseConnectionFromInput(in, &old)
	if err != nil {
		fail(w, 500, err)
		return
	}
	item.ID, item.CreatedAt = old.ID, old.CreatedAt
	if err = a.db.Save(&item).Error; err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, 200, databaseConnectionView(item))
}

func (a *API) deleteDatabaseConnection(w http.ResponseWriter, r *http.Request) {
	item, ok := a.findDatabaseConnection(w, r)
	if !ok {
		return
	}
	if err := a.db.Delete(&item).Error; err != nil {
		fail(w, 500, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) testDatabaseInput(w http.ResponseWriter, r *http.Request) {
	var in databaseInput
	if !decode(w, r, &in) || !validateDatabaseInput(w, in) {
		return
	}
	var old *model.DatabaseConnection
	if in.ConnectionID != nil {
		var saved model.DatabaseConnection
		if err := a.db.First(&saved, *in.ConnectionID).Error; err != nil {
			failMessage(w, 404, "database connection not found")
			return
		}
		old = &saved
	}
	item, err := a.databaseConnectionFromInput(in, old)
	if err == nil {
		err = a.testDatabaseConnection(r.Context(), item)
	}
	databaseTestResponse(w, time.Now(), err)
}

func (a *API) testSavedDatabaseConnection(w http.ResponseWriter, r *http.Request) {
	item, ok := a.findDatabaseConnection(w, r)
	if !ok {
		return
	}
	start := time.Now()
	err := a.testDatabaseConnection(r.Context(), item)
	now, status, message := time.Now(), "online", ""
	if err != nil {
		status, message = "offline", err.Error()
	}
	a.db.Model(&item).Updates(map[string]any{"last_status": status, "last_error": message, "last_tested_at": &now})
	databaseTestResponse(w, start, err)
}

func (a *API) findDatabaseConnection(w http.ResponseWriter, r *http.Request) (model.DatabaseConnection, bool) {
	id, err := strconv.ParseUint(r.PathValue("id"), 10, 64)
	if err != nil {
		failMessage(w, 400, "invalid database connection id")
		return model.DatabaseConnection{}, false
	}
	var item model.DatabaseConnection
	if err = a.db.First(&item, uint(id)).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			failMessage(w, 404, "database connection not found")
		} else {
			fail(w, 500, err)
		}
		return item, false
	}
	return item, true
}

func validateDatabaseInput(w http.ResponseWriter, in databaseInput) bool {
	if strings.TrimSpace(in.Name) == "" {
		failMessage(w, 400, "name is required")
		return false
	}
	if in.Type != "sqlite" && in.Type != "mysql" && in.Type != "postgres" {
		failMessage(w, 400, "type must be sqlite, mysql or postgres")
		return false
	}
	if in.Type == "sqlite" {
		if strings.TrimSpace(in.SQLitePath) == "" {
			failMessage(w, 400, "sqlitePath is required")
			return false
		}
		if in.UseSSHTunnel {
			failMessage(w, 400, "SSH tunnel is not supported for sqlite")
			return false
		}
		return true
	}
	if strings.TrimSpace(in.Address) == "" || strings.TrimSpace(in.DatabaseName) == "" || strings.TrimSpace(in.Username) == "" {
		failMessage(w, 400, "address, databaseName and username are required")
		return false
	}
	if in.Port < 1 || in.Port > 65535 {
		failMessage(w, 400, "port must be between 1 and 65535")
		return false
	}
	if in.UseSSHTunnel && (in.SSHHostID == nil || *in.SSHHostID == 0) {
		failMessage(w, 400, "sshHostId is required when SSH tunnel is enabled")
		return false
	}
	if in.SSLMode != "disable" && in.SSLMode != "prefer" && in.SSLMode != "require" && in.SSLMode != "verify-ca" && in.SSLMode != "verify-full" {
		failMessage(w, 400, "invalid sslMode")
		return false
	}
	return true
}

func (a *API) databaseConnectionFromInput(in databaseInput, old *model.DatabaseConnection) (model.DatabaseConnection, error) {
	item := model.DatabaseConnection{Name: strings.TrimSpace(in.Name), Type: in.Type, Address: strings.TrimSpace(in.Address), Port: in.Port, DatabaseName: strings.TrimSpace(in.DatabaseName), Username: strings.TrimSpace(in.Username), SQLitePath: strings.TrimSpace(in.SQLitePath), SSLMode: in.SSLMode, UseSSHTunnel: in.UseSSHTunnel, SSHHostID: in.SSHHostID, GroupName: strings.TrimSpace(in.Group), Tags: strings.Join(in.Tags, ","), Note: strings.TrimSpace(in.Note), LastStatus: "unknown"}
	if old != nil {
		item.PasswordEncrypted, item.LastStatus, item.LastError, item.LastTestedAt = old.PasswordEncrypted, old.LastStatus, old.LastError, old.LastTestedAt
	}
	if in.Type == "sqlite" {
		item.Address, item.DatabaseName, item.Username, item.PasswordEncrypted, item.SSLMode, item.UseSSHTunnel, item.SSHHostID = "", "", "", "", "", false, nil
	}
	if in.Password != "" {
		encrypted, err := a.vault.Encrypt(in.Password)
		if err != nil {
			return item, err
		}
		item.PasswordEncrypted = encrypted
	}
	return item, nil
}

func databaseConnectionView(item model.DatabaseConnection) databaseView {
	tags := []string{}
	if item.Tags != "" {
		tags = strings.Split(item.Tags, ",")
	}
	return databaseView{item.ID, item.Name, item.Type, item.Address, item.Port, item.DatabaseName, item.Username, item.SQLitePath, item.SSLMode, item.UseSSHTunnel, item.SSHHostID, item.GroupName, tags, item.Note, item.LastStatus, item.LastError, item.PasswordEncrypted != "", item.LastTestedAt, item.CreatedAt, item.UpdatedAt}
}

func databaseTestResponse(w http.ResponseWriter, start time.Time, err error) {
	if err != nil {
		writeJSON(w, 422, map[string]any{"success": false, "message": err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{"success": true, "message": "数据库连接成功", "latencyMs": time.Since(start).Milliseconds()})
}

func (a *API) testDatabaseConnection(ctx context.Context, item model.DatabaseConnection) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	db, closeFn, err := a.openDatabase(ctx, item)
	if err != nil {
		return err
	}
	defer closeFn()
	return db.PingContext(ctx)
}

func (a *API) openDatabase(ctx context.Context, item model.DatabaseConnection) (*sql.DB, func(), error) {
	host, port := item.Address, item.Port
	closeTunnel := func() {}
	if item.UseSSHTunnel {
		localAddress, closeFn, err := a.openDatabaseTunnel(ctx, item)
		if err != nil {
			return nil, closeTunnel, fmt.Errorf("SSH 隧道连接失败: %w", err)
		}
		closeTunnel = closeFn
		var portText string
		host, portText, _ = net.SplitHostPort(localAddress)
		port, _ = strconv.Atoi(portText)
	}
	password, err := a.vault.Decrypt(item.PasswordEncrypted)
	if err != nil {
		closeTunnel()
		return nil, func() {}, err
	}
	var dialector gorm.Dialector
	switch item.Type {
	case "sqlite":
		dialector = glebarezsqlite.Open(item.SQLitePath)
	case "mysql":
		dsn := fmt.Sprintf("%s:%s@tcp(%s)/%s?charset=utf8mb4&parseTime=True&loc=Local&timeout=8s", item.Username, password, net.JoinHostPort(host, strconv.Itoa(port)), item.DatabaseName)
		if item.SSLMode != "disable" {
			tlsMode := "true"
			if item.SSLMode == "prefer" {
				tlsMode = "preferred"
			}
			dsn += "&tls=" + tlsMode
		}
		dialector = mysql.Open(dsn)
	case "postgres":
		dsn := (&url.URL{Scheme: "postgres", User: url.UserPassword(item.Username, password), Host: net.JoinHostPort(host, strconv.Itoa(port)), Path: item.DatabaseName, RawQuery: "sslmode=" + url.QueryEscape(item.SSLMode) + "&connect_timeout=8"}).String()
		dialector = postgres.Open(dsn)
	}
	db, err := gorm.Open(dialector, &gorm.Config{DisableAutomaticPing: true})
	if err != nil {
		closeTunnel()
		return nil, func() {}, err
	}
	sqlDB, err := db.DB()
	if err != nil {
		closeTunnel()
		return nil, func() {}, err
	}
	return sqlDB, func() { sqlDB.Close(); closeTunnel() }, nil
}

func (a *API) openDatabaseTunnel(ctx context.Context, item model.DatabaseConnection) (string, func(), error) {
	var host model.Host
	if item.SSHHostID == nil || a.db.First(&host, *item.SSHHostID).Error != nil {
		return "", nil, fmt.Errorf("关联主机不存在")
	}
	auth, err := a.sshAuth(host)
	if err != nil {
		return "", nil, err
	}
	client, err := gossh.Dial("tcp", net.JoinHostPort(host.Address, strconv.Itoa(host.Port)), &gossh.ClientConfig{User: host.Username, Auth: []gossh.AuthMethod{auth}, HostKeyCallback: gossh.InsecureIgnoreHostKey(), Timeout: 8 * time.Second})
	if err != nil {
		return "", nil, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		client.Close()
		return "", nil, err
	}
	done := make(chan struct{})
	go func() {
		for {
			local, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			remote, dialErr := client.Dial("tcp", net.JoinHostPort(item.Address, strconv.Itoa(item.Port)))
			if dialErr != nil {
				local.Close()
				continue
			}
			go proxyTunnel(local, remote)
		}
	}()
	go func() {
		select {
		case <-ctx.Done():
			listener.Close()
			client.Close()
		case <-done:
		}
	}()
	closeFn := func() { close(done); listener.Close(); client.Close() }
	return listener.Addr().String(), closeFn, nil
}

func proxyTunnel(left, right net.Conn) {
	defer left.Close()
	defer right.Close()
	finished := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(left, right); finished <- struct{}{} }()
	go func() { _, _ = io.Copy(right, left); finished <- struct{}{} }()
	<-finished
}
