package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"crawler/backend/internal/web"
)

type fakeAnalysisRunner struct {
	payload map[string]any
	err     error
	calls   []analysisRequest
}

func (f *fakeAnalysisRunner) analyzeCSV(ctx context.Context, req analysisRequest) (map[string]any, error) {
	f.calls = append(f.calls, req)
	if f.err != nil {
		return nil, f.err
	}
	return f.payload, nil
}

func createReadyJobWithCSV(t *testing.T, server *httpServer, dataDir string) string {
	t.Helper()

	job := web.Job{
		ID:     "123e4567-e89b-12d3-a456-426614174000",
		Name:   "ready job",
		Date:   time.Date(2026, time.May, 31, 1, 2, 3, 0, time.UTC),
		Status: web.StatusOK,
		Data: web.JobData{
			Keywords: []string{"coffee"},
			Lang:     "vi",
			Depth:    1,
			MaxTime:  5 * time.Minute,
		},
	}
	if err := server.svc.Create(context.Background(), &job); err != nil {
		t.Fatalf("failed to create job: %v", err)
	}

	csvPath := filepath.Join(dataDir, web.CsvFileName(job))
	if err := os.WriteFile(csvPath, []byte("title,user_reviews\nCafe,[]\n"), 0o600); err != nil {
		t.Fatalf("failed to write csv: %v", err)
	}
	return job.ID
}

func TestAnalysisStoreStatusAndResultLifecycle(t *testing.T) {
	t.Parallel()

	store := newAnalysisStore(t.TempDir())
	jobID := "job-1"

	status, err := store.Status(jobID)
	if err != nil {
		t.Fatalf("Status() error: %v", err)
	}
	if status.Status != analysisStatusPending {
		t.Fatalf("expected pending status, got %q", status.Status)
	}

	if err := store.MarkWorking(jobID); err != nil {
		t.Fatalf("MarkWorking() error: %v", err)
	}
	status, _ = store.Status(jobID)
	if status.Status != analysisStatusWorking {
		t.Fatalf("expected working status, got %q", status.Status)
	}

	payload := map[string]any{"job_id": jobID, "place_count": float64(1)}
	if err := store.SaveSuccess(jobID, payload); err != nil {
		t.Fatalf("SaveSuccess() error: %v", err)
	}

	status, _ = store.Status(jobID)
	if status.Status != analysisStatusOK || status.Error != "" {
		t.Fatalf("expected ok status without error, got %#v", status)
	}

	result, err := store.Result(jobID)
	if err != nil {
		t.Fatalf("Result() error: %v", err)
	}
	if result["job_id"] != jobID {
		t.Fatalf("expected cached job_id %q, got %#v", jobID, result["job_id"])
	}
}

func TestAnalyzeEndpointSavesResultFromRunner(t *testing.T) {
	t.Parallel()

	server, dataDir := newTestHTTPServer(t)
	jobID := createReadyJobWithCSV(t, server, dataDir)
	fake := &fakeAnalysisRunner{payload: map[string]any{"job_id": jobID, "place_count": float64(1)}}
	server.analyzer = fake

	req := httptest.NewRequest(http.MethodPost, "/api/v1/jobs/"+jobID+"/analyze", nil)
	req.SetPathValue("id", jobID)
	resp := httptest.NewRecorder()
	server.analyzeCSV(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}
	if len(fake.calls) != 1 {
		t.Fatalf("expected one runner call, got %d", len(fake.calls))
	}
	if !fake.calls[0].Force {
		t.Fatalf("manual analyze should force re-analysis")
	}

	status, err := server.analysisStore.Status(jobID)
	if err != nil {
		t.Fatalf("Status() error: %v", err)
	}
	if status.Status != analysisStatusOK {
		t.Fatalf("expected ok status, got %q", status.Status)
	}
}

