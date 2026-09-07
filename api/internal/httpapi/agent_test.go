package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChangeCommandClassification(t *testing.T) {
	tests := []struct {
		command string
		change  bool
	}{
		{"df -h && free -m", false},
		{"journalctl -u nginx -n 100", false},
		{"systemctl status nginx", false},
		{"systemctl restart nginx", true},
		{"sed -i 's/a/b/' /etc/app.conf", true},
		{"cat source > /tmp/result", true},
		{"echo ok; rm -f /tmp/a", true},
	}
	for _, test := range tests {
		if got := changePattern.MatchString(test.command); got != test.change {
			t.Errorf("classification for %q = %v, want %v", test.command, got, test.change)
		}
	}
}

func TestTerminalOriginAllowed(t *testing.T) {
	tests := []struct {
		origin string
		host   string
		want   bool
	}{
		{"http://localhost:8080", "localhost:8080", true},
		{"http://127.0.0.1:8080", "127.0.0.1:8080", true},
		{"http://localhost:5173", "localhost:8080", true},
		{"https://untrusted.example", "localhost:8080", false},
		{"not a url", "localhost:8080", false},
	}
	for _, test := range tests {
		req := httptest.NewRequest("GET", "http://"+test.host+"/api/v1/hosts", nil)
		req.Host = test.host
		req.Header.Set("Origin", test.origin)
		if got := terminalOriginAllowed(req); got != test.want {
			t.Errorf("terminalOriginAllowed(origin=%q, host=%q) = %v, want %v", test.origin, test.host, got, test.want)
		}
	}
}

func TestLimitOutput(t *testing.T) {
	short := "hello"
	if got := limitOutput(short); got != short {
		t.Fatalf("short output changed: %q", got)
	}
	long := strings.Repeat("a", 130*1024)
	got := limitOutput(long)
	if len(got) >= len(long) || !strings.Contains(got, "输出已截断") {
		t.Fatal("large output was not truncated")
	}
}
