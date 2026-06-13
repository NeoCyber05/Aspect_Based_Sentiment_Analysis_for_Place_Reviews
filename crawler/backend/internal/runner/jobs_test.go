package runner

import (
	"strings"
	"testing"

	"crawler/backend/internal/gmaps"
)

func TestCreateSeedJobsUsesBrowserJobWhenNotFastWithCoordinates(t *testing.T) {
	jobs, err := CreateSeedJobs(
		false,
		false,
		"vi",
		strings.NewReader("Nhà Thuốc Việt Mỹ\n"),
		10,
		0,
		"16.0735,108.2419",
		15,
		10000,
		nil,
		nil,
		false,
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 {
		t.Fatalf("expected 1 job, got %d", len(jobs))
	}
	if _, ok := jobs[0].(*gmaps.GmapJob); !ok {
		t.Fatalf("expected *gmaps.GmapJob, got %T", jobs[0])
	}
}

func TestCreateSeedJobsUsesSearchJobWhenFast(t *testing.T) {
	jobs, err := CreateSeedJobs(
		true,
		false,
		"vi",
		strings.NewReader("Nhà Thuốc Việt Mỹ\n"),
		10,
		0,
		"16.0735,108.2419",
		15,
		10000,
		nil,
		nil,
		false,
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 {
		t.Fatalf("expected 1 job, got %d", len(jobs))
	}
	if _, ok := jobs[0].(*gmaps.SearchJob); !ok {
		t.Fatalf("expected *gmaps.SearchJob, got %T", jobs[0])
	}
}
