package app

import (
	"flag"
	"fmt"
	"strings"
	"time"
)

type Config struct {
	Addr             string
	DataFolder       string
	Concurrency      int
	ExtraReviews     bool
	DisablePageReuse bool
	Proxies          []string
	PollInterval     time.Duration
}

func ParseConfig() (*Config, error) {
	cfg := &Config{}

	var proxyCSV string

	flag.StringVar(&cfg.Addr, "addr", ":8090", "địa chỉ API server")
	flag.StringVar(&cfg.DataFolder, "data-folder", "crawler/data", "thư mục lưu jobs.db và CSV")
	flag.IntVar(&cfg.Concurrency, "concurrency", 2, "số job crawler chạy song song")
	flag.BoolVar(&cfg.ExtraReviews, "extra-reviews", false, "bật thu thập thêm reviews")
	flag.BoolVar(&cfg.DisablePageReuse, "disable-page-reuse", false, "tắt cơ chế page reuse của playwright")
	flag.StringVar(&proxyCSV, "proxies", "", "danh sách proxy cách nhau bằng dấu phẩy")
	flag.DurationVar(&cfg.PollInterval, "poll-interval", time.Second, "chu kỳ quét job pending")
	flag.Parse()

	if cfg.Concurrency < 1 {
		return nil, fmt.Errorf("concurrency phải lớn hơn 0")
	}

	if cfg.PollInterval <= 0 {
		return nil, fmt.Errorf("poll-interval phải lớn hơn 0")
	}

	if proxyCSV != "" {
		items := strings.Split(proxyCSV, ",")
		cfg.Proxies = make([]string, 0, len(items))
		for _, item := range items {
			trimmed := strings.TrimSpace(item)
			if trimmed == "" {
				continue
			}

			cfg.Proxies = append(cfg.Proxies, trimmed)
		}
	}

	return cfg, nil
}
