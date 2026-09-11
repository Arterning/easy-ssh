package httpapi

import (
	"context"
	"testing"

	"easyssh/api/internal/model"
	glebarezsqlite "github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestDatabaseSQLClassification(t *testing.T) {
	for _, statement := range []string{"SELECT 1", "-- comment\nWITH values_cte AS (SELECT 1) SELECT * FROM values_cte", "PRAGMA table_info(users)", "INSERT INTO users(name) VALUES ('a') RETURNING id"} {
		if !returnsRows(statement) {
			t.Errorf("expected row-returning SQL: %s", statement)
		}
	}
	if returnsRows("UPDATE users SET name='a' WHERE id=1") {
		t.Fatal("UPDATE without RETURNING must not be classified as rows")
	}
	for _, statement := range []string{"DROP TABLE users", "TRUNCATE users", "UPDATE users SET enabled=0", "SELECT 1; DELETE FROM users"} {
		if dangerousSQLWarning(statement) == "" {
			t.Errorf("expected dangerous SQL warning: %s", statement)
		}
	}
	if dangerousSQLWarning("DELETE FROM users WHERE id=1") != "" {
		t.Fatal("scoped DELETE should not require dangerous SQL confirmation")
	}
}

func TestSQLiteSchemaAndExecution(t *testing.T) {
	gormDB, err := gorm.Open(glebarezsqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	db, err := gormDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	ctx := context.Background()
	if _, err = db.ExecContext(ctx, `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO users(name) VALUES ('Alice'), ('Bob')`); err != nil {
		t.Fatal(err)
	}
	schema, err := inspectDatabaseSchema(ctx, db, model.DatabaseConnection{Type: "sqlite"})
	if err != nil {
		t.Fatal(err)
	}
	if len(schema.Schemas) != 1 || len(schema.Schemas[0].Tables) != 1 || len(schema.Schemas[0].Tables[0].Columns) != 2 {
		t.Fatalf("unexpected schema: %#v", schema)
	}
	result, err := runDatabaseSQL(ctx, db, "SELECT id, name FROM users ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != "rows" || len(result.Rows) != 2 || len(result.Columns) != 2 {
		t.Fatalf("unexpected result: %#v", result)
	}
}
