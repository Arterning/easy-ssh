package httpapi

import (
	"easyssh/api/internal/model"
	"gorm.io/gorm"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
)

func (a *API) databaseQueries(w http.ResponseWriter, r *http.Request) {
	connection, ok := a.findDatabaseConnection(w, r)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		items := []model.DatabaseQuery{}
		if err := a.db.Where("database_connection_id = ?", connection.ID).Order("updated_at desc, id desc").Find(&items).Error; err != nil {
			fail(w, 500, err)
			return
		}
		writeJSON(w, 200, items)
		return
	}
	item := model.DatabaseQuery{DatabaseConnectionID: connection.ID}
	if r.Method != http.MethodPost {
		id, err := strconv.ParseUint(r.PathValue("queryId"), 10, 64)
		if err != nil || id == 0 {
			failMessage(w, 400, "invalid query id")
			return
		}
		if err = a.db.Where("database_connection_id = ?", connection.ID).First(&item, uint(id)).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				failMessage(w, 404, "query not found")
			} else {
				fail(w, 500, err)
			}
			return
		}
	}
	if r.Method == http.MethodDelete {
		if err := a.db.Delete(&item).Error; err != nil {
			fail(w, 500, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	var in struct {
		Name string `json:"name"`
		SQL  string `json:"sql"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || utf8.RuneCountInString(in.Name) > 160 {
		failMessage(w, 400, "查询名称须为 1–160 个字符")
		return
	}
	if strings.TrimSpace(in.SQL) == "" || len(in.SQL) > 1<<20 {
		failMessage(w, 400, "SQL 不能为空且不能超过 1 MB")
		return
	}
	item.Name, item.SQL = in.Name, in.SQL
	if err := a.db.Save(&item).Error; err != nil {
		fail(w, 500, err)
		return
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		status = http.StatusCreated
	}
	writeJSON(w, status, item)
}
