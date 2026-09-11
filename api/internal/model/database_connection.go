package model

import "time"

type DatabaseConnection struct {
	ID                uint   `gorm:"primaryKey"`
	Name              string `gorm:"size:160;not null"`
	Type              string `gorm:"size:20;not null;index"`
	Address           string `gorm:"size:255"`
	Port              int
	DatabaseName      string `gorm:"size:255"`
	Username          string `gorm:"size:160"`
	PasswordEncrypted string `gorm:"type:text"`
	SQLitePath        string `gorm:"size:2000"`
	SSLMode           string `gorm:"size:30"`
	UseSSHTunnel      bool
	SSHHostID         *uint  `gorm:"index"`
	GroupName         string `gorm:"size:120"`
	Tags              string `gorm:"type:text"`
	Note              string `gorm:"type:text"`
	LastStatus        string `gorm:"size:20;not null;default:unknown"`
	LastError         string `gorm:"type:text"`
	LastTestedAt      *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}
