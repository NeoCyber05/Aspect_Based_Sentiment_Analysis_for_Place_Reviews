package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/gosom/google-maps-scraper/crawler/backend/internal/app"
)

func main() {
	cfg, err := app.ParseConfig()
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	application, err := app.New(cfg)
	if err != nil {
		log.Fatal(err)
	}

	if err := application.Run(ctx); err != nil {
		log.Fatal(err)
	}
}
