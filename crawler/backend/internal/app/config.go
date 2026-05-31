package app

import (
	"flag"
	"fmt"
	"strings"
	"time"
)

type Config struct {
	Addr                 string
	DataFolder           string
	Concurrency          int
	ExtraReviews         bool
	DisablePageReuse     bool
	Proxies              []string
	PollInterval         time.Duration
	PythonBin            string
	ABSARepoID           string
	ABSATeencodePath     string
	ABSAServiceURL       string
	ABSARestaurantRepoID string
	ABSAHotelRepoID      string
	ABSAHospitalRepoID   string
	AutoAnalyze          bool
}

func ParseConfig() (*Config, error) {
	cfg := &Config{}

	var proxyCSV string
	var disableAutoAnalysis bool

	flag.StringVar(&cfg.Addr, "addr", ":8090", "địa chỉ API server")
	flag.StringVar(&cfg.DataFolder, "data-folder", "crawler/data", "thư mục lưu jobs.db và CSV")
	flag.IntVar(&cfg.Concurrency, "concurrency", 2, "số job crawler chạy song song")
	flag.BoolVar(&cfg.ExtraReviews, "extra-reviews", false, "bật thu thập thêm reviews")
	flag.BoolVar(&cfg.DisablePageReuse, "disable-page-reuse", false, "tắt cơ chế page reuse của playwright")
	flag.StringVar(&proxyCSV, "proxies", "", "danh sách proxy cách nhau bằng dấu phẩy")
	flag.DurationVar(&cfg.PollInterval, "poll-interval", time.Second, "chu kỳ quét job pending")
	flag.StringVar(&cfg.PythonBin, "python-bin", "python", "binary Python để chạy ABSA pipeline")
	flag.StringVar(&cfg.ABSARepoID, "absa-repo-id", "NeoCyber/m-e5-small-vlsp2018-restaurant", "Hugging Face repo chứa weight ABSA")
	flag.StringVar(&cfg.ABSATeencodePath, "absa-teencode-path", "training/teencode/res_teencode.txt", "đường dẫn file teencode cho ABSA")
	flag.StringVar(&cfg.ABSAServiceURL, "absa-service-url", "http://127.0.0.1:8091", "URL service Python ABSA")
	flag.StringVar(&cfg.ABSARestaurantRepoID, "absa-restaurant-repo-id", "", "Hugging Face repo ABSA cho restaurant")
	flag.StringVar(&cfg.ABSAHotelRepoID, "absa-hotel-repo-id", "NeoCyber/m-e5-small-vlsp2018-hotel", "Hugging Face repo ABSA cho hotel")
	flag.StringVar(&cfg.ABSAHospitalRepoID, "absa-hospital-repo-id", "NeoCyber/m-e5-small-hosrev", "Hugging Face repo ABSA cho hospital")
	flag.BoolVar(&disableAutoAnalysis, "disable-auto-analysis", false, "tắt tự động phân tích ABSA sau khi crawl xong")
	flag.Parse()
	cfg.AutoAnalyze = !disableAutoAnalysis
	if cfg.ABSARestaurantRepoID == "" {
		cfg.ABSARestaurantRepoID = cfg.ABSARepoID
	}

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

func (cfg *Config) ABSAModelRepos() map[string]string {
	repos := map[string]string{}
	if strings.TrimSpace(cfg.ABSARestaurantRepoID) != "" {
		repos["restaurant"] = strings.TrimSpace(cfg.ABSARestaurantRepoID)
	}
	if strings.TrimSpace(cfg.ABSAHotelRepoID) != "" {
		repos["hotel"] = strings.TrimSpace(cfg.ABSAHotelRepoID)
	}
	if strings.TrimSpace(cfg.ABSAHospitalRepoID) != "" {
		repos["hospital"] = strings.TrimSpace(cfg.ABSAHospitalRepoID)
	}
	return repos
}
