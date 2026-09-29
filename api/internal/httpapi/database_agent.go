package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"easyssh/api/internal/model"
)

type databaseAgentRequest struct {
	Question string `json:"question"`
}

type databaseAgentPlan struct {
	Summary string `json:"summary"`
	SQL     string `json:"sql"`
}

func (a *API) generateDatabaseSQL(w http.ResponseWriter, r *http.Request) {
	item, ok := a.findDatabaseConnection(w, r)
	if !ok {
		return
	}
	var in databaseAgentRequest
	if !decode(w, r, &in) {
		return
	}
	in.Question = strings.TrimSpace(in.Question)
	if in.Question == "" {
		failMessage(w, http.StatusBadRequest, "问题不能为空")
		return
	}
	if len(in.Question) > 8000 {
		failMessage(w, http.StatusBadRequest, "问题不能超过 8000 个字符")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	db, closeFn, err := a.openDatabase(ctx, item)
	if err != nil {
		fail(w, http.StatusUnprocessableEntity, err)
		return
	}
	defer closeFn()
	schema, err := inspectDatabaseSchema(ctx, db, item)
	if err != nil {
		fail(w, http.StatusUnprocessableEntity, err)
		return
	}
	plan, err := a.requestDatabaseSQL(ctx, item, schema, in.Question)
	if err != nil {
		fail(w, http.StatusUnprocessableEntity, err)
		return
	}
	writeJSON(w, http.StatusOK, plan)
}

func (a *API) requestDatabaseSQL(ctx context.Context, item model.DatabaseConnection, schema databaseSchemaView, question string) (databaseAgentPlan, error) {
	var settings model.AISettings
	if err := a.db.First(&settings).Error; err != nil {
		return databaseAgentPlan{}, fmt.Errorf("请先配置 AI 模型")
	}
	key, err := a.vault.Decrypt(settings.APIKeyEncrypted)
	if err != nil || key == "" {
		return databaseAgentPlan{}, fmt.Errorf("请先配置 API Key")
	}
	schemaJSON, _ := json.Marshal(schema)
	if len(schemaJSON) > 200000 {
		return databaseAgentPlan{}, fmt.Errorf("数据库结构过大，请缩小数据库范围后重试")
	}
	prompt := fmt.Sprintf(`你是数据库 SQL 助手。数据库类型是 %s。根据给定结构和用户问题生成一段可直接执行的 SQL。
只返回 JSON，不要 Markdown，格式为 {"summary":"简短说明","sql":"SQL 语句"}。
必须使用当前数据库方言和真实存在的表、字段；不要臆造结构；查询类 SQL 默认限制最多 500 行；只生成完成任务所需的 SQL，不要执行它。
数据库结构：%s
用户问题：%s`, item.Type, schemaJSON, question)
	payload := map[string]any{"model": settings.Model, "temperature": 0.1, "messages": []map[string]string{{"role": "user", "content": prompt}}}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(settings.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return databaseAgentPlan{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	resp, err := (&http.Client{Timeout: 50 * time.Second}).Do(req)
	if err != nil {
		return databaseAgentPlan{}, err
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
		return databaseAgentPlan{}, err
	}
	if resp.StatusCode >= 300 {
		if result.Error != nil {
			return databaseAgentPlan{}, fmt.Errorf("模型请求失败: %s", result.Error.Message)
		}
		return databaseAgentPlan{}, fmt.Errorf("模型请求失败: HTTP %d", resp.StatusCode)
	}
	if len(result.Choices) == 0 {
		return databaseAgentPlan{}, fmt.Errorf("模型没有返回 SQL")
	}
	content := strings.TrimSpace(result.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	var plan databaseAgentPlan
	if err = json.Unmarshal([]byte(strings.TrimSpace(content)), &plan); err != nil {
		return plan, fmt.Errorf("模型返回格式无效: %w", err)
	}
	plan.SQL, plan.Summary = strings.TrimSpace(plan.SQL), strings.TrimSpace(plan.Summary)
	if plan.SQL == "" || len(plan.SQL) > 1<<20 {
		return plan, fmt.Errorf("模型生成了无效 SQL")
	}
	return plan, nil
}
