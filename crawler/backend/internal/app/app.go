package app

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/gosom/google-maps-scraper/web"
	"github.com/gosom/google-maps-scraper/web/sqlite"
	"golang.org/x/sync/errgroup"
)

type App struct {
	server *httpServer
	worker *worker
}

func New(cfg *Config) (*App, error) {
	if err := os.MkdirAll(cfg.DataFolder, os.ModePerm); err != nil {
		return nil, err
	}

	dbPath := filepath.Join(cfg.DataFolder, "jobs.db")
	repo, err := sqlite.New(dbPath)
	if err != nil {
		return nil, fmt.Errorf("không mở được sqlite: %w", err)
	}

	svc := web.NewService(repo, cfg.DataFolder)

	return &App{
		server: newHTTPServer(svc, cfg),
		worker: newWorker(svc, cfg),
	}, nil
}

func (a *App) Run(ctx context.Context) error {
	log.Println("crawler backend đang chạy...")
	eg, runCtx := errgroup.WithContext(ctx)

	eg.Go(func() error {
		return a.server.Start(runCtx)
	})

	eg.Go(func() error {
		return a.worker.Run(runCtx)
	})

	return eg.Wait()
}
