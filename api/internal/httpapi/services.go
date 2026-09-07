package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"easyssh/api/internal/model"
	"gorm.io/gorm"
)

type serviceInput struct {
	Name            string `json:"name"`
	URL             string `json:"url"`
	Method          string `json:"method"`
	IntervalSec     int    `json:"intervalSec"`
	TimeoutSec      int    `json:"timeoutSec"`
	ExpectedStatus  string `json:"expectedStatus"`
	Keyword         string `json:"keyword"`
	FollowRedirects bool   `json:"followRedirects"`
	MaxLatencyMS    int64  `json:"maxLatencyMs"`
	Enabled         bool   `json:"enabled"`
	Group           string `json:"group"`
	HostID          *uint  `json:"hostId"`
}

type probeResult struct {
	Success    bool
	Status     string
	HTTPStatus int
	LatencyMS  int64
	Error      string
}

func (a *API) StartServiceMonitor(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Second)
		cleanup := time.NewTicker(time.Hour)
		defer ticker.Stop()
		defer cleanup.Stop()
		semaphore := make(chan struct{}, 10)
		for {
			select {
			case <-ctx.Done():
				return
			case <-cleanup.C:
				a.db.Where("checked_at < ?", time.Now().Add(-7*24*time.Hour)).Delete(&model.ServiceCheck{})
			case <-ticker.C:
				var services []model.Service
				now := time.Now()
				if a.db.Where("enabled = ? AND (next_check_at IS NULL OR next_check_at <= ?)", true, now).Limit(100).Find(&services).Error != nil {
					continue
				}
				for i := range services {
					service := services[i]
					select {
					case semaphore <- struct{}{}:
						next := now.Add(time.Duration(service.IntervalSec) * time.Second)
						a.db.Model(&model.Service{}).Where("id = ?", service.ID).Update("next_check_at", next)
						go func() { defer func() { <-semaphore }(); a.performServiceCheck(ctx, service.ID) }()
					default:
					}
				}
			}
		}
	}()
}

