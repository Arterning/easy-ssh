package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"easyssh/api/internal/model"
	gossh "golang.org/x/crypto/ssh"
	"gorm.io/gorm"
)

type assistantFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}
type assistantToolCall struct {
	ID       string            `json:"id"`
	Type     string            `json:"type"`
	Function assistantFunction `json:"function"`
}
type assistantMessage struct {
	Role       string              `json:"role"`
	Content    string              `json:"content,omitempty"`
	ToolCallID string              `json:"tool_call_id,omitempty"`
	ToolCalls  []assistantToolCall `json:"tool_calls,omitempty"`
}
type assistantInput struct {
	Message string `json:"message"`
}
type sshExecArgs struct {
	HostID     uint   `json:"host_id"`
	Command    string `json:"command"`
	TimeoutSec int    `json:"timeout_sec"`
}

var blockedCommandPattern = regexp.MustCompile(`(?i)(curl|wget)[^|;]*(\||;|&&)\s*(sh|bash)\b|\b(eval|nc|ncat|socat)\b|/etc/shadow|\.ssh/(id_rsa|id_ed25519)|rm\s+(-[^ ]*r[^ ]*f|-[^ ]*f[^ ]*r)\s+(/|/\*)\s*$`)
var secretOutputPattern = regexp.MustCompile(`(?i)(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*([^\s]+)`)
var sudoPattern = regexp.MustCompile(`(?i)(^|[;&|]\s*)sudo\b`)

var assistantTools = []map[string]any{
	{"type": "function", "function": map[string]any{"name": "host_list", "description": "List saved SSH hosts. Never returns passwords, private keys, or encrypted credentials.", "parameters": map[string]any{"type": "object", "properties": map[string]any{"page": map[string]any{"type": "integer"}, "page_size": map[string]any{"type": "integer"}}, "additionalProperties": false}}},
	{"type": "function", "function": map[string]any{"name": "host_search", "description": "Search hosts by name, address, group, or tag. Never returns credentials.", "parameters": map[string]any{"type": "object", "properties": map[string]any{"keyword": map[string]any{"type": "string"}, "limit": map[string]any{"type": "integer"}}, "required": []string{"keyword"}, "additionalProperties": false}}},
	{"type": "function", "function": map[string]any{"name": "ssh_exec", "description": "Execute a non-interactive command on a host over SSH. Credentials are resolved only by the backend. Sensitive commands require individual approval. sudo must be non-interactive.", "parameters": map[string]any{"type": "object", "properties": map[string]any{"host_id": map[string]any{"type": "integer"}, "command": map[string]any{"type": "string"}, "timeout_sec": map[string]any{"type": "integer", "description": "Default 30, maximum 120"}}, "required": []string{"host_id", "command"}, "additionalProperties": false}}},
}

var hostAssistantTools = []map[string]any{
	{"type": "function", "function": map[string]any{
		"name": "ssh_exec", "description": "Execute a non-interactive command on the current workspace host over SSH. Credentials and host selection are resolved only by the backend. Sensitive commands require individual approval. sudo must be non-interactive.",
		"parameters": map[string]any{"type": "object", "properties": map[string]any{"command": map[string]any{"type": "string"}, "timeout_sec": map[string]any{"type": "integer", "description": "Default 30, maximum 120"}}, "required": []string{"command"}, "additionalProperties": false},
	}},
}

func (a *API) listAssistantConversations(w http.ResponseWriter, _ *http.Request) {
	var rows []model.AssistantConversation
	if err := a.db.Where("scope_type = ? OR scope_type = ''", "global").Order("updated_at desc").Limit(100).Find(&rows).Error; err != nil {
		fail(w, 500, err)
		return
	}
	result := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		result = append(result, conversationSummary(row))
	}
	writeJSON(w, 200, result)
}

func (a *API) createAssistantConversation(w http.ResponseWriter, _ *http.Request) {
	row := model.AssistantConversation{Title: "New conversation", ScopeType: "global", MessagesJSON: "[]", Status: "ready"}
	if err := a.db.Create(&row).Error; err != nil {
		fail(w, 500, err)
		return
	}
	a.writeConversation(w, row, 201)
}

func (a *API) listHostAssistantConversations(w http.ResponseWriter, r *http.Request) {
	host, ok := a.find(w, r)
	if !ok {
		return
	}
	var rows []model.AssistantConversation
	if err := a.db.Where("scope_type = ? AND host_id = ?", "host", host.ID).Order("updated_at desc").Limit(100).Find(&rows).Error; err != nil {
		fail(w, 500, err)
		return
	}
	result := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		result = append(result, conversationSummary(row))
	}
	writeJSON(w, 200, result)
}

