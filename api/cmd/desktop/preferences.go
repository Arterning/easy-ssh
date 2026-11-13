package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

// Web storage is scoped to a port. Persist UI preferences separately so a
// randomly assigned port does not discard themes and SQL drafts on restart.
func preferencesHandler(dataDir string) http.Handler {
	var mu sync.Mutex
	path := filepath.Join(dataDir, "desktop-preferences.json")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		values := map[string]string{}
		data, err := os.ReadFile(path)
		if err == nil {
			err = json.Unmarshal(data, &values)
		}
		if err != nil && !os.IsNotExist(err) {
			http.Error(w, "cannot read preferences", 500)
			return
		}
		switch r.Method {
		case http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(values)
		case http.MethodPut:
			var input struct {
				Key   string `json:"key"`
				Value string `json:"value"`
			}
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20)).Decode(&input) != nil || input.Key == "" {
				http.Error(w, "invalid preferences", 400)
				return
			}
			values[input.Key] = input.Value
			data, err = json.Marshal(values)
			if err == nil {
				err = os.WriteFile(path+".tmp", data, 0600)
			}
			if err == nil {
				err = os.Rename(path+".tmp", path)
			}
			if err != nil {
				http.Error(w, "cannot save preferences", 500)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})
}
