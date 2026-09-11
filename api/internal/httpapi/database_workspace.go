package httpapi

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"easyssh/api/internal/model"
)

const databaseResultLimit = 500

type databaseSchemaView struct {
	Schemas []databaseSchema `json:"schemas"`
}

type databaseSchema struct {
	Name   string          `json:"name"`
	Tables []databaseTable `json:"tables"`
}

type databaseTable struct {
	Name    string           `json:"name"`
	Columns []databaseColumn `json:"columns"`
}

type databaseColumn struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Nullable   bool   `json:"nullable"`
	PrimaryKey bool   `json:"primaryKey"`
}

type executeSQLInput struct {
	SQL       string `json:"sql"`
	Confirmed bool   `json:"confirmed"`
}

type queryColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type executeSQLResult struct {
	Kind         string        `json:"kind"`
	Columns      []queryColumn `json:"columns"`
	Rows         [][]any       `json:"rows"`
	RowsAffected int64         `json:"rowsAffected"`
	DurationMS   int64         `json:"durationMs"`
	Truncated    bool          `json:"truncated"`
	Message      string        `json:"message"`
}

func (a *API) databaseSchema(w http.ResponseWriter, r *http.Request) {
	item, ok := a.findDatabaseConnection(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	db, closeFn, err := a.openDatabase(ctx, item)
	if err != nil {
		fail(w, http.StatusUnprocessableEntity, err)
		return
	}
	defer closeFn()
	if err = db.PingContext(ctx); err != nil {
		fail(w, http.StatusUnprocessableEntity, err)
		return
	}
	result, err := inspectDatabaseSchema(ctx, db, item)
	if err != nil {
		fail(w, http.StatusUnprocessableEntity, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) executeDatabaseSQL(w http.ResponseWriter, r *http.Request) {
	item, ok := a.findDatabaseConnection(w, r)
	if !ok {
		return
	}
	var in executeSQLInput
	if !decode(w, r, &in) {
		return
	}
	in.SQL = strings.TrimSpace(in.SQL)
	if in.SQL == "" {
		failMessage(w, http.StatusBadRequest, "SQL 不能为空")
		return
	}
	if len(in.SQL) > 1<<20 {
		failMessage(w, http.StatusBadRequest, "SQL 不能超过 1 MB")
		return
	}
	if warning := dangerousSQLWarning(in.SQL); warning != "" && !in.Confirmed {
		writeJSON(w, http.StatusConflict, map[string]any{"message": warning, "requiresConfirmation": true})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	db, closeFn, err := a.openDatabase(ctx, item)
	if err != nil {
		fail(w, http.StatusUnprocessableEntity, err)
		return
	}
	defer closeFn()
	start := time.Now()
	result, err := runDatabaseSQL(ctx, db, in.SQL)
	if err != nil {
		fail(w, http.StatusUnprocessableEntity, err)
		return
	}
	result.DurationMS = time.Since(start).Milliseconds()
	writeJSON(w, http.StatusOK, result)
}

func inspectDatabaseSchema(ctx context.Context, db *sql.DB, item model.DatabaseConnection) (databaseSchemaView, error) {
	switch item.Type {
	case "sqlite":
		return inspectSQLiteSchema(ctx, db)
	case "mysql":
		return inspectRelationalSchema(ctx, db, `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`, false)
	case "postgres":
		return inspectRelationalSchema(ctx, db, `SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable, CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN 'PRI' ELSE '' END FROM information_schema.columns c LEFT JOIN information_schema.key_column_usage kcu ON c.table_schema=kcu.table_schema AND c.table_name=kcu.table_name AND c.column_name=kcu.column_name LEFT JOIN information_schema.table_constraints tc ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema AND kcu.table_name=tc.table_name AND tc.constraint_type='PRIMARY KEY' WHERE c.table_schema NOT IN ('pg_catalog','information_schema') ORDER BY c.table_schema,c.table_name,c.ordinal_position`, true)
	default:
		return databaseSchemaView{}, fmt.Errorf("不支持的数据库类型")
	}
}

func inspectSQLiteSchema(ctx context.Context, db *sql.DB) (databaseSchemaView, error) {
	rows, err := db.QueryContext(ctx, `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return databaseSchemaView{}, err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			return databaseSchemaView{}, err
		}
		names = append(names, name)
	}
	if err = rows.Err(); err != nil {
		return databaseSchemaView{}, err
	}
	schema := databaseSchema{Name: "main", Tables: []databaseTable{}}
	for _, name := range names {
		columnRows, queryErr := db.QueryContext(ctx, `PRAGMA table_info("`+strings.ReplaceAll(name, `"`, `""`)+`")`)
		if queryErr != nil {
			return databaseSchemaView{}, queryErr
		}
		table := databaseTable{Name: name, Columns: []databaseColumn{}}
		for columnRows.Next() {
			var cid, notNull, primaryKey int
			var columnName, columnType string
			var defaultValue any
			if err = columnRows.Scan(&cid, &columnName, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
				columnRows.Close()
				return databaseSchemaView{}, err
			}
			table.Columns = append(table.Columns, databaseColumn{Name: columnName, Type: columnType, Nullable: notNull == 0, PrimaryKey: primaryKey > 0})
		}
		columnRows.Close()
		schema.Tables = append(schema.Tables, table)
	}
	return databaseSchemaView{Schemas: []databaseSchema{schema}}, nil
}

func inspectRelationalSchema(ctx context.Context, db *sql.DB, query string, multipleSchemas bool) (databaseSchemaView, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return databaseSchemaView{}, err
	}
	defer rows.Close()
	result := databaseSchemaView{Schemas: []databaseSchema{}}
	for rows.Next() {
		var schemaName, tableName, columnName, columnType, nullable, key string
		if err = rows.Scan(&schemaName, &tableName, &columnName, &columnType, &nullable, &key); err != nil {
			return result, err
		}
		if !multipleSchemas {
			schemaName = "tables"
		}
		si := len(result.Schemas) - 1
		if si < 0 || result.Schemas[si].Name != schemaName {
			result.Schemas = append(result.Schemas, databaseSchema{Name: schemaName, Tables: []databaseTable{}})
			si++
		}
		ti := len(result.Schemas[si].Tables) - 1
		if ti < 0 || result.Schemas[si].Tables[ti].Name != tableName {
			result.Schemas[si].Tables = append(result.Schemas[si].Tables, databaseTable{Name: tableName, Columns: []databaseColumn{}})
			ti++
		}
		result.Schemas[si].Tables[ti].Columns = append(result.Schemas[si].Tables[ti].Columns, databaseColumn{Name: columnName, Type: columnType, Nullable: nullable == "YES", PrimaryKey: key == "PRI"})
	}
	return result, rows.Err()
}

func runDatabaseSQL(ctx context.Context, db *sql.DB, statement string) (executeSQLResult, error) {
	if returnsRows(statement) {
		rows, err := db.QueryContext(ctx, statement)
		if err != nil {
			return executeSQLResult{}, err
		}
		defer rows.Close()
		names, err := rows.Columns()
		if err != nil {
			return executeSQLResult{}, err
		}
		types, _ := rows.ColumnTypes()
		result := executeSQLResult{Kind: "rows", Columns: make([]queryColumn, len(names)), Rows: [][]any{}}
		for i, name := range names {
			result.Columns[i].Name = name
			if i < len(types) {
				result.Columns[i].Type = types[i].DatabaseTypeName()
			}
		}
		for rows.Next() {
			if len(result.Rows) == databaseResultLimit {
				result.Truncated = true
				break
			}
			values := make([]any, len(names))
			targets := make([]any, len(names))
			for i := range values {
				targets[i] = &values[i]
			}
			if err = rows.Scan(targets...); err != nil {
				return result, err
			}
			for i, value := range values {
				values[i] = jsonValue(value)
			}
			result.Rows = append(result.Rows, values)
		}
		if err = rows.Err(); err != nil {
			return result, err
		}
		result.Message = fmt.Sprintf("返回 %d 行", len(result.Rows))
		if result.Truncated {
			result.Message += "（已达到 500 行上限）"
		}
		return result, nil
	}
	execResult, err := db.ExecContext(ctx, statement)
	if err != nil {
		return executeSQLResult{}, err
	}
	affected, _ := execResult.RowsAffected()
	return executeSQLResult{Kind: "command", Columns: []queryColumn{}, Rows: [][]any{}, RowsAffected: affected, Message: fmt.Sprintf("执行成功，影响 %d 行", affected)}, nil
}

func jsonValue(value any) any {
	switch typed := value.(type) {
	case []byte:
		return string(typed)
	case time.Time:
		return typed.Format(time.RFC3339Nano)
	default:
		return value
	}
}

var leadingComments = regexp.MustCompile(`(?s)^\s*(?:(?:--[^\n]*(?:\n|$))|(?:/\*.*?\*/))*\s*`)

func normalizedSQL(statement string) string {
	return strings.ToUpper(leadingComments.ReplaceAllString(statement, ""))
}
func returnsRows(statement string) bool {
	normalized := normalizedSQL(statement)
	for _, prefix := range []string{"SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "PRAGMA", "VALUES"} {
		if strings.HasPrefix(normalized, prefix) {
			return true
		}
	}
	return strings.Contains(normalized, " RETURNING ")
}

func dangerousSQLWarning(statement string) string {
	normalized := normalizedSQL(statement)
	if regexp.MustCompile(`\b(DROP|TRUNCATE)\b`).MatchString(normalized) {
		return "该 SQL 包含 DROP 或 TRUNCATE，将删除数据库对象或数据。确认继续执行吗？"
	}
	if regexp.MustCompile(`\b(UPDATE|DELETE\s+FROM)\b`).MatchString(normalized) && !regexp.MustCompile(`\bWHERE\b`).MatchString(normalized) {
		return "该 SQL 是不含 WHERE 条件的 UPDATE 或 DELETE，可能影响整张表。确认继续执行吗？"
	}
	return ""
}
