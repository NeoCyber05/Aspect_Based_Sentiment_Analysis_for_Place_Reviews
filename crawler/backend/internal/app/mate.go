package app

import (
	"context"
	"fmt"
	"time"

	"github.com/gosom/scrapemate"
	"github.com/gosom/scrapemate/adapters/fetchers/stealth"
	parser "github.com/gosom/scrapemate/adapters/parsers/goqueryparser"
	memprovider "github.com/gosom/scrapemate/adapters/providers/memory"
	"github.com/gosom/scrapemate/adapters/proxy"
	"golang.org/x/sync/errgroup"

	"crawler/backend/internal/playwrightfetcher"
	"crawler/backend/internal/web"
)

type crawlMate interface {
	Start(context.Context, ...scrapemate.IJob) error
	Close() error
}

type localMate struct {
	concurrency      int
	exitOnInactivity time.Duration
	fetcher          scrapemate.HTTPFetcher
	writer           scrapemate.ResultWriter
}

func (w *worker) setupFetcher(job *web.Job) (scrapemate.HTTPFetcher, error) {
	proxies := w.effectiveProxies(job)
	if !job.Data.FastMode {
		return playwrightfetcher.New(playwrightfetcher.Options{
			PoolSize: w.cfg.Concurrency,
			Proxies:  proxies,
		})
	}

	if len(proxies) > 0 {
		return stealth.New("firefox", proxy.New(proxies)), nil
	}

	return stealth.New("firefox", nil), nil
}

func (w *worker) effectiveProxies(job *web.Job) []string {
	if len(w.cfg.Proxies) > 0 {
		return w.cfg.Proxies
	}

	return job.Data.Proxies
}

func (m *localMate) Start(ctx context.Context, seedJobs ...scrapemate.IJob) error {
	g, ctx := errgroup.WithContext(ctx)
	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(fmt.Errorf("closing crawler"))

	provider := memprovider.New()
	mate, err := scrapemate.New(
		scrapemate.WithContext(ctx, cancel),
		scrapemate.WithJobProvider(provider),
		scrapemate.WithHTTPFetcher(m.fetcher),
		scrapemate.WithHTMLParser(parser.New()),
		scrapemate.WithConcurrency(m.concurrency),
		scrapemate.WithExitBecauseOfInactivity(m.exitOnInactivity),
	)
	if err != nil {
		return err
	}
	defer mate.Close()

	g.Go(func() error {
		if err := m.writer.Run(ctx, mate.Results()); err != nil {
			cancel(err)
			return err
		}

		return nil
	})

	g.Go(func() error {
		return mate.Start()
	})

	g.Go(func() error {
		for i := range seedJobs {
			if err := provider.Push(ctx, seedJobs[i]); err != nil {
				return err
			}
		}

		return nil
	})

	return g.Wait()
}

func (m *localMate) Close() error {
	if m.fetcher == nil {
		return nil
	}

	return m.fetcher.Close()
}
