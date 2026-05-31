package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
)

type reviewAnalyzer struct {
	cfg *Config
}

func newReviewAnalyzer(cfg *Config) *reviewAnalyzer {
	return &reviewAnalyzer{cfg: cfg}
}

func (a *reviewAnalyzer) analyzeCSV(ctx context.Context, req analysisRequest) (map[string]any, error) {
	serviceURL := strings.TrimRight(strings.TrimSpace(a.cfg.ABSAServiceURL), "/")
	if serviceURL == "" {
		return nil, fmt.Errorf("chưa cấu hình ABSA service URL")
	}
	parsed, err := url.Parse(serviceURL)
	if err != nil {
		return nil, fmt.Errorf("ABSA service URL không hợp lệ: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("ABSA service URL phải gồm scheme và host")
	}
	if req.ModelRepos == nil {
		req.ModelRepos = a.cfg.ABSAModelRepos()
	}
	if !filepath.IsAbs(req.CSVPath) {
		abs, err := filepath.Abs(req.CSVPath)
		if err == nil {
			req.CSVPath = abs
		}
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceURL+"/v1/analyze-csv", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("không gọi được ABSA service: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("ABSA service trả lỗi %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("output ABSA không hợp lệ: %w", err)
	}

	return payload, nil
}
