package main

import (
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestDesktopSession(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	host := listener.Addr().String()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/terminal" {
			upgrader := websocket.Upgrader{}
			conn, err := upgrader.Upgrade(w, r, nil)
			if err == nil {
				defer conn.Close()
				_ = conn.WriteMessage(websocket.TextMessage, []byte("ready"))
			}
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	server := httptest.NewUnstartedServer(desktopHandler(next, host, "test-secret"))
	server.Listener.Close()
	server.Listener = listener
	server.Start()
	defer server.Close()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	response, err := client.Get(server.URL + "/api/v1/health")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status: %d", response.StatusCode)
	}
	response, err = client.Get(server.URL + "/desktop/start?token=test-secret")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("bootstrap status: %d", response.StatusCode)
	}
	request, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/hosts", nil)
	request.Header.Set("Origin", "https://example.com")
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin status: %d", response.StatusCode)
	}
	dialer := websocket.Dialer{Jar: jar}
	conn, _, err := dialer.Dial(strings.Replace(server.URL, "http:", "ws:", 1)+"/terminal", http.Header{"Origin": []string{server.URL}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, message, err := conn.ReadMessage()
	if err != nil || string(message) != "ready" {
		t.Fatalf("WebSocket message %q: %v", message, err)
	}
}
