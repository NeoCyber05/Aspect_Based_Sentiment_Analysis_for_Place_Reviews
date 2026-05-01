package app

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"crawler/backend/internal/web"
)

type createJobRequest struct {
	Name           string   `json:"name"`
	Keywords       []string `json:"keywords"`
	URLMode        bool     `json:"url_mode"`
	Lang           string   `json:"lang"`
	Zoom           int      `json:"zoom"`
	Lat            string   `json:"lat"`
	Lon            string   `json:"lon"`
	FastMode       bool     `json:"fast_mode"`
	Radius         int      `json:"radius"`
	Depth          int      `json:"depth"`
	Email          bool     `json:"email"`
	ExtraReviews   bool     `json:"extra_reviews"`
	MaxTimeSeconds int      `json:"max_time_seconds"`
	Proxies        []string `json:"proxies"`
}

type createJobResponse struct {
	ID string `json:"id"`
}

type apiError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type jobResponse struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	CreatedAt      string   `json:"created_at"`
	Status         string   `json:"status"`
	Keywords       []string `json:"keywords"`
	URLMode        bool     `json:"url_mode"`
	Lang           string   `json:"lang"`
	Zoom           int      `json:"zoom"`
	Lat            string   `json:"lat"`
	Lon            string   `json:"lon"`
	FastMode       bool     `json:"fast_mode"`
	Radius         int      `json:"radius"`
	Depth          int      `json:"depth"`
	Email          bool     `json:"email"`
	ExtraReviews   bool     `json:"extra_reviews"`
	MaxTimeSeconds int      `json:"max_time_seconds"`
	Proxies        []string `json:"proxies"`
}

func (r *createJobRequest) normalize() {
	r.Name = strings.TrimSpace(r.Name)
	r.Lang = strings.TrimSpace(r.Lang)
	r.Lat = strings.TrimSpace(r.Lat)
	r.Lon = strings.TrimSpace(r.Lon)

	keywords := make([]string, 0, len(r.Keywords))
	for _, keyword := range r.Keywords {
		trimmed := strings.TrimSpace(keyword)
		if trimmed == "" {
			continue
		}

		keywords = append(keywords, trimmed)
	}
	r.Keywords = keywords

	proxies := make([]string, 0, len(r.Proxies))
	for _, proxy := range r.Proxies {
		trimmed := strings.TrimSpace(proxy)
		if trimmed == "" {
			continue
		}

		proxies = append(proxies, trimmed)
	}
	r.Proxies = proxies
}

func (r *createJobRequest) validate() error {
	r.normalize()

	if r.Name == "" {
		return fmt.Errorf("thiếu tên job")
	}

	if len(r.Keywords) == 0 {
		return fmt.Errorf("thiếu từ khóa")
	}

	if r.MaxTimeSeconds < 180 {
		return fmt.Errorf("max_time_seconds phải >= 180")
	}

	if r.Depth < 1 {
		return fmt.Errorf("depth phải >= 1")
	}

	if r.Lang == "" {
		r.Lang = "vi"
	}

	return nil
}

func (r *createJobRequest) toWebJob() web.Job {
	return web.Job{
		ID:     uuid.New().String(),
		Name:   r.Name,
		Date:   time.Now().UTC(),
		Status: web.StatusPending,
		Data: web.JobData{
			Keywords:     r.Keywords,
			URLMode:      r.URLMode,
			Lang:         r.Lang,
			Zoom:         r.Zoom,
			Lat:          r.Lat,
			Lon:          r.Lon,
			FastMode:     r.FastMode,
			Radius:       r.Radius,
			Depth:        r.Depth,
			Email:        r.Email,
			ExtraReviews: r.ExtraReviews,
			MaxTime:      time.Duration(r.MaxTimeSeconds) * time.Second,
			Proxies:      r.Proxies,
		},
	}
}

func toJobResponse(job web.Job) jobResponse {
	return jobResponse{
		ID:             job.ID,
		Name:           job.Name,
		CreatedAt:      job.Date.UTC().Format(time.RFC3339),
		Status:         job.Status,
		Keywords:       job.Data.Keywords,
		URLMode:        job.Data.URLMode,
		Lang:           job.Data.Lang,
		Zoom:           job.Data.Zoom,
		Lat:            job.Data.Lat,
		Lon:            job.Data.Lon,
		FastMode:       job.Data.FastMode,
		Radius:         job.Data.Radius,
		Depth:          job.Data.Depth,
		Email:          job.Data.Email,
		ExtraReviews:   job.Data.ExtraReviews,
		MaxTimeSeconds: int(job.Data.MaxTime.Seconds()),
		Proxies:        job.Data.Proxies,
	}
}
