package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	analysisStatusPending = "pending"
	analysisStatusWorking = "working"
	analysisStatusOK      = "ok"
	analysisStatusFailed  = "failed"
)

type analysisRequest struct {
	JobID      string            `json:"job_id"`
	CSVPath    string            `json:"csv_path"`
	Force      bool              `json:"force"`
	ModelRepos map[string]string `json:"model_repos,omitempty"`
}

type analysisStatusSnapshot struct {
	JobID     string `json:"job_id"`
	Status    string `json:"status"`
	UpdatedAt string `json:"updated_at,omitempty"`
	Error     string `json:"error,omitempty"`
}

type analysisResponse struct {
	Status analysisStatusSnapshot `json:"status"`
	Result map[string]any         `json:"result,omitempty"`
}

type analysisRunner interface {
	analyzeCSV(context.Context, analysisRequest) (map[string]any, error)
}

type analysisStore struct {
	dataFolder string
}

func newAnalysisStore(dataFolder string) *analysisStore {
	return &analysisStore{dataFolder: dataFolder}
}

func (s *analysisStore) Status(jobID string) (analysisStatusSnapshot, error) {
	path, err := s.statusPath(jobID)
	if err != nil {
		return analysisStatusSnapshot{}, err
	}

	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return analysisStatusSnapshot{JobID: jobID, Status: analysisStatusPending}, nil
	}
	if err != nil {
		return analysisStatusSnapshot{}, err
	}

	var status analysisStatusSnapshot
	if err := json.Unmarshal(raw, &status); err != nil {
		return analysisStatusSnapshot{}, err
	}
	if status.JobID == "" {
		status.JobID = jobID
	}
	if status.Status == "" {
		status.Status = analysisStatusPending
	}
	return status, nil
}

func (s *analysisStore) Result(jobID string) (map[string]any, error) {
	path, err := s.resultPath(jobID)
	if err != nil {
		return nil, err
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func (s *analysisStore) MarkWorking(jobID string) error {
	return s.writeStatus(analysisStatusSnapshot{
		JobID:     jobID,
		Status:    analysisStatusWorking,
		UpdatedAt: nowRFC3339(),
	})
}

func (s *analysisStore) SaveSuccess(jobID string, payload map[string]any) error {
	resultPath, err := s.resultPath(jobID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(resultPath), os.ModePerm); err != nil {
		return err
	}

	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(resultPath, raw, 0o600); err != nil {
		return err
	}

	return s.writeStatus(analysisStatusSnapshot{
		JobID:     jobID,
		Status:    analysisStatusOK,
		UpdatedAt: nowRFC3339(),
	})
}

func (s *analysisStore) SaveFailure(jobID string, cause error) error {
	message := ""
	if cause != nil {
		message = cause.Error()
	}
	return s.writeStatus(analysisStatusSnapshot{
		JobID:     jobID,
		Status:    analysisStatusFailed,
		UpdatedAt: nowRFC3339(),
		Error:     message,
	})
}

func (s *analysisStore) Delete(jobID string) error {
	statusPath, err := s.statusPath(jobID)
	if err != nil {
		return err
	}
	resultPath, err := s.resultPath(jobID)
	if err != nil {
		return err
	}

	for _, path := range []string{statusPath, resultPath} {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func (s *analysisStore) writeStatus(status analysisStatusSnapshot) error {
	path, err := s.statusPath(status.JobID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), os.ModePerm); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(status, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func (s *analysisStore) statusPath(jobID string) (string, error) {
	if err := validateSidecarJobID(jobID); err != nil {
		return "", err
	}
	return filepath.Join(s.dataFolder, jobID+".analysis.status.json"), nil
}

func (s *analysisStore) resultPath(jobID string) (string, error) {
	if err := validateSidecarJobID(jobID); err != nil {
		return "", err
	}
	return filepath.Join(s.dataFolder, jobID+".analysis.json"), nil
}

func validateSidecarJobID(jobID string) error {
	if strings.TrimSpace(jobID) == "" || strings.Contains(jobID, "/") || strings.Contains(jobID, "\\") || strings.Contains(jobID, "..") {
		return errors.New("invalid job id")
	}
	return nil
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}
