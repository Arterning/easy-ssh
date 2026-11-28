package httpapi

import (
	"bytes"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxDebugBody = 2 << 20
const maxDebugResponse = 8 << 20

type debugRequest struct {
	Method     string            `json:"method"`
	URL        string            `json:"url"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
	TimeoutSec int               `json:"timeoutSec"`
}

func (a *API) sendDebugRequest(w http.ResponseWriter, r *http.Request) {
	var input debugRequest
	if !decode(w, r, &input) {
		return
	}
	input.Method = strings.ToUpper(strings.TrimSpace(input.Method))
	if input.Method == "" {
		input.Method = http.MethodGet
	}
	if !validDebugMethod(input.Method) {
		failMessage(w, http.StatusBadRequest, "unsupported HTTP method")
		return
	}
	target, err := url.ParseRequestURI(strings.TrimSpace(input.URL))
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" || target.User != nil {
		failMessage(w, http.StatusBadRequest, "enter a valid HTTP or HTTPS URL without embedded credentials")
		return
	}
	if len(input.Body) > maxDebugBody {
		failMessage(w, http.StatusRequestEntityTooLarge, "request body exceeds 2 MiB")
		return
	}
	timeout := input.TimeoutSec
	if timeout < 1 || timeout > 120 {
		timeout = 30
	}
	request, err := http.NewRequestWithContext(r.Context(), input.Method, target.String(), bytes.NewBufferString(input.Body))
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	for name, value := range input.Headers {
		name = strings.TrimSpace(name)
		if name == "" || strings.ContainsAny(name, "\r\n:") || strings.ContainsAny(value, "\r\n") {
			failMessage(w, http.StatusBadRequest, "invalid request header")
			return
		}
		lower := strings.ToLower(name)
		if lower == "host" || lower == "content-length" || lower == "connection" || lower == "transfer-encoding" || strings.HasPrefix(lower, "proxy-") {
			continue
		}
		request.Header.Set(name, value)
	}
	client := &http.Client{
		Timeout:       time.Duration(timeout) * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
	started := time.Now()
	response, err := client.Do(request)
	if err != nil {
		failMessage(w, http.StatusBadGateway, err.Error())
		return
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxDebugResponse+1))
	if err != nil {
		failMessage(w, http.StatusBadGateway, "failed to read response body: "+err.Error())
		return
	}
	truncated := len(body) > maxDebugResponse
	if truncated {
		body = body[:maxDebugResponse]
	}
	headers := make(map[string]string, len(response.Header))
	for name, values := range response.Header {
		headers[name] = strings.Join(values, ", ")
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": response.StatusCode, "statusText": http.StatusText(response.StatusCode),
		"headers": headers, "body": string(body), "size": len(body), "truncated": truncated,
		"durationMs": time.Since(started).Milliseconds(),
	})
}

func validDebugMethod(method string) bool {
	switch method {
	case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodHead, http.MethodOptions:
		return true
	default:
		return false
	}
}
