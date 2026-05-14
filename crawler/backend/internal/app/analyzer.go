package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type reviewAnalyzer struct {
	cfg *Config
}

func newReviewAnalyzer(cfg *Config) *reviewAnalyzer {
	return &reviewAnalyzer{cfg: cfg}
}

func (a *reviewAnalyzer) analyzeCSV(ctx context.Context, csvPath string) (map[string]any, error) {
	repoID := strings.TrimSpace(a.cfg.ABSARepoID)
	if repoID == "" {
		return nil, fmt.Errorf("chưa cấu hình Hugging Face repo ABSA, hãy chạy backend với -absa-repo-id")
	}

	projectRoot, err := resolveProjectRoot()
	if err != nil {
		return nil, err
	}

	args := []string{
		"-m", "review_absa_pipeline.run_from_csv",
		"--input-csv", csvPath,
		"--model-repo-id", repoID,
	}
	if teencodePath := strings.TrimSpace(a.cfg.ABSATeencodePath); teencodePath != "" {
		args = append(args, "--teencode-path", teencodePath)
	}

	pythonBin := resolvePythonBin(projectRoot, a.cfg.PythonBin)

	cmd := exec.CommandContext(ctx, pythonBin, args...)
	cmd.Dir = projectRoot

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("không chạy được ABSA pipeline: %w: %s", err, strings.TrimSpace(stderr.String()))
	}

	var payload map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &payload); err != nil {
		return nil, fmt.Errorf("output ABSA không hợp lệ: %w", err)
	}

	return payload, nil
}

func resolvePythonBin(projectRoot, configured string) string {
	pythonBin := strings.TrimSpace(configured)
	if pythonBin != "" && pythonBin != "python" {
		return pythonBin
	}

	candidates := []string{
		filepath.Join(projectRoot, ".venv", "Scripts", "python.exe"),
		filepath.Join(projectRoot, ".venv", "bin", "python"),
	}
	for _, candidate := range candidates {
		if st, err := os.Stat(candidate); err == nil && !st.IsDir() {
			return candidate
		}
	}

	if pythonBin == "" {
		return "python"
	}
	return pythonBin
}

func resolveProjectRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	cur := wd
	for i := 0; i < 8; i++ {
		if cur == "" || cur == filepath.Dir(cur) {
			break
		}
		target := filepath.Join(cur, "review_absa_pipeline")
		if st, statErr := os.Stat(target); statErr == nil && st.IsDir() {
			return cur, nil
		}
		cur = filepath.Dir(cur)
	}

	return "", fmt.Errorf("không tìm thấy thư mục review_absa_pipeline từ cwd")
}
