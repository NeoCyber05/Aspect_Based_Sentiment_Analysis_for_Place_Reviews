package gmaps

import (
	"encoding/json"
	"fmt"
	"iter"
	"runtime/debug"
	"slices"
	"strconv"
	"strings"
)

type Review struct {
	Name           string
	ProfilePicture string
	Rating         int
	Description    string
	Images         []string
	When           string
}

type Entry struct {
	CrawlMode  string              `json:"-"`
	Title      string              `json:"title"`
	Categories []string            `json:"categories"`
	Category   string              `json:"category"`
	OpenHours  map[string][]string `json:"open_hours"`
	ReviewCount         int                    `json:"review_count"`
	ReviewRating        float64                `json:"review_rating"`
	ReviewsPerRating    map[int]int            `json:"reviews_per_rating"`
	UserReviews         []Review               `json:"user_reviews"`
	UserReviewsExtended []Review               `json:"user_reviews_extended"`
}

func (e *Entry) Validate() error {
	if e.Title == "" {
		return fmt.Errorf("title is empty")
	}

	if e.Category == "" {
		return fmt.Errorf("category is empty")
	}

	return nil
}

func (e *Entry) CsvHeaders() []string {
	if e.CrawlMode == "train" {
		return []string{
			"title",
			"category",
		}
	}

	return []string{
		"title",
		"category",
		"open_hours",
		"review_count",
		"review_rating",
		"reviews_per_rating",
		"user_reviews",
		"user_reviews_extended",
	}
}

func (e *Entry) CsvRow() []string {
	if e.CrawlMode == "train" {
		return []string{
			e.Title,
			e.Category,
		}
	}

	return []string{
		e.Title,
		e.Category,
		stringify(e.OpenHours),
		stringify(e.ReviewCount),
		stringify(e.ReviewRating),
		stringify(e.ReviewsPerRating),
		stringify(e.UserReviews),
		stringify(e.UserReviewsExtended),
	}
}

func (e *Entry) AddExtraReviews(pages [][]byte) {
	if len(pages) == 0 {
		return
	}

	hasInlineReviews := len(e.UserReviews) > 0
	for _, page := range pages {
		reviews := extractReviews(page)
		if len(reviews) > 0 {
			e.UserReviewsExtended = append(e.UserReviewsExtended, reviews...)
			if !hasInlineReviews {
				e.UserReviews = append(e.UserReviews, reviews...)
			}
		}
	}

	if e.ReviewCount == 0 && len(e.UserReviewsExtended) > 0 {
		e.ReviewCount = len(e.UserReviewsExtended)
	}
}

func extractReviews(data []byte) []Review {
	// Skip the security prefix
	prefix := ")]}'\n"
	if len(data) >= len(prefix) && string(data[:len(prefix)]) == prefix {
		data = data[len(prefix):]
	} else if len(data) >= 4 && string(data[0:4]) == `)]}'` {
		data = data[4:]
	}

	var jd []any
	if err := json.Unmarshal(data, &jd); err != nil {
		fmt.Printf("Error unmarshalling RPC JSON: %v (data len: %d)\n", err, len(data))
		return nil
	}

	if len(jd) < 3 {
		return nil
	}

	reviewsI := getNthElementAndCast[[]any](jd, 2)
	if len(reviewsI) == 0 {
		// Try alternative indices - Google may have changed the structure
		reviewsI = getNthElementAndCast[[]any](jd, 0)
	}

	return parseReviews(reviewsI)
}

