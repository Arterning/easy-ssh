package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"easyssh/api/internal/model"
)

type databaseAgentRequest struct {
	Question       string `json:"question"`
	ConversationID uint   `json:"conversationId"`
}

type databaseAgentConversationView struct {
	ID        uint      `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type databaseAgentPlan struct {
	ID            uint      `json:"id"`
	Question      string    `json:"question"`
	Summary       string    `json:"summary"`
	SQL           string    `json:"sql"`
	Status        string    `json:"status"`
	Answer        string    `json:"answer"`
	ResultSummary string    `json:"resultSummary"`
	CreatedAt     time.Time `json:"createdAt"`
}

type databaseAgentExecuteInput struct {
	Confirmed bool `json:"confirmed"`
}
type databaseAgentExecuteResponse struct {
	Exchange databaseAgentPlan `json:"exchange"`
	Result   executeSQLResult  `json:"result"`
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
	conversation, ok := a.findDatabaseAgentConversation(w, item.ID, in.ConversationID)
	if !ok {
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
	exchange := model.DatabaseAgentExchange{DatabaseID: item.ID, ConversationID: conversation.ID, Question: in.Question, Summary: plan.Summary, SQL: plan.SQL, Status: "pending"}
	if err = a.db.Create(&exchange).Error; err != nil {
		fail(w, http.StatusInternalServerError, err)
		return
	}
	updates := map[string]any{"updated_at": time.Now()}
	if conversation.Title == "新会话" {
		updates["title"] = truncateDatabaseAgentTitle(in.Question)
	}
	_ = a.db.Model(&conversation).Updates(updates).Error
	writeJSON(w, http.StatusOK, databaseAgentExchangeView(exchange))
}

func (a *API) listDatabaseAgentConversations(w http.ResponseWriter, r *http.Request) {
	item, ok := a.findDatabaseConnection(w, r)
	if !ok {
		return
	}
	if err := a.migrateLegacyDatabaseAgentHistory(item.ID); err != nil {
		fail(w, 500, err)
		return
	}
	var conversations []model.DatabaseAgentConversation
	if err := a.db.Where("database_id = ?", item.ID).Order("updated_at desc").Find(&conversations).Error; err != nil {
		fail(w, 500, err)
		return
	}
	result := make([]databaseAgentConversationView, 0, len(conversations))
	for _, conversation := range conversations {
		result = append(result, databaseAgentConversationView{conversation.ID, conversation.Title, conversation.CreatedAt, conversation.UpdatedAt})
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) createDatabaseAgentConversation(w http.ResponseWriter, r *http.Request) {
	item, ok := a.findDatabaseConnection(w, r)
	if !ok {
		return
	}
	conversation := model.DatabaseAgentConversation{DatabaseID: item.ID, Title: "新会话"}
	if err := a.db.Create(&conversation).Error; err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, http.StatusCreated, databaseAgentConversationView{conversation.ID, conversation.Title, conversation.CreatedAt, conversation.UpdatedAt})
}

func (a *API) listDatabaseAgentHistory(w http.ResponseWriter, r *http.Request) {
	item, ok := a.findDatabaseConnection(w, r)
	if !ok {
		return
	}
	conversationID, err := strconv.ParseUint(r.PathValue("conversationId"), 10, 64)
	if err != nil {
		failMessage(w, 400, "invalid conversation id")
		return
	}
	if _, ok = a.findDatabaseAgentConversation(w, item.ID, uint(conversationID)); !ok {
		return
	}
	var exchanges []model.DatabaseAgentExchange
	if err := a.db.Where("database_id = ? AND conversation_id = ?", item.ID, uint(conversationID)).Order("created_at asc").Limit(200).Find(&exchanges).Error; err != nil {
		fail(w, 500, err)
		return
	}
	result := make([]databaseAgentPlan, 0, len(exchanges))
	for _, exchange := range exchanges {
		result = append(result, databaseAgentExchangeView(exchange))
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) findDatabaseAgentConversation(w http.ResponseWriter, databaseID, conversationID uint) (model.DatabaseAgentConversation, bool) {
	if conversationID == 0 {
		failMessage(w, 400, "conversationId is required")
		return model.DatabaseAgentConversation{}, false
	}
	var conversation model.DatabaseAgentConversation
	if err := a.db.Where("id = ? AND database_id = ?", conversationID, databaseID).First(&conversation).Error; err != nil {
		failMessage(w, 404, "Agent 会话不存在")
		return conversation, false
	}
	return conversation, true
}

func (a *API) migrateLegacyDatabaseAgentHistory(databaseID uint) error {
	var count int64
	if err := a.db.Model(&model.DatabaseAgentExchange{}).Where("database_id = ? AND conversation_id = 0", databaseID).Count(&count).Error; err != nil || count == 0 {
		return err
	}
	conversation := model.DatabaseAgentConversation{DatabaseID: databaseID, Title: "历史会话"}
	if err := a.db.Create(&conversation).Error; err != nil {
		return err
	}
	return a.db.Model(&model.DatabaseAgentExchange{}).Where("database_id = ? AND conversation_id = 0", databaseID).Update("conversation_id", conversation.ID).Error
}

func truncateDatabaseAgentTitle(value string) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > 30 {
		return string(runes[:30]) + "…"
	}
	return value
}

func (a *API) executeDatabaseAgentSQL(w http.ResponseWriter, r *http.Request) {
	item, ok := a.findDatabaseConnection(w, r)
	if !ok {
		return
	}
	var in databaseAgentExecuteInput
	if !decode(w, r, &in) {
		return
	}
	if !in.Confirmed {
		writeJSON(w, http.StatusConflict, map[string]any{"message": "Agent 生成的 SQL 必须经用户确认后才能执行", "requiresConfirmation": true})
		return
	}
	exchangeID, err := strconv.ParseUint(r.PathValue("exchangeId"), 10, 64)
	if err != nil {
		failMessage(w, 400, "invalid exchange id")
		return
	}
	var exchange model.DatabaseAgentExchange
	if err = a.db.Where("id = ? AND database_id = ?", uint(exchangeID), item.ID).First(&exchange).Error; err != nil {
		failMessage(w, 404, "Agent 记录不存在")
		return
	}
	if exchange.Status != "pending" {
		failMessage(w, 409, "该 SQL 已处理，不能重复执行")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	db, closeFn, err := a.openDatabase(ctx, item)
	if err != nil {
		fail(w, 422, err)
		return
	}
	defer closeFn()
	start := time.Now()
	result, err := runDatabaseSQL(ctx, db, exchange.SQL)
	if err != nil {
		exchange.Status, exchange.ResultSummary = "failed", err.Error()
		_ = a.db.Save(&exchange).Error
		fail(w, 422, err)
		return
	}
	result.DurationMS = time.Since(start).Milliseconds()
	exchange.Status = "executed"
	exchange.ResultSummary = result.Message
	answer, answerErr := a.requestDatabaseAnswer(ctx, exchange.Question, exchange.SQL, result)
	if answerErr != nil {
		answer = fmt.Sprintf("SQL 已执行。%s（结果总结失败：%s）", result.Message, answerErr.Error())
	}
	exchange.Answer = answer
	if err = a.db.Save(&exchange).Error; err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, http.StatusOK, databaseAgentExecuteResponse{Exchange: databaseAgentExchangeView(exchange), Result: result})
}

func databaseAgentExchangeView(exchange model.DatabaseAgentExchange) databaseAgentPlan {
	return databaseAgentPlan{ID: exchange.ID, Question: exchange.Question, Summary: exchange.Summary, SQL: exchange.SQL, Status: exchange.Status, Answer: exchange.Answer, ResultSummary: exchange.ResultSummary, CreatedAt: exchange.CreatedAt}
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

func (a *API) requestDatabaseAnswer(ctx context.Context, question, statement string, result executeSQLResult) (string, error) {
	var settings model.AISettings
	if err := a.db.First(&settings).Error; err != nil {
		return "", fmt.Errorf("请先配置 AI 模型")
	}
	key, err := a.vault.Decrypt(settings.APIKeyEncrypted)
	if err != nil || key == "" {
		return "", fmt.Errorf("请先配置 API Key")
	}
	resultJSON, _ := json.Marshal(result)
	if len(resultJSON) > 120000 {
		resultJSON = resultJSON[:120000]
	}
	prompt := fmt.Sprintf("你是数据库分析助手。请根据用户问题、已执行 SQL 和实际结果，直接用中文回答用户的问题。突出结论和关键数字，不要只是复述 SQL；如果结果不足以回答，要明确说明。\n用户问题：%s\nSQL：%s\n执行结果：%s", question, statement, resultJSON)
	payload := map[string]any{"model": settings.Model, "temperature": 0.1, "messages": []map[string]string{{"role": "user", "content": prompt}}}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(settings.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)
	resp, err := (&http.Client{Timeout: 50 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var response struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err = json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return "", err
	}
	if resp.StatusCode >= 300 {
		if response.Error != nil {
			return "", fmt.Errorf("模型请求失败: %s", response.Error.Message)
		}
		return "", fmt.Errorf("模型请求失败: HTTP %d", resp.StatusCode)
	}
	if len(response.Choices) == 0 || strings.TrimSpace(response.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("模型没有返回总结")
	}
	return strings.TrimSpace(response.Choices[0].Message.Content), nil
}