func (a *API) listServices(w http.ResponseWriter, _ *http.Request) {
	var rows []model.Service
	if err := a.db.Order("current_status = 'down' desc, name asc").Find(&rows).Error; err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, 200, serviceViews(rows))
}
func (a *API) createService(w http.ResponseWriter, r *http.Request) {
	var in serviceInput
	if !decode(w, r, &in) || !validateServiceInput(w, in) {
		return
	}
	row := serviceFromInput(in)
	now := time.Now().Add(time.Duration(row.IntervalSec) * time.Second)
	row.NextCheckAt = &now
	if err := a.db.Create(&row).Error; err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, 201, serviceView(row))
	go a.performServiceCheck(context.Background(), row.ID)
}
func (a *API) updateService(w http.ResponseWriter, r *http.Request) {
	row, ok := a.findService(w, r)
	if !ok {
		return
	}
	var in serviceInput
	if !decode(w, r, &in) || !validateServiceInput(w, in) {
		return
	}
	updated := serviceFromInput(in)
	updated.ID = row.ID
	updated.CreatedAt = row.CreatedAt
	updated.CurrentStatus = row.CurrentStatus
	updated.LastHTTPStatus = row.LastHTTPStatus
	updated.LastLatencyMS = row.LastLatencyMS
	updated.LastError = row.LastError
	updated.LastCheckedAt = row.LastCheckedAt
	updated.ConsecutiveSuccesses = row.ConsecutiveSuccesses
	updated.ConsecutiveFailures = row.ConsecutiveFailures
	now := time.Now()
	updated.NextCheckAt = &now
	if !updated.Enabled {
		updated.CurrentStatus = "paused"
	}
	if updated.Enabled && row.CurrentStatus == "paused" {
		updated.CurrentStatus = "unknown"
	}
	if err := a.db.Save(&updated).Error; err != nil {
		fail(w, 500, err)
		return
	}
	a.publishService(updated)
	writeJSON(w, 200, serviceView(updated))
}
func (a *API) deleteService(w http.ResponseWriter, r *http.Request) {
	row, ok := a.findService(w, r)
	if !ok {
		return
	}
	err := a.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("service_id = ?", row.ID).Delete(&model.ServiceCheck{}).Error; err != nil {
			return err
		}
		return tx.Delete(&row).Error
	})
	if err != nil {
		fail(w, 500, err)
		return
	}
	a.publishEvent(map[string]any{"type": "deleted", "id": row.ID})
	w.WriteHeader(204)
}
func (a *API) checkServiceNow(w http.ResponseWriter, r *http.Request) {
	row, ok := a.findService(w, r)
	if !ok {
		return
	}
	a.performServiceCheck(r.Context(), row.ID)
	if err := a.db.First(&row, row.ID).Error; err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, 200, serviceView(row))
}
func (a *API) listServiceChecks(w http.ResponseWriter, r *http.Request) {
	row, ok := a.findService(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	var checks []model.ServiceCheck
	if err := a.db.Where("service_id = ?", row.ID).Order("checked_at desc").Limit(limit).Find(&checks).Error; err != nil {
		fail(w, 500, err)
		return
	}
	writeJSON(w, 200, checks)
}

func (a *API) performServiceCheck(ctx context.Context, id uint) {
	var service model.Service
	if a.db.First(&service, id).Error != nil || !service.Enabled {
		return
	}
	result := probeHTTPService(ctx, service)
	now := time.Now()
	service.LastCheckedAt = &now
	service.LastHTTPStatus = result.HTTPStatus
	service.LastLatencyMS = result.LatencyMS
	service.LastError = result.Error
	if result.Success {
		service.ConsecutiveSuccesses++
		service.ConsecutiveFailures = 0
		if service.CurrentStatus == "unknown" || service.CurrentStatus == "checking" || service.ConsecutiveSuccesses >= 2 {
			service.CurrentStatus = result.Status
		}
	} else {
		service.ConsecutiveFailures++
		service.ConsecutiveSuccesses = 0
		if service.CurrentStatus == "unknown" || service.ConsecutiveFailures >= 3 {
			service.CurrentStatus = "down"
		}
	}
	next := now.Add(time.Duration(service.IntervalSec) * time.Second)
	service.NextCheckAt = &next
	if a.db.Save(&service).Error != nil {
		return
	}
	a.db.Create(&model.ServiceCheck{ServiceID: service.ID, Status: result.Status, HTTPStatus: result.HTTPStatus, LatencyMS: result.LatencyMS, Error: result.Error, CheckedAt: now})
	a.publishService(service)
}

func probeHTTPService(ctx context.Context, service model.Service) probeResult {
	started := time.Now()
	ctx, cancel := context.WithTimeout(ctx, time.Duration(service.TimeoutSec)*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, service.Method, service.URL, nil)
	if err != nil {
		return probeFailure(started, "Invalid request URL")
	}
	client := &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if !service.FollowRedirects {
			return http.ErrUseLastResponse
		}
		if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
			return fmt.Errorf("redirect to unsupported protocol")
		}
		if len(via) >= 10 {
			return fmt.Errorf("too many redirects")
		}
		return nil
	}}
	response, err := client.Do(req)
	latency := time.Since(started).Milliseconds()
	if err != nil {
		return probeResult{Status: "down", LatencyMS: latency, Error: safeProbeError(err)}
	}
	defer response.Body.Close()
	if !matchesHTTPStatus(service.ExpectedStatus, response.StatusCode) {
		return probeResult{Status: "down", HTTPStatus: response.StatusCode, LatencyMS: latency, Error: fmt.Sprintf("Unexpected HTTP status %d", response.StatusCode)}
	}
	if service.Keyword != "" {
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		if readErr != nil {
			return probeResult{Status: "down", HTTPStatus: response.StatusCode, LatencyMS: latency, Error: "Could not read response body"}
		}
		if !strings.Contains(string(body), service.Keyword) {
			return probeResult{Status: "down", HTTPStatus: response.StatusCode, LatencyMS: latency, Error: "Expected response keyword was not found"}
		}
	}
	status := "up"
	if service.MaxLatencyMS > 0 && latency > service.MaxLatencyMS {
		status = "degraded"
	}
	return probeResult{Success: true, Status: status, HTTPStatus: response.StatusCode, LatencyMS: latency}
}
func probeFailure(started time.Time, message string) probeResult {
	return probeResult{Status: "down", LatencyMS: time.Since(started).Milliseconds(), Error: message}
}
func safeProbeError(err error) string {
	if err == context.DeadlineExceeded || strings.Contains(strings.ToLower(err.Error()), "deadline exceeded") {
		return "Request timed out"
	}
	return "HTTP request failed"
}

