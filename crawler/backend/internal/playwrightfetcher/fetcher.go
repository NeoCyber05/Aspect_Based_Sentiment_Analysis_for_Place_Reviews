package playwrightfetcher

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/gosom/scrapemate"
	playwrightadapter "github.com/gosom/scrapemate/adapters/browsers/playwright"
	"github.com/playwright-community/playwright-go"
)

type Options struct {
	PoolSize  int
	UserAgent string
	Proxies   []string
}

type Fetcher struct {
	pw        *playwright.Playwright
	pool      chan *browser
	userAgent string
	proxies   []scrapemate.Proxy
	nextProxy uint32
	closeOnce sync.Once
}

type browser struct {
	browser playwright.Browser
	context playwright.BrowserContext
}

func New(opts Options) (*Fetcher, error) {
	if opts.PoolSize < 1 {
		opts.PoolSize = 1
	}

	if err := playwright.Install(&playwright.RunOptions{
		Browsers: []string{"chromium"},
		Verbose:  true,
	}); err != nil {
		return nil, err
	}

	pw, err := playwright.Run()
	if err != nil {
		return nil, err
	}

	f := &Fetcher{
		pw:        pw,
		pool:      make(chan *browser, opts.PoolSize),
		userAgent: opts.UserAgent,
	}

	for _, rawProxy := range opts.Proxies {
		proxy, err := scrapemate.NewProxy(rawProxy)
		if err != nil {
			_ = f.Close()
			return nil, fmt.Errorf("invalid proxy %q: %w", rawProxy, err)
		}

		f.proxies = append(f.proxies, proxy)
	}

	for range opts.PoolSize {
		b, err := f.newBrowser()
		if err != nil {
			_ = f.Close()
			return nil, err
		}

		f.pool <- b
	}

	return f, nil
}

func (f *Fetcher) Fetch(ctx context.Context, job scrapemate.IJob) scrapemate.Response {
	b, err := f.getBrowser(ctx)
	if err != nil {
		return scrapemate.Response{Error: err}
	}
	defer f.putBrowser(ctx, b)

	if timeout := job.GetTimeout(); timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}

	page, err := b.context.NewPage()
	if err != nil {
		return scrapemate.Response{Error: err}
	}
	defer page.Close()

	if timeout := job.GetTimeout(); timeout > 0 {
		page.SetDefaultTimeout(float64(timeout.Milliseconds()))
	}

	return job.BrowserActions(ctx, playwrightadapter.NewPage(page))
}

func (f *Fetcher) Close() error {
	f.closeOnce.Do(func() {
		close(f.pool)
		for b := range f.pool {
			b.close()
		}

		if f.pw != nil {
			_ = f.pw.Stop()
		}
	})

	return nil
}

func (f *Fetcher) getBrowser(ctx context.Context) (*browser, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case b := <-f.pool:
		if b != nil && b.browser.IsConnected() {
			return b, nil
		}
		if b != nil {
			b.close()
		}
	default:
	}

	return f.newBrowser()
}

func (f *Fetcher) putBrowser(ctx context.Context, b *browser) {
	if b == nil {
		return
	}

	if !b.browser.IsConnected() {
		b.close()
		return
	}

	select {
	case <-ctx.Done():
		b.close()
	case f.pool <- b:
	default:
		b.close()
	}
}

func (f *Fetcher) newBrowser() (*browser, error) {
	br, err := f.pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
		Headless: playwright.Bool(true),
	})
	if err != nil {
		return nil, err
	}

	bctx, err := br.NewContext(playwright.BrowserNewContextOptions{
		UserAgent: f.contextUserAgent(),
		Viewport: &playwright.Size{
			Width:  1920,
			Height: 1080,
		},
		Proxy: f.contextProxy(),
	})
	if err != nil {
		_ = br.Close()
		return nil, err
	}

	return &browser{
		browser: br,
		context: bctx,
	}, nil
}

func (f *Fetcher) contextUserAgent() *string {
	ua := f.userAgent
	if ua == "" {
		ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
	}

	return &ua
}

func (f *Fetcher) contextProxy() *playwright.Proxy {
	if len(f.proxies) == 0 {
		return nil
	}

	current := atomic.AddUint32(&f.nextProxy, 1) - 1
	proxy := f.proxies[current%uint32(len(f.proxies))]

	ans := &playwright.Proxy{Server: proxy.URL}
	if proxy.Username != "" {
		ans.Username = &proxy.Username
	}
	if proxy.Password != "" {
		ans.Password = &proxy.Password
	}

	return ans
}

func (b *browser) close() {
	_ = b.context.Close()
	_ = b.browser.Close()
}
