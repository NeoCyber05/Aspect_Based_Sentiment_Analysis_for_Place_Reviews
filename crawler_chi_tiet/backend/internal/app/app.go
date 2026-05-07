package app

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"golang.org/x/sync/errgroup"

	"crawler/backend/internal/web"
	"crawler/backend/internal/web/sqlite"
)

type App struct {
	server *httpServer
	worker *worker
	closer interface{ Close() error }
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

	var closer interface{ Close() error }
	if c, ok := repo.(interface{ Close() error }); ok {
		closer = c
	}

	return &App{
		server: newHTTPServer(svc, cfg),
		worker: newWorker(svc, cfg),
		closer: closer,
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

	err := eg.Wait()
	if a.closer != nil {
		if closeErr := a.closer.Close(); closeErr != nil && err == nil {
			err = closeErr
		}
	}

	return err
}