func matchesHTTPStatus(rule string, status int) bool {
	for _, part := range strings.Split(rule, ",") {
		part = strings.TrimSpace(part)
		if strings.Contains(part, "-") {
			bounds := strings.SplitN(part, "-", 2)
			low, e1 := strconv.Atoi(strings.TrimSpace(bounds[0]))
			high, e2 := strconv.Atoi(strings.TrimSpace(bounds[1]))
			if e1 == nil && e2 == nil && status >= low && status <= high {
				return true
			}
		} else if value, err := strconv.Atoi(part); err == nil && status == value {
			return true
		}
	}
	return false
}
func validateServiceInput(w http.ResponseWriter, in serviceInput) bool {
	parsed, err := url.Parse(strings.TrimSpace(in.URL))
	if strings.TrimSpace(in.Name) == "" || err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		failMessage(w, 400, "name and a valid HTTP/HTTPS URL are required")
		return false
	}
	if in.Method != "GET" && in.Method != "HEAD" {
		failMessage(w, 400, "method must be GET or HEAD")
		return false
	}
	if in.Method == "HEAD" && in.Keyword != "" {
		failMessage(w, 400, "response keyword is not supported for HEAD requests")
		return false
	}
	if in.IntervalSec < 10 || in.IntervalSec > 86400 {
		failMessage(w, 400, "intervalSec must be between 10 and 86400")
		return false
	}
	if in.TimeoutSec < 1 || in.TimeoutSec > 60 {
		failMessage(w, 400, "timeoutSec must be between 1 and 60")
		return false
	}
	if in.TimeoutSec >= in.IntervalSec {
		failMessage(w, 400, "timeoutSec must be shorter than intervalSec")
		return false
	}
	if !validStatusRule(in.ExpectedStatus) {
		failMessage(w, 400, "expectedStatus must contain status codes or ranges such as 200-299")
		return false
	}
	return true
}
func validStatusRule(rule string) bool {
	if strings.TrimSpace(rule) == "" {
		return false
	}
	for _, part := range strings.Split(rule, ",") {
		part = strings.TrimSpace(part)
		if strings.Contains(part, "-") {
			bounds := strings.SplitN(part, "-", 2)
			low, e1 := strconv.Atoi(strings.TrimSpace(bounds[0]))
			high, e2 := strconv.Atoi(strings.TrimSpace(bounds[1]))
			if e1 != nil || e2 != nil || low < 100 || high > 599 || low > high {
				return false
			}
		} else {
			value, err := strconv.Atoi(part)
			if err != nil || value < 100 || value > 599 {
				return false
			}
		}
	}
	return true
}
func serviceFromInput(in serviceInput) model.Service {
	return model.Service{Name: strings.TrimSpace(in.Name), URL: strings.TrimSpace(in.URL), Method: in.Method, IntervalSec: in.IntervalSec, TimeoutSec: in.TimeoutSec, ExpectedStatus: strings.TrimSpace(in.ExpectedStatus), Keyword: in.Keyword, FollowRedirects: in.FollowRedirects, MaxLatencyMS: in.MaxLatencyMS, Enabled: in.Enabled, GroupName: strings.TrimSpace(in.Group), HostID: in.HostID, CurrentStatus: "unknown"}
}
func (a *API) findService(w http.ResponseWriter, r *http.Request) (model.Service, bool) {
	id, err := strconv.ParseUint(r.PathValue("id"), 10, 64)
	if err != nil {
		failMessage(w, 400, "invalid service id")
		return model.Service{}, false
	}
	var row model.Service
	if err = a.db.First(&row, uint(id)).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			failMessage(w, 404, "service not found")
		} else {
			fail(w, 500, err)
		}
		return row, false
	}
	return row, true
}

func serviceView(row model.Service) map[string]any {
	return map[string]any{"id": row.ID, "name": row.Name, "url": row.URL, "method": row.Method, "intervalSec": row.IntervalSec, "timeoutSec": row.TimeoutSec, "expectedStatus": row.ExpectedStatus, "keyword": row.Keyword, "followRedirects": row.FollowRedirects, "maxLatencyMs": row.MaxLatencyMS, "enabled": row.Enabled, "group": row.GroupName, "hostId": row.HostID, "status": row.CurrentStatus, "lastHttpStatus": row.LastHTTPStatus, "lastLatencyMs": row.LastLatencyMS, "lastError": row.LastError, "lastCheckedAt": row.LastCheckedAt, "consecutiveSuccesses": row.ConsecutiveSuccesses, "consecutiveFailures": row.ConsecutiveFailures, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}
}
func serviceViews(rows []model.Service) []map[string]any {
	result := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		result = append(result, serviceView(row))
	}
	return result
}
func (a *API) publishService(row model.Service) {
	a.publishEvent(map[string]any{"type": "service", "service": serviceView(row)})
}
func (a *API) publishEvent(value any) {
	raw, _ := json.Marshal(value)
	a.serviceSubscribersMu.Lock()
	defer a.serviceSubscribersMu.Unlock()
	for channel := range a.serviceSubscribers {
		select {
		case channel <- raw:
		default:
		}
	}
}
func (a *API) serviceEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		failMessage(w, 500, "streaming is unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	channel := make(chan []byte, 16)
	a.serviceSubscribersMu.Lock()
	a.serviceSubscribers[channel] = struct{}{}
	a.serviceSubscribersMu.Unlock()
	defer func() {
		a.serviceSubscribersMu.Lock()
		delete(a.serviceSubscribers, channel)
		a.serviceSubscribersMu.Unlock()
	}()
	fmt.Fprint(w, "event: connected\ndata: {}\n\n")
	flusher.Flush()
	keepalive := time.NewTicker(20 * time.Second)
	defer keepalive.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case payload := <-channel:
			fmt.Fprintf(w, "data: %s\n\n", payload)
			flusher.Flush()
		case <-keepalive.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}
