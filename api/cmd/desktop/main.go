package main

import (
	"context"
	"crypto/rand"
	"easyssh/api/internal/config"
	"easyssh/api/internal/cryptox"
	"easyssh/api/internal/database"
	"easyssh/api/internal/httpapi"
	"easyssh/api/internal/model"
	"easyssh/api/internal/webui"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() (runErr error) {
	// Keep existing portable data beside the executable, independent of the
	// working directory used by Explorer or a shortcut.
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if err = os.Chdir(filepath.Dir(executable)); err != nil {
		return err
	}
	cfg := config.Load()
	if err = os.MkdirAll(cfg.DataDir, 0700); err != nil {
		return err
	}
	if output, openErr := os.OpenFile(filepath.Join(cfg.DataDir, "desktop.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600); openErr == nil {
		defer func() {
			if runErr != nil {
				log.Print(runErr)
			}
			_ = output.Close()
			log.SetOutput(os.Stderr)
		}()
		log.SetOutput(output)
	}
	db, err := database.Open(cfg)
	if err != nil {
		return err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	defer sqlDB.Close()
	if err = db.AutoMigrate(&model.Host{}, &model.TerminalSession{}, &model.AISettings{}, &model.AgentTask{}, &model.AssistantConversation{}, &model.AssistantApproval{}, &model.Service{}, &model.ServiceCheck{}, &model.DatabaseConnection{}, &model.DatabaseQuery{}, &model.DatabaseAgentConversation{}, &model.DatabaseAgentExchange{}); err != nil {
		return err
	}
	vault, err := cryptox.Open(cfg.DataDir)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	api := httpapi.New(db, vault)
	api.StartServiceMonitor(ctx)
	router := http.NewServeMux()
	router.Handle("/desktop/preferences", preferencesHandler(cfg.DataDir))
	router.Handle("/api/", api.Handler())
	router.Handle("/", webui.Handler())
	token := make([]byte, 32)
	if _, err = rand.Read(token); err != nil {
		listener.Close()
		return err
	}
	secret := fmt.Sprintf("%x", token)
	host := listener.Addr().String()
	log.Printf("EasySSH desktop listening on http://%s", host)
	server := &http.Server{
		Handler:           desktopHandler(router, host, secret),
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	defer server.Close()
	desktop := &DesktopService{host: host}
	app := application.New(application.Options{
		Name:        "EasySSH",
		Icon:        appIcon,
		Description: "SSH and database workspace",
		Services: []application.Service{application.NewService(desktop)},
		Mac:         application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
		OnShutdown: func() {
			cancel()
			shutdown, stop := context.WithTimeout(context.Background(), 3*time.Second)
			defer stop()
			_ = server.Shutdown(shutdown)
			_ = server.Close()
		},
	})
	desktop.app = app
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && serveErr != http.ErrServerClosed {
			log.Print(serveErr)
			app.Quit()
		}
	}()
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "EasySSH", Width: 1440, Height: 900, MinWidth: 1000, MinHeight: 650,
		URL: "http://" + host + "/desktop/start?token=" + secret,
	})
	return app.Run()
}

type DesktopService struct {
	app  *application.App
	host string
}

func (s *DesktopService) OpenWorkspace(hostID int) {
	if s.app == nil || hostID <= 0 {
		return
	}
	s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: fmt.Sprintf("EasySSH - Host %d", hostID),
		Width: 1440, Height: 900, MinWidth: 1000, MinHeight: 650,
		URL: fmt.Sprintf("http://%s/workspace/%d", s.host, hostID),
	}).Show()
}

func (s *DesktopService) OpenDatabaseWorkspace(databaseID int) {
	if s.app == nil || databaseID <= 0 {
		return
	}
	s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: fmt.Sprintf("EasySSH - Database %d", databaseID),
		Width: 1440, Height: 900, MinWidth: 1000, MinHeight: 650,
		URL: fmt.Sprintf("http://%s/database/%d", s.host, databaseID),
	}).Show()
}

// Authenticate all transports (fetch, SSE, uploads and WebSockets) with an
// HttpOnly session cookie. A fresh secret is generated for every launch.
func desktopHandler(next http.Handler, host, secret string) http.Handler {
	cookieName := "easyssh_session_" + strings.ReplaceAll(host, ":", "_")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != host {
			http.Error(w, "invalid host", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+host {
			http.Error(w, "invalid origin", http.StatusForbidden)
			return
		}
		if r.URL.Path == "/desktop/start" && r.URL.Query().Get("token") == secret {
			http.SetCookie(w, &http.Cookie{Name: cookieName, Value: secret, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			w.Header().Set("Referrer-Policy", "no-referrer")
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}
		cookie, err := r.Cookie(cookieName)
		if err != nil || cookie.Value != secret {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
