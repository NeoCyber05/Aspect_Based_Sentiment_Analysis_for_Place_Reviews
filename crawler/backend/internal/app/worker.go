package app

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gosom/scrapemate/adapters/writers/csvwriter"

	"crawler/backend/internal/deduper"
	"crawler/backend/internal/exiter"
	"crawler/backend/internal/runner"
	"crawler/backend/internal/web"
)

type worker struct {
	svc           *web.Service
	cfg           *Config
	analyzer      analysisRunner
	analysisStore *analysisStore
}

func newWorker(svc *web.Service, cfg *Config) *worker {
	return &worker{
		svc:           svc,
		cfg:           cfg,
		analyzer:      newReviewAnalyzer(cfg),
		analysisStore: newAnalysisStore(cfg.DataFolder),
	}
}

func (w *worker) Run(ctx context.Context) error {
	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			jobs, err := w.svc.SelectPending(ctx)
			if err != nil {
				return err
			}

			for i := range jobs {
				select {
				case <-ctx.Done():
					return nil
				default:
					if err := w.scrapeJob(ctx, &jobs[i]); err != nil {
						log.Printf("crawl job thất bại id=%s err=%v", jobs[i].ID, err)
					}
				}
			}
		}
	}
}

func (w *worker) scrapeJob(ctx context.Context, job *web.Job) error {
	job.Status = web.StatusWorking
	if err := w.svc.Update(ctx, job); err != nil {
		return err
	}

	outpath := filepath.Join(w.cfg.DataFolder, web.CsvFileName(*job))
	outfile, err := os.Create(outpath)
	if err != nil {
		return err
	}
	shouldCloseOutput := true
	defer func() {
		if shouldCloseOutput {
			_ = outfile.Close()
		}
	}()

	mate, err := w.setupMate(outfile, job)
	if err != nil {
		return w.failJob(ctx, job, err)
	}
	defer mate.Close()

	coords := ""
	if job.Data.Lat != "" && job.Data.Lon != "" {
		coords = job.Data.Lat + "," + job.Data.Lon
	}

	dedup := deduper.New()
	exitMonitor := exiter.New()

	seedJobs, err := runner.CreateSeedJobs(
		job.Data.FastMode,
		job.Data.URLMode,
		job.Data.Lang,
		strings.NewReader(strings.Join(job.Data.Keywords, "\n")),
		job.Data.Depth,
		job.Data.MaxPlaces,
		coords,
		job.Data.Zoom,
		func() float64 {
			if job.Data.Radius <= 0 {
				return 10000
			}
			return float64(job.Data.Radius)
		}(),
		dedup,
		exitMonitor,
		w.cfg.ExtraReviews || job.Data.ExtraReviews,
		job.Data.CrawlMode,
	)
	if err != nil {
		return w.failJob(ctx, job, err)
	}

	if len(seedJobs) > 0 {
		exitMonitor.SetSeedCount(len(seedJobs))

		allowedSeconds := max(60, len(seedJobs)*10*job.Data.Depth/50+120)
		if job.Data.MaxTime > 0 {
			allowedSeconds = int(job.Data.MaxTime.Seconds())
			if allowedSeconds < 180 {
				allowedSeconds = 180
			}
		}

		mateCtx, cancel := context.WithTimeout(ctx, time.Duration(allowedSeconds)*time.Second)
		defer cancel()

		exitMonitor.SetCancelFunc(cancel)
		go exitMonitor.Run(mateCtx)

		err = mate.Start(mateCtx, seedJobs...)
		if err != nil && !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, context.Canceled) {
			return w.failJob(ctx, job, err)
		}
	}

	if err := outfile.Close(); err != nil {
		return w.failJob(ctx, job, err)
	}
	shouldCloseOutput = false

	info, err := os.Stat(outpath)
	if err != nil {
		return w.failJob(ctx, job, err)
	}

	if info.Size() == 0 {
		return w.failJob(ctx, job, fmt.Errorf("crawler finished without writing csv rows"))
	}

	job.Status = web.StatusOK
	if err := w.svc.Update(ctx, job); err != nil {
		return err
	}
	w.enqueueAnalysis(job.ID, outpath)
	return nil
}

func (w *worker) enqueueAnalysis(jobID, csvPath string) {
	if w == nil || w.cfg == nil || !w.cfg.AutoAnalyze || w.analyzer == nil || w.analysisStore == nil {
		return
	}
	status, err := w.analysisStore.Status(jobID)
	if err != nil {
		log.Printf("không đọc được trạng thái phân tích id=%s err=%v", jobID, err)
		return
	}
	if status.Status == analysisStatusOK || status.Status == analysisStatusWorking {
		return
	}
	go w.runAnalysis(context.Background(), analysisRequest{
		JobID:   jobID,
		CSVPath: csvPath,
		Force:   false,
	})
}

func (w *worker) runAnalysis(ctx context.Context, req analysisRequest) {
	if w == nil || w.analyzer == nil || w.analysisStore == nil {
		return
	}
	if err := w.analysisStore.MarkWorking(req.JobID); err != nil {
		log.Printf("không cập nhật được trạng thái phân tích id=%s err=%v", req.JobID, err)
		return
	}
	payload, err := w.analyzer.analyzeCSV(ctx, req)
	if err != nil {
		if saveErr := w.analysisStore.SaveFailure(req.JobID, err); saveErr != nil {
			log.Printf("không lưu được lỗi phân tích id=%s err=%v", req.JobID, saveErr)
		}
		return
	}
	if err := w.analysisStore.SaveSuccess(req.JobID, payload); err != nil {
		log.Printf("không lưu được kết quả phân tích id=%s err=%v", req.JobID, err)
	}
}

func (w *worker) failJob(ctx context.Context, job *web.Job, err error) error {
	job.Status = web.StatusFailed
	if updateErr := w.svc.Update(ctx, job); updateErr != nil {
		return fmt.Errorf("%w; failed to update job status: %v", err, updateErr)
	}

	return err
}

func (w *worker) setupMate(writer io.Writer, job *web.Job) (crawlMate, error) {
	csvWriter := csvwriter.NewCsvWriter(csv.NewWriter(writer))
	httpFetcher, err := w.setupFetcher(job)
	if err != nil {
		return nil, fmt.Errorf("không tạo được cấu hình crawler: %w", err)
	}

	return &localMate{
		concurrency:      w.cfg.Concurrency,
		// Worker-owned context timeouts and exiter completion are the reliable
		// lifecycle controls here. ScrapeMate's inactivity watchdog treats the
		// zero last-activity timestamp as stale before a long first Maps job can
		// finish and enqueue place-detail jobs.
		exitOnInactivity: 0,
		fetcher:          httpFetcher,
		writer:           csvWriter,
	}, nil
}
