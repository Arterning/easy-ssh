package database

import (
	"easyssh/api/internal/config"
	"fmt"
	glebarezsqlite "github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"os"
	"path/filepath"
)

func Open(cfg config.Config) (*gorm.DB, error) {
	var dialector gorm.Dialector
	switch cfg.DatabaseDriver {
	case "sqlite", "sqlite3":
		if dir := filepath.Dir(cfg.DatabaseDSN); dir != "." {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, err
			}
		}
		dialector = glebarezsqlite.Open(cfg.DatabaseDSN)
	case "postgres", "postgresql":
		dialector = postgres.Open(cfg.DatabaseDSN)
	case "mysql":
		dialector = mysql.Open(cfg.DatabaseDSN)
	default:
		return nil, fmt.Errorf("unsupported database driver %q", cfg.DatabaseDriver)
	}
	return gorm.Open(dialector, &gorm.Config{})
}
