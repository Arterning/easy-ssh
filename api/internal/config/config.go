package config

import "os"

type Config struct{ Address, DatabaseDriver, DatabaseDSN, DataDir string }

func Load() Config {
	driver := env("EASYSSH_DATABASE_DRIVER", "sqlite")
	dsn := "data/easyssh.db"
	if driver == "postgres" {
		dsn = "host=localhost user=easyssh password=easyssh dbname=easyssh port=5432 sslmode=disable"
	}
	if driver == "mysql" {
		dsn = "easyssh:easyssh@tcp(127.0.0.1:3306)/easyssh?charset=utf8mb4&parseTime=True&loc=Local"
	}
	return Config{env("EASYSSH_ADDRESS", ":8080"), driver, env("EASYSSH_DATABASE_DSN", dsn), env("EASYSSH_DATA_DIR", "data")}
}
func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
