package app

import (
	"testing"
	"time"

	"crawler/backend/internal/web"
)

func TestCreateJobRequestValidate(t *testing.T) {
	t.Parallel()

	req := createJobRequest{
		Name:           "  Job mẫu ",
		Keywords:       []string{"  coffee ", " ", "tea"},
		Lang:           "vi",
		Depth:          10,
		MaxTimeSeconds: 300,
	}

	if err := req.validate(); err != nil {
		t.Fatalf("expected request to be valid, got %v", err)
	}

	if len(req.Keywords) != 2 {
		t.Fatalf("expected 2 cleaned keywords, got %d", len(req.Keywords))
	}
}

func TestCreateJobRequestValidateFailsWhenMaxTimeTooSmall(t *testing.T) {
	t.Parallel()

	req := createJobRequest{
		Name:           "job",
		Keywords:       []string{"coffee"},
		Lang:           "vi",
		Depth:          10,
		MaxTimeSeconds: 100,
	}

	if err := req.validate(); err == nil {
		t.Fatalf("expected validation error for max time")
	}
}

func TestToJobResponse(t *testing.T) {
	t.Parallel()

	job := web.Job{
		ID:     "test-id",
		Name:   "job",
		Status: web.StatusOK,
		Date:   time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC),
		Data: web.JobData{
			Keywords: []string{"coffee"},
			Lang:     "vi",
			Depth:    10,
			MaxTime:  5 * time.Minute,
		},
	}

	resp := toJobResponse(job)
	if resp.ID != job.ID {
		t.Fatalf("expected id %s, got %s", job.ID, resp.ID)
	}

	if resp.MaxTimeSeconds != 300 {
		t.Fatalf("expected 300 seconds, got %d", resp.MaxTimeSeconds)
	}
}
