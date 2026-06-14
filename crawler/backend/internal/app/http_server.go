package app

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/google/uuid"

	"crawler/backend/internal/web"
)

func countCSVReviews(path string) (places int, reviews int, err error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()

	reader := csv.NewReader(f)
	header, err := reader.Read()
	if err != nil {
		return 0, 0, err
	}

	reviewCountIdx := -1
	for i, col := range header {
		if col == "review_count" {
			reviewCountIdx = i
			break
		}
	}

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}
		if len(row) == 0 || row[0] == "" {
			continue
		}
		places++
		if reviewCountIdx >= 0 && reviewCountIdx < len(row) {
			if n, err := strconv.Atoi(row[reviewCountIdx]); err == nil {
				reviews += n
			}
		}
	}
	return places, reviews, nil
}

type httpServer struct {
	svc           *web.Service
	srv           *http.Server
	analyzer      analysisRunner
	analysisStore *analysisStore
	dataFolder    string
}

func newHTTPServer(svc *web.Service, cfg *Config) *httpServer {
	handler := http.NewServeMux()
	store := newAnalysisStore(cfg.DataFolder)
	ans := &httpServer{
		svc:           svc,
		analyzer:      newReviewAnalyzer(cfg),
		analysisStore: store,
		dataFolder:    cfg.DataFolder,
		srv: &http.Server{
			Addr:              cfg.Addr,
			Handler:           withCORS(handler),
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       30 * time.Second,
			WriteTimeout:      10 * time.Minute,
			IdleTimeout:       90 * time.Second,
		},
	}

	handler.HandleFunc("/api/health", ans.health)
	handler.HandleFunc("/api/v1/jobs", ans.jobs)
	handler.HandleFunc("/api/v1/jobs/{id}", ans.jobByID)
	handler.HandleFunc("/api/v1/jobs/{id}/download", ans.downloadCSV)
	handler.HandleFunc("/api/v1/jobs/{id}/analysis", ans.jobAnalysis)
	handler.HandleFunc("/api/v1/jobs/{id}/analyze", ans.analyzeCSV)
	handler.HandleFunc("/api/v1/jobs/{id}/analysis/narrative", ans.jobAnalysisNarrative)

	return ans
}

func (s *httpServer) Start(ctx context.Context) error {
	errCh := make(chan error, 1)
	go func() {
		errCh <- s.srv.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		_ = s.srv.Shutdown(shutdownCtx)
		return nil
	case err := <-errCh:
		if err == nil || err == http.ErrServerClosed {
			return nil
		}

		return err
	}
}

func (s *httpServer) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
	})
}

func (s *httpServer) jobs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		s.createJob(w, r)
	case http.MethodGet:
		s.listJobs(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *httpServer) createJob(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "không thể đọc request body")
		return
	}

	var req createJobRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "payload JSON không hợp lệ")
		return
	}

	if err := req.validate(); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	job := req.toWebJob()
	if err := job.Validate(); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	if err := s.svc.Create(r.Context(), &job); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, createJobResponse{ID: job.ID})
}

