package runner

import (
	"bufio"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"

	"github.com/gosom/scrapemate"

	"crawler/backend/internal/deduper"
	"crawler/backend/internal/exiter"
	"crawler/backend/internal/gmaps"
)

// CreateSeedJobs reads input queries and creates ScrapeMate seed jobs.
func CreateSeedJobs(
	fastmode bool,
	urlMode bool,
	langCode string,
	r io.Reader,
	maxDepth int,
	email bool,
	geoCoordinates string,
	zoom int,
	radius float64,
	dedup deduper.Deduper,
	exitMonitor exiter.Exiter,
	extraReviews bool,
) (jobs []scrapemate.IJob, err error) {
	var lat, lon float64

	if urlMode && fastmode {
		return nil, fmt.Errorf("url mode cannot be used together with fast mode")
	}

	if fastmode {
		if geoCoordinates == "" {
			return nil, fmt.Errorf("geo coordinates are required in fast mode")
		}

		parts := strings.Split(geoCoordinates, ",")
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid geo coordinates: %s", geoCoordinates)
		}

		lat, err = strconv.ParseFloat(parts[0], 64)
		if err != nil {
			return nil, fmt.Errorf("invalid latitude: %w", err)
		}

		lon, err = strconv.ParseFloat(parts[1], 64)
		if err != nil {
			return nil, fmt.Errorf("invalid longitude: %w", err)
		}

		if lat < -90 || lat > 90 {
			return nil, fmt.Errorf("invalid latitude: %f", lat)
		}

		if lon < -180 || lon > 180 {
			return nil, fmt.Errorf("invalid longitude: %f", lon)
		}

		if zoom < 1 || zoom > 21 {
			return nil, fmt.Errorf("invalid zoom level: %d", zoom)
		}

		if radius < 0 {
			return nil, fmt.Errorf("invalid radius: %f", radius)
		}
	}

	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		q, ok, parseErr := parseQueryLine(scanner.Text())
		if parseErr != nil {
			return nil, parseErr
		}

		if !ok {
			continue
		}

		var job scrapemate.IJob
		if urlMode {
			placeURL, urlErr := normalizeMapsPlaceURL(q.text)
			if urlErr != nil {
				return nil, fmt.Errorf("invalid place URL %q: %w", q.text, urlErr)
			}

			opts := []gmaps.PlaceJobOptions{}
			if exitMonitor != nil {
				opts = append(opts, gmaps.WithPlaceJobExitMonitor(exitMonitor))
			}

			job = gmaps.NewPlaceJob(q.id, langCode, placeURL, email, extraReviews, opts...)
		} else if !fastmode {
			opts := []gmaps.GmapJobOptions{}
			if dedup != nil {
				opts = append(opts, gmaps.WithDeduper(dedup))
			}

			if exitMonitor != nil {
				opts = append(opts, gmaps.WithExitMonitor(exitMonitor))
			}

			if extraReviews {
				opts = append(opts, gmaps.WithExtraReviews())
			}

			job = gmaps.NewGmapJob(q.id, langCode, q.text, maxDepth, email, geoCoordinates, zoom, opts...)
		} else {
			params := gmaps.MapSearchParams{
				Location: gmaps.MapLocation{
					Lat:     lat,
					Lon:     lon,
					ZoomLvl: float64(zoom),
					Radius:  radius,
				},
				Query:     q.text,
				ViewportW: 1920,
				ViewportH: 450,
				Hl:        langCode,
			}

			opts := []gmaps.SearchJobOptions{}
			if exitMonitor != nil {
				opts = append(opts, gmaps.WithSearchJobExitMonitor(exitMonitor))
			}

			job = gmaps.NewSearchJob(&params, opts...)
		}

		jobs = append(jobs, job)
	}

	return jobs, scanner.Err()
}

type query struct {
	text string
	id   string
}

func parseQueryLine(line string) (query, bool, error) {
	line = strings.TrimSpace(line)
	if line == "" {
		return query{}, false, nil
	}

	var q query
	if before, after, ok := strings.Cut(line, "#!#"); ok {
		q.text = strings.TrimSpace(before)
		q.id = strings.TrimSpace(after)
	} else {
		q.text = line
	}

	if q.text == "" {
		return query{}, false, fmt.Errorf("invalid query line %q: empty query text", line)
	}

	return q, true, nil
}

func normalizeMapsPlaceURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("empty URL")
	}

	if strings.HasPrefix(trimmed, "maps/place/") {
		trimmed = "/" + trimmed
	}

	if strings.HasPrefix(trimmed, "/maps/place/") {
		return "https://www.google.com" + trimmed, nil
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", err
	}

	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("must include scheme and host, or use /maps/place/... path")
	}

	if !strings.HasPrefix(parsed.Path, "/maps/place/") {
		return "", fmt.Errorf("path must start with /maps/place/")
	}

	return parsed.String(), nil
}
