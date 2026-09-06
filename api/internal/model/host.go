package model

import "time"

type Host struct {
	ID                  uint   `gorm:"primaryKey"`
	Name                string `gorm:"size:120;not null"`
	Address             string `gorm:"size:255;not null"`
	Port                int    `gorm:"not null;default:22"`
	Username            string `gorm:"size:120;not null"`
	AuthType            string `gorm:"size:20;not null"`
	PasswordEncrypted   string `gorm:"type:text"`
	PrivateKeyEncrypted string `gorm:"type:text"`
	GroupName           string `gorm:"size:120"`
	Tags                string `gorm:"type:text"`
	Note                string `gorm:"type:text"`
	LastStatus          string `gorm:"size:20;not null;default:unknown"`
	LastConnectedAt     *time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
}