func (a *API) createHostAssistantConversation(w http.ResponseWriter, r *http.Request) {
	host, ok := a.find(w, r)
	if !ok {
		return
	}
	row := model.AssistantConversation{Title: "New conversation", ScopeType: "host", HostID: &host.ID, MessagesJSON: "[]", Status: "ready"}
	if err := a.db.Create(&row).Error; err != nil {
		fail(w, 500, err)
		return
	}
	a.writeConversation(w, row, 201)
}

func (a *API) getAssistantConversation(w http.ResponseWriter, r *http.Request) {
	row, ok := a.findConversation(w, r.PathValue("id"))
	if ok {
		a.writeConversation(w, row, 200)
	}
}

func (a *API) sendAssistantMessage(w http.ResponseWriter, r *http.Request) {
	row, ok := a.findConversation(w, r.PathValue("id"))
	if !ok {
		return
	}
	if row.Status == "waiting_approval" {
		failMessage(w, 409, "Please approve or reject the pending command first")
		return
	}
	var in assistantInput
	if !decode(w, r, &in) || strings.TrimSpace(in.Message) == "" {
		return
	}
	messages := decodeAssistantMessages(row.MessagesJSON)
	value := strings.TrimSpace(in.Message)
	messages = append(messages, assistantMessage{Role: "user", Content: value})
	if row.Title == "New conversation" {
		runes := []rune(value)
		if len(runes) > 40 {
			runes = runes[:40]
		}
		row.Title = string(runes)
	}
	if err := a.runAssistant(r.Context(), &row, messages); err != nil {
		fail(w, 422, err)
		return
	}
	a.writeConversation(w, row, 200)
}

func (a *API) approveAssistantCall(w http.ResponseWriter, r *http.Request) {
	approval, row, ok := a.findApproval(w, r.PathValue("id"))
	if !ok {
		return
	}
	if approval.Status != "pending" || time.Now().After(approval.ExpiresAt) {
		failMessage(w, 409, "Approval is no longer valid")
		return
	}
	result := a.executeSSH(r.Context(), sshExecArgs{HostID: approval.HostID, Command: approval.Command, TimeoutSec: approval.TimeoutSec})
	raw, _ := json.Marshal(result)
	approval.Status, approval.ResultJSON = "approved", string(raw)
	if err := a.db.Save(&approval).Error; err != nil {
		fail(w, 500, err)
		return
	}
	messages := append(decodeAssistantMessages(row.MessagesJSON), assistantMessage{Role: "tool", ToolCallID: approval.ToolCallID, Content: string(raw)})
	row.Status = "ready"
	if err := a.runAssistant(r.Context(), &row, messages); err != nil {
		fail(w, 422, err)
		return
	}
	a.writeConversation(w, row, 200)
}

func (a *API) rejectAssistantCall(w http.ResponseWriter, r *http.Request) {
	approval, row, ok := a.findApproval(w, r.PathValue("id"))
	if !ok {
		return
	}
	if approval.Status != "pending" {
		failMessage(w, 409, "Approval is no longer pending")
		return
	}
	approval.Status = "rejected"
	if err := a.db.Save(&approval).Error; err != nil {
		fail(w, 500, err)
		return
	}
	raw, _ := json.Marshal(map[string]any{"status": "rejected", "host_id": approval.HostID, "message": "The user rejected this command"})
	messages := append(decodeAssistantMessages(row.MessagesJSON), assistantMessage{Role: "tool", ToolCallID: approval.ToolCallID, Content: string(raw)})
	row.Status = "ready"
	if err := a.runAssistant(r.Context(), &row, messages); err != nil {
		fail(w, 422, err)
		return
	}
	a.writeConversation(w, row, 200)
}

func (a *API) runAssistant(ctx context.Context, row *model.AssistantConversation, messages []assistantMessage) error {
	for step := 0; step < 8; step++ {
		message, err := a.requestAssistantCompletion(ctx, *row, messages)
		if err != nil {
			return err
		}
		messages = append(messages, message)
		if len(message.ToolCalls) == 0 {
			row.Status = "ready"
			return a.saveConversation(row, messages)
		}
		for index, call := range message.ToolCalls {
			content, pending := a.executeAssistantTool(ctx, *row, call)
			if pending {
				for _, skipped := range message.ToolCalls[index+1:] {
					body, _ := json.Marshal(map[string]any{"status": "deferred", "message": "A previous command is waiting for approval"})
					messages = append(messages, assistantMessage{Role: "tool", ToolCallID: skipped.ID, Content: string(body)})
				}
				row.Status = "waiting_approval"
				return a.saveConversation(row, messages)
			}
			messages = append(messages, assistantMessage{Role: "tool", ToolCallID: call.ID, Content: content})
		}
	}
	return fmt.Errorf("assistant exceeded the maximum of 8 tool steps")
}

