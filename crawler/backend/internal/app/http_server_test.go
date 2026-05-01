package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"crawler/backend/internal/web"
	"crawler/backend/internal/web/sqlite"
)

func newTestHTTPServer(t *testing.T) (*httpServer, string) {
	t.Helper()

	dataDir := t.TempDir()
	repo, err := sqlite.New(filepath.Join(dataDir, "jobs.db"))
	if err != nil {
		t.Fatalf("sqlite.New() error: %v", err)
	}

	if closer, ok := repo.(interface{ Close() error }); ok {
		t.Cleanup(func() {
			if err := closer.Close(); err != nil {
				t.Fatalf("failed to close sqlite repo: %v", err)
			}
		})
	}

	svc := web.NewService(repo, dataDir)
	cfg := &Config{
		Addr:       ":0",
		DataFolder: dataDir,
	}

	return newHTTPServer(svc, cfg), dataDir
}

func TestCreateAndListJobs(t *testing.T) {
	t.Parallel()

	server, _ := newTestHTTPServer(t)

	payload := createJobRequest{
		Name:           "job test",
		Keywords:       []string{"coffee hanoi"},
		Lang:           "vi",
		Zoom:           15,
		Depth:          10,
		Radius:         1000,
		MaxTimeSeconds: 300,
	}
	body, _ := json.Marshal(payload)

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/jobs", bytes.NewReader(body))
	createReq = createReq.WithContext(context.Background())
	createResp := httptest.NewRecorder()
	server.jobs(createResp, createReq)

	if createResp.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", createResp.Code)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/jobs", nil)
	listResp := httptest.NewRecorder()
	server.jobs(listResp, listReq)

	if listResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", listResp.Code)
	}

	var jobs []jobResponse
	if err := json.Unmarshal(listResp.Body.Bytes(), &jobs); err != nil {
		t.Fatalf("failed to decode jobs response: %v", err)
	}

	if len(jobs) != 1 {
		t.Fatalf("expected 1 job, got %d", len(jobs))
	}
}

func TestDownloadCSV(t *testing.T) {
	t.Parallel()

	server, dataDir := newTestHTTPServer(t)

	payload := createJobRequest{
		Name:           "job csv",
		Keywords:       []string{"coffee hanoi"},
		Lang:           "vi",
		Zoom:           15,
		Depth:          10,
		Radius:         1000,
		MaxTimeSeconds: 300,
	}
	body, _ := json.Marshal(payload)

	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/jobs", bytes.NewReader(body))
	createResp := httptest.NewRecorder()
	server.jobs(createResp, createReq)

	var createOut createJobResponse
	if err := json.Unmarshal(createResp.Body.Bytes(), &createOut); err != nil {
		t.Fatalf("failed to decode create response: %v", err)
	}

	csvPath := filepath.Join(dataDir, createOut.ID+".csv")
	if err := os.WriteFile(csvPath, []byte("name,address\nshop,hn\n"), 0o600); err != nil {
		t.Fatalf("failed to write csv fixture: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/jobs/"+createOut.ID+"/download", nil)
	req.SetPathValue("id", createOut.ID)
	resp := httptest.NewRecorder()
	server.downloadCSV(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}

	if resp.Header().Get("Content-Type") != "text/csv" {
		t.Fatalf("expected text/csv content type, got %q", resp.Header().Get("Content-Type"))
	}
}
