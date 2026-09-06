package model

import "time"

type TerminalSession struct {
	ID          uint   `gorm:"primaryKey"`
	HostID      uint   `gorm:"index;not null"`
	HostAddress string `gorm:"size:255;not null"`
	Username    string `gorm:"size:120;not null"`
	StartedAt   time.Time
	EndedAt     *time.Time
	Duration    int64
	Status      string `gorm:"size:20;not null"`
}
