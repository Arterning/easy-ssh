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

// AssistantConversation stores the OpenAI-compatible message transcript. Tool
// messages contain host metadata and command output only; credentials are never
// serialized into this field.
type AssistantConversation struct {
	ID           uint   `gorm:"primaryKey"`
	Title        string `gorm:"size:200;not null"`
	MessagesJSON string `gorm:"type:text;not null"`
	Status       string `gorm:"size:30;not null;default:ready"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type AssistantApproval struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	ConversationID uint      `gorm:"index;not null" json:"conversationId"`
	ToolCallID     string    `gorm:"size:200;not null" json:"toolCallId"`
	HostID         uint      `gorm:"index;not null" json:"hostId"`
	Command        string    `gorm:"type:text;not null" json:"command"`
	TimeoutSec     int       `gorm:"not null" json:"timeoutSec"`
	RiskReason     string    `gorm:"type:text;not null" json:"riskReason"`
	Status         string    `gorm:"size:30;not null" json:"status"`
	ResultJSON     string    `gorm:"type:text" json:"-"`
	ExpiresAt      time.Time `json:"expiresAt"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}