func (a *API) requestAssistantCompletion(ctx context.Context, conversation model.AssistantConversation, messages []assistantMessage) (assistantMessage, error) {
	var settings model.AISettings
	if err := a.db.First(&settings).Error; err != nil {
		return assistantMessage{}, fmt.Errorf("configure the AI model first")
	}
	key, err := a.vault.Decrypt(settings.APIKeyEncrypted)
	if err != nil || key == "" {
		return assistantMessage{}, fmt.Errorf("configure the API key first")
	}
	systemContent := "You are the EasySSH operations assistant. Use host_list or host_search when the target is ambiguous and use only returned host_id values. Prefer minimal read-only diagnostics. Never ask for or expose passwords, private keys, API keys, tokens, or credentials. ssh_exec is non-interactive; use sudo -n for sudo. Clearly summarize results and failures in the user's language."
	tools := assistantTools
	if conversation.ScopeType == "host" {
		if conversation.HostID == nil {
			return assistantMessage{}, fmt.Errorf("host-scoped conversation has no host")
		}
		var host model.Host
		if err := a.db.First(&host, *conversation.HostID).Error; err != nil {
			return assistantMessage{}, fmt.Errorf("workspace host no longer exists")
		}
		systemContent = fmt.Sprintf("You are the EasySSH operations assistant for one fixed workspace host: name=%s, address=%s, username=%s. You can operate only this current host. Diagnose iteratively with ssh_exec and use results to decide the next step. Prefer minimal read-only commands. Never ask for or expose passwords, private keys, API keys, tokens, or credentials. Commands must be non-interactive; use sudo -n for sudo. Clearly summarize results and failures in the user's language.", host.Name, host.Address, host.Username)
		tools = hostAssistantTools
	}
	system := assistantMessage{Role: "system", Content: systemContent}
	payload := map[string]any{"model": settings.Model, "temperature": 0.1, "messages": append([]assistantMessage{system}, messages...), "tools": tools, "tool_choice": "auto"}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(settings.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return assistantMessage{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(req)
	if err != nil {
		return assistantMessage{}, err
	}
	defer resp.Body.Close()
	var result struct {
		Choices []struct {
			Message assistantMessage `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err = json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return assistantMessage{}, err
	}
	if resp.StatusCode >= 300 {
		if result.Error != nil {
			return assistantMessage{}, fmt.Errorf("model request failed: %s", result.Error.Message)
		}
		return assistantMessage{}, fmt.Errorf("model request failed: HTTP %d", resp.StatusCode)
	}
	if len(result.Choices) == 0 {
		return assistantMessage{}, fmt.Errorf("model returned no response")
	}
	return result.Choices[0].Message, nil
}

func (a *API) executeAssistantTool(ctx context.Context, conversation model.AssistantConversation, call assistantToolCall) (string, bool) {
	encode := func(value any) string { raw, _ := json.Marshal(value); return string(raw) }
	if conversation.ScopeType == "host" && call.Function.Name != "ssh_exec" {
		return encode(map[string]any{"error": "this tool is unavailable in a host-scoped workspace"}), false
	}
	switch call.Function.Name {
	case "host_list":
		var args struct {
			Page     int `json:"page"`
			PageSize int `json:"page_size"`
		}
		_ = json.Unmarshal([]byte(call.Function.Arguments), &args)
		if args.Page < 1 {
			args.Page = 1
		}
		if args.PageSize < 1 {
			args.PageSize = 20
		}
		if args.PageSize > 100 {
			args.PageSize = 100
		}
		var hosts []model.Host
		var total int64
		a.db.Model(&model.Host{}).Count(&total)
		if err := a.db.Order("updated_at desc").Offset((args.Page - 1) * args.PageSize).Limit(args.PageSize).Find(&hosts).Error; err != nil {
			return encode(map[string]any{"error": err.Error()}), false
		}
		return encode(map[string]any{"items": safeHosts(hosts), "total": total}), false
	case "host_search":
		var args struct {
			Keyword string `json:"keyword"`
			Limit   int    `json:"limit"`
		}
		if json.Unmarshal([]byte(call.Function.Arguments), &args) != nil || strings.TrimSpace(args.Keyword) == "" {
			return encode(map[string]any{"error": "keyword is required"}), false
		}
		if args.Limit < 1 {
			args.Limit = 20
		}
		if args.Limit > 100 {
			args.Limit = 100
		}
		like := "%" + strings.TrimSpace(args.Keyword) + "%"
		var hosts []model.Host
		err := a.db.Where("name LIKE ? OR address LIKE ? OR group_name LIKE ? OR tags LIKE ?", like, like, like, like).Limit(args.Limit).Find(&hosts).Error
		if err != nil {
			return encode(map[string]any{"error": err.Error()}), false
		}
		return encode(map[string]any{"items": safeHosts(hosts), "total": len(hosts)}), false
	case "ssh_exec":
		var args sshExecArgs
		if json.Unmarshal([]byte(call.Function.Arguments), &args) != nil {
			return encode(map[string]any{"error": "invalid arguments"}), false
		}
		args.Command = strings.TrimSpace(args.Command)
		args.TimeoutSec = normalizeTimeout(args.TimeoutSec)
		if conversation.ScopeType == "host" {
			if conversation.HostID == nil {
				return encode(map[string]any{"error": "workspace host is missing"}), false
			}
			args.HostID = *conversation.HostID
		}
		var host model.Host
		if args.HostID == 0 || a.db.First(&host, args.HostID).Error != nil {
			return encode(map[string]any{"error": "host not found"}), false
		}
		if args.Command == "" || len(args.Command) > 4000 {
			return encode(map[string]any{"error": "command is required and must not exceed 4000 characters"}), false
		}
		if blockedCommandPattern.MatchString(args.Command) {
			return encode(map[string]any{"status": "blocked", "host_id": args.HostID, "message": "Command blocked by security policy"}), false
		}
		if isSensitiveCommand(args.Command) {
			reason := riskReason(args.Command)
			approval := model.AssistantApproval{ConversationID: conversation.ID, ToolCallID: call.ID, HostID: args.HostID, Command: args.Command, TimeoutSec: args.TimeoutSec, RiskReason: reason, Status: "pending", ExpiresAt: time.Now().Add(15 * time.Minute)}
			if err := a.db.Create(&approval).Error; err != nil {
				return encode(map[string]any{"error": err.Error()}), false
			}
			return encode(map[string]any{"status": "approval_required", "approval_id": approval.ID, "host_id": host.ID, "host_name": host.Name, "command": args.Command, "risk_level": "change", "risk_reason": reason, "expires_at": approval.ExpiresAt}), true
		}
		return encode(a.executeSSH(ctx, args)), false
	default:
		return encode(map[string]any{"error": "unknown tool: " + call.Function.Name}), false
	}
}

func safeHosts(hosts []model.Host) []map[string]any {
	result := make([]map[string]any, 0, len(hosts))
	for _, host := range hosts {
		tags := []string{}
		if host.Tags != "" {
			tags = strings.Split(host.Tags, ",")
		}
		result = append(result, map[string]any{"host_id": host.ID, "name": host.Name, "address": host.Address, "port": host.Port, "username": host.Username, "group": host.GroupName, "tags": tags, "status": host.LastStatus})
	}
	return result
}
func normalizeTimeout(value int) int {
	if value <= 0 {
		return 30
	}
	if value > 120 {
		return 120
	}
	return value
}
func isSensitiveCommand(command string) bool {
	return changePattern.MatchString(command) || sudoPattern.MatchString(command)
}
func riskReason(command string) string {
	if sudoPattern.MatchString(command) {
		return "Command uses sudo and will run with elevated privileges"
	}
	return "Command may change the remote system state"
}

func (a *API) executeSSH(ctx context.Context, args sshExecArgs) map[string]any {
	started := time.Now()
	args.TimeoutSec = normalizeTimeout(args.TimeoutSec)
	var host model.Host
	if err := a.db.First(&host, args.HostID).Error; err != nil {
		return map[string]any{"host_id": args.HostID, "status": "failed", "error": "host not found"}
	}
	command := args.Command
	sudoStart := regexp.MustCompile(`(?i)^\s*sudo\s+`)
	sudoNonInteractive := regexp.MustCompile(`(?i)^\s*sudo\s+-n(\s|$)`)
	if sudoStart.MatchString(command) && !sudoNonInteractive.MatchString(command) {
		command = sudoStart.ReplaceAllString(command, "sudo -n ")
	}
	auth, err := a.sshAuth(host)
	if err != nil {
		return sshResult(host, args.Command, started, "failed", -1, "", "SSH credential could not be loaded")
	}
	client, err := gossh.Dial("tcp", net.JoinHostPort(host.Address, strconv.Itoa(host.Port)), &gossh.ClientConfig{User: host.Username, Auth: []gossh.AuthMethod{auth}, HostKeyCallback: gossh.InsecureIgnoreHostKey(), Timeout: 10 * time.Second})
	if err != nil {
		return sshResult(host, args.Command, started, "failed", -1, "", "SSH connection failed")
	}
	defer client.Close()
	session, err := client.NewSession()
	if err != nil {
		return sshResult(host, args.Command, started, "failed", -1, "", "SSH session could not be created")
	}
	defer session.Close()
	done := make(chan struct{})
	var output []byte
	go func() { output, err = session.CombinedOutput(command); close(done) }()
	select {
	case <-done:
		code := 0
		status := "success"
		stderr := ""
		if err != nil {
			status = "failed"
			code = -1
			if exit, ok := err.(*gossh.ExitError); ok {
				code = exit.ExitStatus()
			}
			stderr = "command failed"
		}
		return sshResult(host, args.Command, started, status, code, redactAssistantOutput(limitOutput(string(output))), stderr)
	case <-ctx.Done():
		_ = session.Close()
		return sshResult(host, args.Command, started, "failed", -1, "", "command canceled")
	case <-time.After(time.Duration(args.TimeoutSec) * time.Second):
		_ = session.Close()
		return sshResult(host, args.Command, started, "failed", -1, "", "command timed out")
	}
}

func sshResult(host model.Host, command string, started time.Time, status string, exitCode int, stdout, stderr string) map[string]any {
	return map[string]any{"host_id": host.ID, "host_name": host.Name, "command": command, "status": status, "exit_code": exitCode, "stdout": stdout, "stderr": stderr, "duration_ms": time.Since(started).Milliseconds(), "truncated": len(stdout) >= 128*1024}
}
func redactAssistantOutput(value string) string {
	return secretOutputPattern.ReplaceAllString(value, "$1=[REDACTED]")
}
func (a *API) saveConversation(row *model.AssistantConversation, messages []assistantMessage) error {
	raw, _ := json.Marshal(messages)
	row.MessagesJSON = string(raw)
	return a.db.Save(row).Error
}
func (a *API) findConversation(w http.ResponseWriter, value string) (model.AssistantConversation, bool) {
	id, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		failMessage(w, 400, "invalid conversation id")
		return model.AssistantConversation{}, false
	}
	var row model.AssistantConversation
	if err = a.db.First(&row, uint(id)).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			failMessage(w, 404, "conversation not found")
		} else {
			fail(w, 500, err)
		}
		return row, false
	}
	return row, true
}
func (a *API) findApproval(w http.ResponseWriter, value string) (model.AssistantApproval, model.AssistantConversation, bool) {
	id, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		failMessage(w, 400, "invalid approval id")
		return model.AssistantApproval{}, model.AssistantConversation{}, false
	}
	var approval model.AssistantApproval
	if err = a.db.First(&approval, uint(id)).Error; err != nil {
		failMessage(w, 404, "approval not found")
		return approval, model.AssistantConversation{}, false
	}
	var row model.AssistantConversation
	if err = a.db.First(&row, approval.ConversationID).Error; err != nil {
		failMessage(w, 404, "conversation not found")
		return approval, row, false
	}
	return approval, row, true
}
func decodeAssistantMessages(raw string) []assistantMessage {
	var out []assistantMessage
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}
func (a *API) writeConversation(w http.ResponseWriter, row model.AssistantConversation, status int) {
	var approvals []model.AssistantApproval
	a.db.Where("conversation_id = ?", row.ID).Order("created_at asc").Find(&approvals)
	writeJSON(w, status, map[string]any{"id": row.ID, "title": row.Title, "scopeType": row.ScopeType, "hostId": row.HostID, "status": row.Status, "messages": decodeAssistantMessages(row.MessagesJSON), "approvals": approvals, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt})
}

func conversationSummary(row model.AssistantConversation) map[string]any {
	return map[string]any{"id": row.ID, "title": row.Title, "scopeType": row.ScopeType, "hostId": row.HostID, "status": row.Status, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}
}