func (s *httpServer) listJobs(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.svc.All(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	ans := make([]jobResponse, 0, len(jobs))
	for _, item := range jobs {
		status, err := s.analysisStore.Status(item.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		resp := toJobResponse(item, status)
		if item.Status == web.StatusWorking {
			resp.CrawlProgress = s.readCrawlProgress(item)
		}
		ans = append(ans, resp)
	}

	writeJSON(w, http.StatusOK, ans)
}

func (s *httpServer) readCrawlProgress(job web.Job) *crawlProgress {
	path := filepath.Join(s.dataFolder, web.CsvFileName(job))
	places, reviews, err := countCSVReviews(path)
	if err != nil {
		return nil
	}
	return &crawlProgress{PlacesCrawled: places, ReviewsCrawled: reviews}
}

func (s *httpServer) jobByID(w http.ResponseWriter, r *http.Request) {
	id, ok := parseJobID(r)
	if !ok {
		writeError(w, http.StatusUnprocessableEntity, "id không hợp lệ")
		return
	}

	switch r.Method {
	case http.MethodGet:
		job, err := s.svc.Get(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusNotFound, "không tìm thấy job")
			return
		}

		status, err := s.analysisStore.Status(job.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		resp := toJobResponse(job, status)
		if job.Status == web.StatusWorking {
			resp.CrawlProgress = s.readCrawlProgress(job)
		}
		writeJSON(w, http.StatusOK, resp)
	case http.MethodDelete:
		if err := s.svc.Delete(r.Context(), id); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := s.analysisStore.Delete(id); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		w.WriteHeader(http.StatusNoContent)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *httpServer) downloadCSV(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id, ok := parseJobID(r)
	if !ok {
		writeError(w, http.StatusUnprocessableEntity, "id không hợp lệ")
		return
	}

	filePath, err := s.svc.GetCSV(r.Context(), id)
	if err != nil {
		switch {
		case errors.Is(err, web.ErrCSVNotReady):
			writeError(w, http.StatusConflict, "job chua hoan tat, chua the tai csv")
		case errors.Is(err, web.ErrCSVEmpty):
			writeError(w, http.StatusConflict, "csv chua co du lieu")
		default:
			writeError(w, http.StatusNotFound, err.Error())
		}
		return
	}

	file, err := os.Open(filePath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "không mở được file csv")
		return
	}
	defer file.Close()

	fileName := filepath.Base(filePath)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", fileName))
	w.Header().Set("Content-Type", "text/csv")
	w.WriteHeader(http.StatusOK)

	_, _ = io.Copy(w, file)
}

func (s *httpServer) jobAnalysis(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id, ok := parseJobID(r)
	if !ok {
		writeError(w, http.StatusUnprocessableEntity, "id không hợp lệ")
		return
	}

	status, err := s.analysisStore.Status(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	response := analysisResponse{Status: status}
	if status.Status == analysisStatusOK {
		result, err := s.analysisStore.Result(id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		response.Result = result
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *httpServer) analyzeCSV(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id, ok := parseJobID(r)
	if !ok {
		writeError(w, http.StatusUnprocessableEntity, "id khÃ´ng há»£p lá»‡")
		return
	}

	filePath, err := s.svc.GetCSV(r.Context(), id)
	if err != nil {
		switch {
		case errors.Is(err, web.ErrCSVNotReady):
			writeError(w, http.StatusConflict, "job chua hoan tat, chua the phan tich")
		case errors.Is(err, web.ErrCSVEmpty):
			writeError(w, http.StatusConflict, "csv chua co du lieu")
		default:
			writeError(w, http.StatusNotFound, err.Error())
		}
		return
	}

	if err := s.analysisStore.MarkWorking(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	payload, err := s.analyzer.analyzeCSV(r.Context(), analysisRequest{
		JobID:   id,
		CSVPath: filePath,
		Force:   true,
	})
	if err != nil {
		_ = s.analysisStore.SaveFailure(id, err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.analysisStore.SaveSuccess(id, payload); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, payload)
}

func (s *httpServer) jobAnalysisNarrative(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id, ok := parseJobID(r)
	if !ok {
		writeError(w, http.StatusUnprocessableEntity, "id không hợp lệ")
		return
	}

	if r.Method == http.MethodGet {
		narrative, err := s.analysisStore.Narrative(id)
		if err == nil {
			writeJSON(w, http.StatusOK, narrative)
			return
		}
	}

	status, err := s.analysisStore.Status(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if status.Status != analysisStatusOK {
		writeError(w, http.StatusConflict, "analysis chưa hoàn tất")
		return
	}

	result, err := s.analysisStore.Result(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	runner, ok := s.analyzer.(narrativeRunner)
	if !ok {
		writeError(w, http.StatusInternalServerError, "analyzer không hỗ trợ narrative")
		return
	}

	force := r.URL.Query().Get("force") == "1"
	useOllama := r.URL.Query().Get("ollama") != "0"
	if r.Method == http.MethodGet && !force {
		if narrative, err := s.analysisStore.Narrative(id); err == nil {
			writeJSON(w, http.StatusOK, narrative)
			return
		}
	}

	narrative, err := runner.generateNarrative(r.Context(), result, useOllama)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.analysisStore.SaveNarrative(id, narrative); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, narrative)
}

func parseJobID(r *http.Request) (string, bool) {
	rawID := r.PathValue("id")
	parsed, err := uuid.Parse(rawID)
	if err != nil {
		return "", false
	}

	return parsed.String(), true
}

func writeJSON(w http.ResponseWriter, code int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, code, apiError{
		Code:    code,
		Message: message,
	})
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
