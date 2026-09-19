package model

import "time"

type DatabaseQuery struct {
	ID                   uint      `gorm:"primaryKey" json:"id"`
	DatabaseConnectionID uint      `gorm:"not null;index" json:"databaseConnectionId"`
	Name                 string    `gorm:"size:160;not null" json:"name"`
	SQL                  string    `gorm:"type:text;not null" json:"sql"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}
