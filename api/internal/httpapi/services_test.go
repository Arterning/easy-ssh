package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"easyssh/api/internal/model"
)

func TestHTTPStatusRules(t *testing.T) {
	for _, rule := range []string{"200-299", "200,204", "301"} {
		if !validStatusRule(rule) {
			t.Errorf("expected %q to be valid", rule)
		}
	}
	for _, rule := range []string{"", "ok", "99", "600", "299-200"} {
		if validStatusRule(rule) {
			t.Errorf("expected %q to be invalid", rule)
		}
	}
	if !matchesHTTPStatus("200-299,304", 204) || matchesHTTPStatus("200-299", 500) {
		t.Fatal("status matching returned an unexpected result")
	}
}

func TestProbeHTTPService(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer server.Close()
	service := model.Service{URL: server.URL, Method: "GET", TimeoutSec: 2, ExpectedStatus: "200-299", Keyword: `"ok"`, MaxLatencyMS: 5000, FollowRedirects: true}
	result := probeHTTPService(context.Background(), service)
	if !result.Success || result.Status != "up" || result.HTTPStatus != 200 {
		t.Fatalf("unexpected successful probe result: %#v", result)
	}
	service.Keyword = "missing"
	result = probeHTTPService(context.Background(), service)
	if result.Success || result.Error == "" {
		t.Fatalf("expected keyword failure, got %#v", result)
	}
}
