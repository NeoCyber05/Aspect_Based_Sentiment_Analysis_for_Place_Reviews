package gmaps

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	olc "github.com/google/open-location-code/go"
)

func ParseSearchResults(raw []byte) ([]*Entry, error) {
	var data []any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON: %w", err)
	}

	if len(data) == 0 {
		return nil, fmt.Errorf("empty JSON data")
	}

	container, ok := data[0].([]any)
	if !ok || len(container) == 0 {
		return nil, fmt.Errorf("invalid business list structure")
	}

	items := getNthElementAndCast[[]any](container, 1)
	if len(items) < 2 {
		return nil, fmt.Errorf("empty business list")
	}

	entries := make([]*Entry, 0, len(items)-1)

	for i := 1; i < len(items); i++ {
		arr, ok := items[i].([]any)
		if !ok {
			continue
		}

		business := getNthElementAndCast[[]any](arr, 14)

		var entry Entry

		entry.ID = getNthElementAndCast[string](business, 0)
		entry.Title = getNthElementAndCast[string](business, 11)
		entry.Categories = toStringSlice(getNthElementAndCast[[]any](business, 13))
		if len(entry.Categories) > 0 {
			entry.Category = entry.Categories[0]
		}
		entry.WebSite = getNthElementAndCast[string](business, 7, 0)

		entry.ReviewRating = getNthElementAndCast[float64](business, 4, 7)
		entry.ReviewCount = int(getNthElementAndCast[float64](business, 4, 8))

		fullAddress := getNthElementAndCast[[]any](business, 2)

		entry.Address = func() string {
			sb := strings.Builder{}

			for i, part := range fullAddress {
				if i > 0 {
					sb.WriteString(", ")
				}

				sb.WriteString(fmt.Sprintf("%v", part))
			}

			return sb.String()
		}()

		entry.Latitude = getNthElementAndCast[float64](business, 9, 2)
		entry.Longtitude = getNthElementAndCast[float64](business, 9, 3)
		entry.Phone = strings.ReplaceAll(getNthElementAndCast[string](business, 178, 0, 0), " ", "")
		entry.OpenHours = getHours(business)
		entry.Status = getNthElementAndCast[string](business, 34, 4, 4)
		entry.Timezone = getNthElementAndCast[string](business, 30)
		entry.DataID = getNthElementAndCast[string](business, 10)
		entry.PlaceID = getNthElementAndCast[string](business, 78)
		entry.Link = mapsPlaceURL(entry.Title, entry.Latitude, entry.Longtitude, entry.DataID, entry.PlaceID)

		entry.PlusCode = olc.Encode(entry.Latitude, entry.Longtitude, 10)

		entries = append(entries, &entry)
	}

	return entries, nil
}

func toStringSlice(arr []any) []string {
	ans := make([]string, 0, len(arr))
	for _, v := range arr {
		ans = append(ans, fmt.Sprintf("%v", v))
	}

	return ans
}

func mapsPlaceURL(title string, lat, lon float64, dataID, placeID string) string {
	title = strings.TrimSpace(title)
	dataID = strings.TrimSpace(dataID)
	if title != "" && lat != 0 && lon != 0 && dataID != "" {
		return fmt.Sprintf(
			"https://www.google.com/maps/place/%s/@%.7f,%.7f,17z/data=!3m1!4b1!4m5!3m4!1s%s!8m2!3d%.7f!4d%.7f",
			url.QueryEscape(title),
			lat,
			lon,
			dataID,
			lat,
			lon,
		)
	}

	placeID = strings.TrimSpace(placeID)
	if placeID == "" {
		return ""
	}

	return "https://www.google.com/maps/place/?q=place_id:" + url.QueryEscape(placeID)
}
