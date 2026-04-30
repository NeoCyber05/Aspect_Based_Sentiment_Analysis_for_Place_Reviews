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

	"github.com/gosom/google-maps-scraper/deduper"
	"github.com/gosom/google-maps-scraper/exiter"
	"github.com/gosom/google-maps-scraper/runner"
	"github.com/gosom/google-maps-scraper/web"
	"github.com/gosom/scrapemate"
	"github.com/gosom/scrapemate/adapters/writers/csvwriter"
	"github.com/gosom/scrapemate/scrapemateapp"
)

type worker struct {
	svc *web.Service
	cfg *Config
}

func newWorker(svc *web.Service, cfg *Config) *worker {
	return &worker{
		svc: svc,
		cfg: cfg,
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

	outpath := filepath.Join(w.cfg.DataFolder, job.ID+".csv")
	outfile, err := os.Create(outpath)
	if err != nil {
		return err
	}
	defer outfile.Close()

	mate, err := w.setupMate(outfile, job)
	if err != nil {
		job.Status = web.StatusFailed
		_ = w.svc.Update(ctx, job)
		return err
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
		job.Data.Email,
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
	)
	if err != nil {
		job.Status = web.StatusFailed
		_ = w.svc.Update(ctx, job)
		return err
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
			job.Status = web.StatusFailed
			_ = w.svc.Update(ctx, job)
			return err
		}
	}

	job.Status = web.StatusOK
	return w.svc.Update(ctx, job)
}

func (w *worker) setupMate(writer io.Writer, job *web.Job) (*scrapemateapp.ScrapemateApp, error) {
	opts := []func(*scrapemateapp.Config) error{
		scrapemateapp.WithConcurrency(w.cfg.Concurrency),
		scrapemateapp.WithExitOnInactivity(3 * time.Minute),
	}

	if !job.Data.FastMode {
		opts = append(opts, scrapemateapp.WithJS(scrapemateapp.DisableImages()))
	} else {
		opts = append(opts, scrapemateapp.WithStealth("firefox"))
	}

	if len(w.cfg.Proxies) > 0 {
		opts = append(opts, scrapemateapp.WithProxies(w.cfg.Proxies))
	} else if len(job.Data.Proxies) > 0 {
		opts = append(opts, scrapemateapp.WithProxies(job.Data.Proxies))
	}

	if !w.cfg.DisablePageReuse {
		opts = append(opts, scrapemateapp.WithPageReuseLimit(200))
	}

	csvWriter := csvwriter.NewCsvWriter(csv.NewWriter(writer))
	mateCfg, err := scrapemateapp.NewConfig([]scrapemate.ResultWriter{csvWriter}, opts...)
	if err != nil {
		return nil, fmt.Errorf("không tạo được cấu hình crawler: %w", err)
	}

	return scrapemateapp.NewScrapeMateApp(mateCfg)
}
