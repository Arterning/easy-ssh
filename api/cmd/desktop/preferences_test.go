package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPreferencesSurviveRestart(t *testing.T) {
	dir := t.TempDir()
	handler := preferencesHandler(dir)
	for _, body := range []string{`{"key":"theme","value":"dark"}`, `{"key":"easyssh.database.1.tabs","value":"SELECT 42"}`} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPut, "/desktop/preferences", strings.NewReader(body)))
		if response.Code != http.StatusNoContent {
			t.Fatalf("save: %d %s", response.Code, response.Body.String())
		}
	}
	response := httptest.NewRecorder()
	preferencesHandler(dir).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/desktop/preferences", nil))
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"theme":"dark"`) || !strings.Contains(response.Body.String(), "SELECT 42") {
		t.Fatalf("restored preferences: %d %s", response.Code, response.Body.String())
	}
}
