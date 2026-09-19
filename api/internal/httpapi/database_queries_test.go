package httpapi

import (
	"easyssh/api/internal/model"
	"encoding/json"
	glebarezsqlite "github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSavedDatabaseQueries(t *testing.T) {
	db, err := gorm.Open(glebarezsqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	if err = db.AutoMigrate(&model.DatabaseConnection{}, &model.DatabaseQuery{}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"first", "second"} {
		if err = db.Create(&model.DatabaseConnection{Name: name, Type: "sqlite"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	api := &API{db: db}
	call := func(method, connection, query, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "/", strings.NewReader(body))
		r.SetPathValue("id", connection)
		r.SetPathValue("queryId", query)
		w := httptest.NewRecorder()
		api.databaseQueries(w, r)
		if w.Code != status {
			t.Fatalf("%s: status %d, want %d: %s", method, w.Code, status, w.Body.String())
		}
		return w
	}
	call("POST", "1", "", `{"name":"  orders  ","sql":"SELECT 1"}`, 201)
	w := call("GET", "1", "", "", 200)
	var items []model.DatabaseQuery
	if err = json.Unmarshal(w.Body.Bytes(), &items); err != nil || len(items) != 1 || items[0].Name != "orders" {
		t.Fatalf("unexpected saved queries: %s", w.Body.String())
	}
	if body := call("GET", "2", "", "", 200).Body.String(); strings.TrimSpace(body) != "[]" {
		t.Fatal(body)
	}
	call("PUT", "2", "1", `{"name":"wrong","sql":"SELECT 2"}`, 404)
	call("DELETE", "2", "1", "", 404)
	call("POST", "999", "", `{"name":"missing","sql":"SELECT 1"}`, 404)
	call("POST", "1", "", `{"name":" ","sql":"SELECT 1"}`, 400)
	call("POST", "1", "", `{"name":"empty","sql":" "}`, 400)
	call("PUT", "1", "1", `{"name":"renamed","sql":"SELECT 2"}`, 200)
	w = call("GET", "1", "", "", 200)
	if err = json.Unmarshal(w.Body.Bytes(), &items); err != nil || len(items) != 1 || items[0].SQL != "SELECT 2" || items[0].Name != "renamed" {
		t.Fatal(w.Body.String())
	}
	call("DELETE", "1", "1", "", 204)
	call("PUT", "1", "1", `{"name":"deleted","sql":"SELECT 1"}`, 404)
	call("POST", "1", "", `{"name":"cleanup","sql":"SELECT 1"}`, 201)
	r := httptest.NewRequest("DELETE", "/", nil)
	r.SetPathValue("id", "1")
	w = httptest.NewRecorder()
	api.deleteDatabaseConnection(w, r)
	if w.Code != 204 {
		t.Fatal(w.Body.String())
	}
	var count int64
	db.Model(&model.DatabaseQuery{}).Count(&count)
	if count != 0 {
		t.Fatal("connection deletion left saved queries")
	}
}
