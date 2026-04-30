package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/gosom/google-maps-scraper/web"
)

type httpServer struct {
	svc *web.Service
	srv *http.Server
}

func newHTTPServer(svc *web.Service, cfg *Config) *httpServer {
	handler := http.NewServeMux()
	ans := &httpServer{
		svc: svc,
		srv: &http.Server{
			Addr:              cfg.Addr,
			Handler:           withCORS(handler),
			ReadHeaderTimeout: 10 * time.Second,
			ReadTimeout:       30 * time.Second,
			WriteTimeout:      60 * time.Second,
			IdleTimeout:       90 * time.Second,
		},
	}

	handler.HandleFunc("/api/health", ans.health)
	handler.HandleFunc("/api/v1/jobs", ans.jobs)
	handler.HandleFunc("/api/v1/jobs/{id}", ans.jobByID)
	handler.HandleFunc("/api/v1/jobs/{id}/download", ans.downloadCSV)

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
		ans = append(ans, toJobResponse(item))
	}

	writeJSON(w, http.StatusOK, ans)
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

		writeJSON(w, http.StatusOK, toJobResponse(job))
	case http.MethodDelete:
		if err := s.svc.Delete(r.Context(), id); err != nil {
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
		writeError(w, http.StatusNotFound, err.Error())
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
