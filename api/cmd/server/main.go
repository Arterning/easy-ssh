package main

import (
	"easyssh/api/internal/config"
	"easyssh/api/internal/cryptox"
	"easyssh/api/internal/database"
	"easyssh/api/internal/httpapi"
	"easyssh/api/internal/model"
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
	if err = db.AutoMigrate(&model.Host{}, &model.TerminalSession{}, &model.AISettings{}, &model.AgentTask{}); err != nil {
		log.Fatal(err)
	}
	vault, err := cryptox.Open(cfg.DataDir)
	if err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Addr: cfg.Address, Handler: httpapi.New(db, vault).Handler(), ReadHeaderTimeout: 10 * time.Second}
	log.Printf("EasySSH API listening on %s (%s)", cfg.Address, cfg.DatabaseDriver)
	log.Fatal(server.ListenAndServe())
}
