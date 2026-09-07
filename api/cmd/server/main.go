package main

import (
	"easyssh/api/internal/config"
	"easyssh/api/internal/cryptox"
	"easyssh/api/internal/database"
	"easyssh/api/internal/httpapi"
	"easyssh/api/internal/model"
	"easyssh/api/internal/webui"
	"log"
	"net/http"
	"time"
)

func main() {
	cfg := config.Load()
	db, err := database.Open(cfg)
	if err != nil {
		log.Fatal(err)
	}
	if err = db.AutoMigrate(&model.Host{}, &model.TerminalSession{}, &model.AISettings{}, &model.AgentTask{}, &model.AssistantConversation{}, &model.AssistantApproval{}); err != nil {
		log.Fatal(err)
	}
	vault, err := cryptox.Open(cfg.DataDir)
	if err != nil {
		log.Fatal(err)
	}
	router := http.NewServeMux()
	router.Handle("/api/", httpapi.New(db, vault).Handler())
	router.Handle("/", webui.Handler())
	server := &http.Server{Addr: cfg.Address, Handler: router, ReadHeaderTimeout: 10 * time.Second}
	log.Printf("EasySSH listening on http://localhost%s (%s)", cfg.Address, cfg.DatabaseDriver)
	log.Fatal(server.ListenAndServe())
}
