package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type narrativeRequest struct {
	AnalysisResult map[string]any `json:"analysis_result"`
	UseOllama      bool           `json:"use_ollama"`
}

type narrativeRunner interface {
	generateNarrative(context.Context, map[string]any, bool) (map[string]any, error)
}

func (a *reviewAnalyzer) generateNarrative(ctx context.Context, analysisResult map[string]any, useOllama bool) (map[string]any, error) {
	serviceURL := strings.TrimRight(strings.TrimSpace(a.cfg.ABSAServiceURL), "/")
	if serviceURL == "" {
		return nil, fmt.Errorf("chưa cấu hình ABSA service URL")
	}
	parsed, err := url.Parse(serviceURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("ABSA service URL không hợp lệ")
	}

	body, err := json.Marshal(narrativeRequest{AnalysisResult: analysisResult, UseOllama: useOllama})
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceURL+"/v1/narrative", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("không gọi được ABSA narrative service: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("ABSA narrative service trả lỗi %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("output narrative không hợp lệ: %w", err)
	}
	return payload, nil
}