//nolint:gomnd // it's ok, I need the indexes
func EntryFromJSON(raw []byte, reviewCountOnly ...bool) (entry Entry, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("recovered from panic: %v stack: %s", r, debug.Stack())

			return
		}
	}()

	onlyReviewCount := false

	if len(reviewCountOnly) == 1 && reviewCountOnly[0] {
		onlyReviewCount = true
	}

	var jd []any
	if err := json.Unmarshal(raw, &jd); err != nil {
		return entry, err
	}

	if len(jd) < 7 {
		return entry, fmt.Errorf("invalid json")
	}

	darray, ok := jd[6].([]any)
	if !ok {
		return entry, fmt.Errorf("invalid json")
	}

	entry.ReviewCount = int(getNthElementAndCast[float64](darray, 4, 8))

	if onlyReviewCount {
		return entry, nil
	}

	entry.Title = getNthElementAndCast[string](darray, 11)

	categoriesI := getNthElementAndCast[[]any](darray, 13)

	entry.Categories = make([]string, len(categoriesI))
	for i := range categoriesI {
		entry.Categories[i], _ = categoriesI[i].(string)
	}

	if len(entry.Categories) > 0 {
		entry.Category = entry.Categories[0]
	}

	entry.OpenHours = getHours(darray)
	entry.ReviewRating = getNthElementAndCast[float64](darray, 4, 7)

	entry.ReviewsPerRating = map[int]int{
		1: int(getNthElementAndCast[float64](darray, 175, 3, 0)),
		2: int(getNthElementAndCast[float64](darray, 175, 3, 1)),
		3: int(getNthElementAndCast[float64](darray, 175, 3, 2)),
		4: int(getNthElementAndCast[float64](darray, 175, 3, 3)),
		5: int(getNthElementAndCast[float64](darray, 175, 3, 4)),
	}

	// Parse inline reviews from the page data
	reviewsI := getNthElementAndCast[[]any](darray, 175, 9, 0, 0)
	if len(reviewsI) > 0 {
		entry.UserReviews = parseReviews(reviewsI)
	} else {
		// Try alternative location for reviews
		reviewsI = getNthElementAndCast[[]any](darray, 175, 9, 0)
		if len(reviewsI) > 0 {
			entry.UserReviews = parseReviews(reviewsI)
		} else {
			entry.UserReviews = make([]Review, 0)
		}
	}

	return entry, nil
}

func parseReviews(reviewsI []any) []Review {
	ans := make([]Review, 0, len(reviewsI))

	for i := range reviewsI {
		el := getNthElementAndCast[[]any](reviewsI, i, 0)
		if len(el) == 0 {
			// Try alternative structure
			el = getNthElementAndCast[[]any](reviewsI, i)
			if len(el) == 0 {
				continue
			}
		}

		// Try multiple paths for the timestamp
		time := getNthElementAndCast[[]any](el, 2, 2, 0, 1, 21, 6, 8)
		if len(time) == 0 {
			time = getNthElementAndCast[[]any](el, 2, 2, 0, 1, 6, 8)
		}

		// Try multiple paths for profile picture
		profilePic, err := decodeURL(getNthElementAndCast[string](el, 1, 4, 5, 1))
		if err != nil || profilePic == "" {
			profilePic = getNthElementAndCast[string](el, 1, 2, 0)
			if profilePic == "" {
				profilePic = getNthElementAndCast[string](el, 0, 2, 0)
			}
		}

		// Try multiple paths for author name
		authorName := getNthElementAndCast[string](el, 1, 4, 5, 0)
		if authorName == "" {
			authorName = getNthElementAndCast[string](el, 1, 4, 4)
			if authorName == "" {
				authorName = getNthElementAndCast[string](el, 0, 1)
			}
		}

		// Try multiple paths for rating
		rating := int(getNthElementAndCast[float64](el, 2, 0, 0))
		if rating == 0 {
			rating = int(getNthElementAndCast[float64](el, 2, 0))
			if rating == 0 {
				rating = int(getNthElementAndCast[float64](el, 1, 0, 0))
			}
		}

		// Try multiple paths for description
		description := getNthElementAndCast[string](el, 2, 15, 0, 0)
		if description == "" {
			description = getNthElementAndCast[string](el, 2, 15, 0)
			if description == "" {
				description = getNthElementAndCast[string](el, 3, 0)
			}
		}

		review := Review{
			Name:           authorName,
			ProfilePicture: profilePic,
			When: func() string {
				if len(time) < 3 {
					return ""
				}

				return fmt.Sprintf("%v-%v-%v", time[0], time[1], time[2])
			}(),
			Rating:      rating,
			Description: description,
		}

		if review.Name == "" {
			continue
		}

		// Extract user-contributed photo URLs for this review.
		// Structure: el[2][2] is the image list; each image's direct lh3 URL lives at [1][6][0].
		// The previous paths (e.g. [2][2][0][1][21][7]) landed on the imagery/report
		// "report this photo" URL, not the actual hosted image. See issue #240.
		imgs := getNthElementAndCast[[]any](el, 2, 2)
		for j := range imgs {
			url := getNthElementAndCast[string](imgs, j, 1, 6, 0)
			if url != "" {
				review.Images = append(review.Images, url)
			}
		}

		ans = append(ans, review)
	}

	return ans
}

