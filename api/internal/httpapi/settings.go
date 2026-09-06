package httpapi

import (
	"easyssh/api/internal/model"
	"gorm.io/gorm"
	"net/http"
	"strings"
)

type settingsInput struct {
	Provider string `json:"provider"`
	BaseURL  string `json:"baseUrl"`
	APIKey   string `json:"apiKey"`
	Model    string `json:"model"`
}
type settingsView struct {
	Provider  string `json:"provider"`
	BaseURL   string `json:"baseUrl"`
	Model     string `json:"model"`
	HasAPIKey bool   `json:"hasApiKey"`
}

func (a *API) getSettings(w http.ResponseWriter, _ *http.Request) {
	var s model.AISettings
	err := a.db.First(&s).Error
	if err == gorm.ErrRecordNotFound {
		writeJSON(w, 200, settingsView{Provider: "OpenAI", BaseURL: "https://api.openai.com/v1"})
		return
	}
	if err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, 200, settingsView{s.Provider, s.BaseURL, s.Model, s.APIKeyEncrypted != ""})
}
func (a *API) saveSettings(w http.ResponseWriter, r *http.Request) {
	var in settingsInput
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.BaseURL) == "" || strings.TrimSpace(in.Model) == "" {
		failMessage(w, 400, "baseUrl and model are required")
		return
	}
	var s model.AISettings
	a.db.First(&s)
	s.Provider = strings.TrimSpace(in.Provider)
	s.BaseURL = strings.TrimRight(strings.TrimSpace(in.BaseURL), "/")
	s.Model = strings.TrimSpace(in.Model)
	if in.APIKey != "" {
		encrypted, err := a.vault.Encrypt(in.APIKey)
		if err != nil {
			fail(w, 500, err)
			return
		}
		s.APIKeyEncrypted = encrypted
	}
	if err := a.db.Save(&s).Error; err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, 200, settingsView{s.Provider, s.BaseURL, s.Model, s.APIKeyEncrypted != ""})
}