func TestAnalysisEndpointReadsCachedResultAndStatus(t *testing.T) {
	t.Parallel()

	server, dataDir := newTestHTTPServer(t)
	jobID := createReadyJobWithCSV(t, server, dataDir)
	if err := server.analysisStore.SaveSuccess(jobID, map[string]any{"job_id": jobID, "place_count": float64(2)}); err != nil {
		t.Fatalf("SaveSuccess() error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs/"+jobID+"/analysis", nil)
	req.SetPathValue("id", jobID)
	resp := httptest.NewRecorder()
	server.jobAnalysis(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var out analysisResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &out); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if out.Status.Status != analysisStatusOK {
		t.Fatalf("expected ok status, got %q", out.Status.Status)
	}
	if out.Result["job_id"] != jobID {
		t.Fatalf("expected cached result for job")
	}
}

func TestListJobsIncludesAnalysisStatus(t *testing.T) {
	t.Parallel()

	server, dataDir := newTestHTTPServer(t)
	jobID := createReadyJobWithCSV(t, server, dataDir)
	if err := server.analysisStore.SaveFailure(jobID, errors.New("service down")); err != nil {
		t.Fatalf("SaveFailure() error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs", nil)
	resp := httptest.NewRecorder()
	server.jobs(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	var jobs []jobResponse
	if err := json.Unmarshal(resp.Body.Bytes(), &jobs); err != nil {
		t.Fatalf("failed to decode jobs: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("expected one job, got %d", len(jobs))
	}
	if jobs[0].AnalysisStatus != analysisStatusFailed {
		t.Fatalf("expected failed analysis status, got %q", jobs[0].AnalysisStatus)
	}
	if jobs[0].AnalysisError != "service down" {
		t.Fatalf("expected analysis error, got %q", jobs[0].AnalysisError)
	}
}

func TestDeleteJobRemovesAnalysisSidecars(t *testing.T) {
	t.Parallel()

	server, dataDir := newTestHTTPServer(t)
	jobID := createReadyJobWithCSV(t, server, dataDir)
	if err := server.analysisStore.SaveSuccess(jobID, map[string]any{"job_id": jobID}); err != nil {
		t.Fatalf("SaveSuccess() error: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/jobs/"+jobID, nil)
	req.SetPathValue("id", jobID)
	resp := httptest.NewRecorder()
	server.jobByID(resp, req)

	if resp.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", resp.Code)
	}

	status, err := server.analysisStore.Status(jobID)
	if err != nil {
		t.Fatalf("Status() error: %v", err)
	}
	if status.Status != analysisStatusPending {
		t.Fatalf("expected deleted sidecar to read as pending, got %q", status.Status)
	}
}

func TestAnalysisStoreNarrativeLifecycle(t *testing.T) {
	t.Parallel()

	store := newAnalysisStore(t.TempDir())
	jobID := "job-1"
	payload := map[string]any{
		"source":  "template",
		"summary": "Kết quả ABSA rất tích cực.",
	}

	if err := store.SaveNarrative(jobID, payload); err != nil {
		t.Fatalf("SaveNarrative() error = %v", err)
	}

	got, err := store.Narrative(jobID)
	if err != nil {
		t.Fatalf("Narrative() error = %v", err)
	}
	if got["summary"] != payload["summary"] {
		t.Fatalf("summary = %v, want %v", got["summary"], payload["summary"])
	}

	if err := store.Delete(jobID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if _, err := store.Narrative(jobID); err == nil {
		t.Fatalf("Narrative() expected error after delete")
	}
}

func TestRunAnalysisPersistsFailureAndSuccess(t *testing.T) {
	t.Parallel()

	dataDir := t.TempDir()
	store := newAnalysisStore(dataDir)
	failRunner := &fakeAnalysisRunner{err: errors.New("service down")}
	worker := &worker{
		cfg:           &Config{DataFolder: dataDir},
		analysisStore: store,
		analyzer:      failRunner,
	}

	worker.runAnalysis(context.Background(), analysisRequest{JobID: "job-1", CSVPath: "missing.csv"})
	status, _ := store.Status("job-1")
	if status.Status != analysisStatusFailed {
		t.Fatalf("expected failed status, got %q", status.Status)
	}

	successRunner := &fakeAnalysisRunner{payload: map[string]any{"job_id": "job-1"}}
	worker.analyzer = successRunner
	worker.runAnalysis(context.Background(), analysisRequest{JobID: "job-1", CSVPath: "ok.csv"})
	status, _ = store.Status("job-1")
	if status.Status != analysisStatusOK {
		t.Fatalf("expected ok status, got %q", status.Status)
	}
}