//nolint:gomnd // it's ok, I need the indexes
func getHours(darray []any) map[string][]string {
	// Try new structure first (as of Nov 2025) - darray[203][0]
	items := getNthElementAndCast[[]any](darray, 203, 0)
	if len(items) == 0 {
		// Fall back to old structure - darray[34][1]
		items = getNthElementAndCast[[]any](darray, 34, 1)
	}

	hours := make(map[string][]string, len(items))

	for _, item := range items {
		itemArray, ok := item.([]any)
		if !ok {
			continue
		}

		// New structure: [0] = day name, [3] = time slots array
		day := getNthElementAndCast[string](itemArray, 0)
		if day == "" {
			continue
		}

		// Try new structure for times
		timeSlotsI := getNthElementAndCast[[]any](itemArray, 3)
		if len(timeSlotsI) > 0 {
			// New format: each slot is [formatted_string, [[hour, min], [hour, min]]]
			times := make([]string, 0, len(timeSlotsI))

			for _, slot := range timeSlotsI {
				slotArray, ok := slot.([]any)
				if !ok || len(slotArray) == 0 {
					continue
				}

				// Get the formatted time string (e.g., "11 am–1:30 pm")
				timeStr := getNthElementAndCast[string](slotArray, 0)
				if timeStr != "" {
					times = append(times, timeStr)
				}
			}

			if len(times) > 0 {
				hours[day] = times
			}
		} else {
			// Fall back to old structure: [1] = times array
			timesI := getNthElementAndCast[[]any](itemArray, 1)
			times := make([]string, 0, len(timesI))

			for i := range timesI {
				if timeStr, ok := timesI[i].(string); ok {
					times = append(times, timeStr)
				}
			}

			if len(times) > 0 {
				hours[day] = times
			}
		}
	}

	return hours
}

func getNthElementAndCast[T any](arr []any, indexes ...int) T {
	var (
		defaultVal T
		idx        int
	)

	if len(indexes) == 0 {
		return defaultVal
	}

	for len(indexes) > 1 {
		idx, indexes = indexes[0], indexes[1:]

		if idx >= len(arr) {
			return defaultVal
		}

		next := arr[idx]

		if next == nil {
			return defaultVal
		}

		var ok bool

		arr, ok = next.([]any)
		if !ok {
			return defaultVal
		}
	}

	if len(indexes) == 0 || len(arr) == 0 {
		return defaultVal
	}

	if indexes[0] >= len(arr) {
		return defaultVal
	}

	ans, ok := arr[indexes[0]].(T)
	if !ok {
		return defaultVal
	}

	return ans
}

func stringSliceToString(s []string) string {
	return strings.Join(s, ", ")
}

func stringify(v any) string {
	switch val := v.(type) {
	case string:
		return val
	case float64:
		return fmt.Sprintf("%f", val)
	case nil:
		return ""
	default:
		d, _ := json.Marshal(v)
		return string(d)
	}
}

func decodeURL(url string) (string, error) {
	quoted := `"` + strings.ReplaceAll(url, `"`, `\"`) + `"`

	unquoted, err := strconv.Unquote(quoted)
	if err != nil {
		return "", fmt.Errorf("failed to decode URL: %v", err)
	}

	return unquoted, nil
}

type EntryWithDistance struct {
	Entry    *Entry
	Distance float64
}

func filterAndSortEntriesWithinRadius(entries []*Entry, lat, lon, radius float64) []*Entry {
	withinRadiusIterator := func(yield func(EntryWithDistance) bool) {
		for _, entry := range entries {
			if !yield(EntryWithDistance{Entry: entry, Distance: 0}) {
				return
			}
		}
	}

	entriesWithDistance := slices.Collect(iter.Seq[EntryWithDistance](withinRadiusIterator))

	resultIterator := func(yield func(*Entry) bool) {
		for _, e := range entriesWithDistance {
			if !yield(e.Entry) {
				return
			}
		}
	}

	return slices.Collect(iter.Seq[*Entry](resultIterator))
}
