package httpapi

import "testing"

func TestCleanRemotePath(t *testing.T) {
	tests := map[string]string{
		"":                ".",
		"/var/www/../log": "/var/log",
		"/":               "/",
		"relative/files":  "relative/files",
		`/var\log`:        "/var/log",
	}
	for input, expected := range tests {
		if got := cleanRemotePath(input); got != expected {
			t.Errorf("cleanRemotePath(%q) = %q, want %q", input, got, expected)
		}
	}
}

func TestValidUploadName(t *testing.T) {
	for _, valid := range []string{"report.txt", "配置.yaml", ".env"} {
		if !validUploadName(valid) {
			t.Errorf("expected %q to be valid", valid)
		}
	}
	for _, invalid := range []string{"", ".", "..", "a/b", `a\b`, "bad\nname"} {
		if validUploadName(invalid) {
			t.Errorf("expected %q to be invalid", invalid)
		}
	}
}
