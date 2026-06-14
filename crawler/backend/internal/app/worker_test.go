package app

import (
	"bytes"
	"testing"

	"crawler/backend/internal/web"
)

func TestSetupMateDisablesScrapeMateInactivityWatchdog(t *testing.T) {
	t.Parallel()

	worker := &worker{
		cfg: &Config{Concurrency: 1},
	}
	job := &web.Job{
		Data: web.JobData{FastMode: true},
	}

	mate, err := worker.setupMate(&bytes.Buffer{}, job)
	if err != nil {
		t.Fatalf("setupMate() error = %v", err)
	}
	t.Cleanup(func() {
		if err := mate.Close(); err != nil {
			t.Fatalf("mate.Close() error = %v", err)
		}
	})

	local, ok := mate.(*localMate)
	if !ok {
		t.Fatalf("setupMate() returned %T, want *localMate", mate)
	}
	if local.exitOnInactivity != 0 {
		t.Fatalf("expected ScrapeMate inactivity watchdog disabled, got %s", local.exitOnInactivity)
	}
}
