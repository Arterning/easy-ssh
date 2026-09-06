package httpapi

import (
	"bytes"
	"context"
	"easyssh/api/internal/model"
	"encoding/json"
	"fmt"
	gossh "golang.org/x/crypto/ssh"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type agentCommand struct {
	Command     string `json:"command"`
	Description string `json:"description"`
	Risk        string `json:"risk"`
	Status      string `json:"status"`
	Output      string `json:"output,omitempty"`
	ExitCode    int    `json:"exitCode,omitempty"`
}
type agentPlan struct {
	Summary  string         `json:"summary"`
	Commands []agentCommand `json:"commands"`
}
type agentRequest struct {
	Question string `json:"question"`
}

var changePattern = regexp.MustCompile(`(?i)(^|[;&|]\s*)(rm|mv|cp|sed\s+-i|tee|truncate|chmod|chown|systemctl\s+(start|stop|restart|enable|disable)|service\s+\S+\s+(start|stop|restart)|apt|yum|dnf|apk|reboot|shutdown|kill|pkill|useradd|userdel|passwd|mount|umount|iptables|nft)\b|>|>>`)

func (a *API) createAgentTask(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(r.PathValue("id"), 10, 64)
	if err != nil {
		failMessage(w, 400, "invalid host id")
		return
	}
	var host model.Host
	if err = a.db.First(&host, uint(id)).Error; err != nil {
		failMessage(w, 404, "host not found")
		return
	}
	var in agentRequest
	if !decode(w, r, &in) || strings.TrimSpace(in.Question) == "" {
		return
	}
	plan, err := a.requestPlan(r.Context(), host, in.Question)
	if err != nil {
		fail(w, 422, err)
		return
	}
	for i := range plan.Commands {
		cmd := &plan.Commands[i]
		if changePattern.MatchString(cmd.Command) {
			cmd.Risk = "change"
			cmd.Status = "pending_approval"
		} else {
			cmd.Risk = "readonly"
			cmd.Status = "running"
			output, code := a.runCommand(r.Context(), host, cmd.Command)
			cmd.Output = output
			cmd.ExitCode = code
			if code == 0 {
				cmd.Status = "success"
			} else {
				cmd.Status = "failed"
			}
		}
	}
	raw, _ := json.Marshal(plan.Commands)
	status := "completed"
	for _, cmd := range plan.Commands {
		if cmd.Status == "pending_approval" {
			status = "waiting_approval"
		}
	}
	task := model.AgentTask{HostID: host.ID, Question: in.Question, Summary: plan.Summary, CommandsJSON: string(raw), Status: status}
	if err = a.db.Create(&task).Error; err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, 201, taskResponse(task, plan.Commands))
}
func (a *API) approveAgentTask(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(r.PathValue("id"), 10, 64)
	if err != nil {
		failMessage(w, 400, "invalid task id")
		return
	}
	var task model.AgentTask
	if err = a.db.First(&task, uint(id)).Error; err != nil {
		failMessage(w, 404, "task not found")
		return
	}
	var host model.Host
	if err = a.db.First(&host, task.HostID).Error; err != nil {
		failMessage(w, 404, "host not found")
		return
	}
	var commands []agentCommand
	_ = json.Unmarshal([]byte(task.CommandsJSON), &commands)
	for i := range commands {
		if commands[i].Status == "pending_approval" {
			output, code := a.runCommand(r.Context(), host, commands[i].Command)
			commands[i].Output = output
			commands[i].ExitCode = code
			if code == 0 {
				commands[i].Status = "success"
			} else {
				commands[i].Status = "failed"
			}
		}
	}
	raw, _ := json.Marshal(commands)
	task.CommandsJSON = string(raw)
	task.Status = "completed"
	a.db.Save(&task)
	writeJSON(w, 200, taskResponse(task, commands))
}
func (a *API) requestPlan(ctx context.Context, host model.Host, question string) (agentPlan, error) {
	var settings model.AISettings
	if err := a.db.First(&settings).Error; err != nil {
		return agentPlan{}, fmt.Errorf("请先配置 AI 模型")
	}
	key, err := a.vault.Decrypt(settings.APIKeyEncrypted)
	if err != nil || key == "" {
		return agentPlan{}, fmt.Errorf("请先配置 API Key")
	}
	prompt := fmt.Sprintf("你是 Linux 运维助手。目标主机名称=%s，地址=%s。根据用户任务生成最少且安全的 shell 命令。只返回 JSON，不要 markdown，格式：{\"summary\":\"计划摘要\",\"commands\":[{\"command\":\"命令\",\"description\":\"用途\"}]}。禁止交互命令。用户任务：%s", host.Name, host.Address, question)
	payload := map[string]any{"model": settings.Model, "temperature": 0.1, "messages": []map[string]string{{"role": "user", "content": prompt}}}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(settings.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return agentPlan{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return agentPlan{}, err
	}
	defer resp.Body.Close()
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err = json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return agentPlan{}, err
	}
	if resp.StatusCode >= 300 {
		if result.Error != nil {
			return agentPlan{}, fmt.Errorf("模型请求失败: %s", result.Error.Message)
		}
		return agentPlan{}, fmt.Errorf("模型请求失败: HTTP %d", resp.StatusCode)
	}
	if len(result.Choices) == 0 {
		return agentPlan{}, fmt.Errorf("模型没有返回计划")
	}
	content := strings.TrimSpace(result.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	var plan agentPlan
	if err = json.Unmarshal([]byte(strings.TrimSpace(content)), &plan); err != nil {
		return plan, fmt.Errorf("模型返回的计划格式无效: %w", err)
	}
	if len(plan.Commands) == 0 {
		return plan, fmt.Errorf("模型没有生成命令")
	}
	return plan, nil
}
func (a *API) runCommand(ctx context.Context, host model.Host, command string) (string, int) {
	auth, err := a.sshAuth(host)
	if err != nil {
		return err.Error(), -1
	}
	client, err := gossh.Dial("tcp", netJoin(host.Address, host.Port), &gossh.ClientConfig{User: host.Username, Auth: []gossh.AuthMethod{auth}, HostKeyCallback: gossh.InsecureIgnoreHostKey(), Timeout: 10 * time.Second})
	if err != nil {
		return err.Error(), -1
	}
	defer client.Close()
	session, err := client.NewSession()
	if err != nil {
		return err.Error(), -1
	}
	defer session.Close()
	done := make(chan struct{})
	var output []byte
	go func() { output, err = session.CombinedOutput(command); close(done) }()
	select {
	case <-done:
		if err == nil {
			return string(output), 0
		}
		if exit, ok := err.(*gossh.ExitError); ok {
			return string(output), exit.ExitStatus()
		}
		return string(output) + "\n" + err.Error(), -1
	case <-ctx.Done():
		_ = session.Close()
		return "命令执行被取消", -1
	case <-time.After(30 * time.Second):
		_ = session.Close()
		return "命令执行超时", -1
	}
}
func taskResponse(task model.AgentTask, commands []agentCommand) map[string]any {
	return map[string]any{"id": task.ID, "hostId": task.HostID, "question": task.Question, "summary": task.Summary, "status": task.Status, "commands": commands, "createdAt": task.CreatedAt}
}
func netJoin(address string, port int) string {
	return strings.TrimSpace(address) + ":" + strconv.Itoa(port)
}
