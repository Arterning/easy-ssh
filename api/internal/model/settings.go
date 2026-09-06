package model

import "time"

type AISettings struct {
	ID              uint   `gorm:"primaryKey"`
	Provider        string `gorm:"size:100;not null"`
	BaseURL         string `gorm:"size:500;not null"`
	APIKeyEncrypted string `gorm:"type:text"`
	Model           string `gorm:"size:200;not null"`
	UpdatedAt       time.Time
}

type AgentTask struct {
	ID           uint   `gorm:"primaryKey"`
	HostID       uint   `gorm:"index;not null"`
	Question     string `gorm:"type:text;not null"`
	Summary      string `gorm:"type:text"`
	CommandsJSON string `gorm:"type:text;not null"`
	Status       string `gorm:"size:30;not null"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
