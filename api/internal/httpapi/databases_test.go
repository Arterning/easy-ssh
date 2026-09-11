package httpapi

import (
	"net/http/httptest"
	"testing"
)

func TestValidateDatabaseInput(t *testing.T) {
	tests := []struct {
		name  string
		input databaseInput
		valid bool
	}{
		{"sqlite", databaseInput{Name: "local", Type: "sqlite", SQLitePath: "data/app.db"}, true},
		{"sqlite path required", databaseInput{Name: "local", Type: "sqlite"}, false},
		{"sqlite tunnel rejected", databaseInput{Name: "local", Type: "sqlite", SQLitePath: "app.db", UseSSHTunnel: true}, false},
		{"mysql", databaseInput{Name: "orders", Type: "mysql", Address: "127.0.0.1", Port: 3306, DatabaseName: "orders", Username: "app", SSLMode: "disable"}, true},
		{"postgres tunnel host required", databaseInput{Name: "orders", Type: "postgres", Address: "127.0.0.1", Port: 5432, DatabaseName: "orders", Username: "app", SSLMode: "require", UseSSHTunnel: true}, false},
		{"unsupported", databaseInput{Name: "db", Type: "oracle"}, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			if got := validateDatabaseInput(recorder, test.input); got != test.valid {
				t.Fatalf("validateDatabaseInput() = %v, want %v; response=%s", got, test.valid, recorder.Body.String())
			}
		})
	}
}
