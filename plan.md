# Improve ABSA Analysis Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the review analysis dashboard so ABSA results are shown as sentiment evidence instead of artificial scores, with Vietnamese aspect names and an optional Ollama-generated narrative section.

**Architecture:** Keep the existing ABSA pipeline and dashboard data model, but enrich the analysis JSON with display metadata and better alert semantics. Ollama is only an optional interpretation layer: it reads the existing ABSA summary and evidence, generates a Vietnamese narrative, and never replaces the quantitative sentiment display. The Python ABSA service owns aspect metadata and narrative generation; the Go backend proxies saved analysis results and on-demand narrative requests to the frontend.

**Tech Stack:** Python FastAPI ABSA service, Go backend HTTP server, React frontend, Ollama local API, pytest/unittest, Go tests, Vite build.

---

## File Structure

### Files To Create

- `review_absa_pipeline/aspect_metadata.py` - Vietnamese aspect/domain display metadata shared by result generation and Ollama prompts.
- `review_absa_pipeline/narrative.py` - Deterministic and Ollama-backed narrative generation from existing ABSA result JSON.
- `crawler/frontend/src/utils/aspectDisplay.js` - Frontend fallback helpers for legacy analysis JSON without backend display metadata.
- `crawler/frontend/src/components/SentimentBar.jsx` - Compact sentiment distribution bar.
- `crawler/frontend/src/components/NarrativePanel.jsx` - Optional "Phân tích diễn giải" panel with loading/error states.
- `crawler/backend/internal/app/narrative.go` - Go proxy for on-demand narrative generation through the Python ABSA service.

### Files To Modify

- `review_absa_pipeline/insights.py` - Add display metadata to aspects, severity to alerts, better evidence fields, and valid-rating filtering.
- `review_absa_pipeline/service.py` - Add `/v1/narrative` endpoint.
- `tests/test_review_absa_analysis.py` - Add tests for metadata, low-sample alerts, valid rating mismatch, and narrative fallback.
- `crawler/backend/internal/app/analysis.go` - Add narrative sidecar cache helpers.
- `crawler/backend/internal/app/analyzer.go` - Add narrative request method that calls Python service.
- `crawler/backend/internal/app/http_server.go` - Add `/api/v1/jobs/{id}/analysis/narrative` route.
- `crawler/backend/internal/app/analysis_test.go` - Add cache lifecycle tests for narrative sidecar.
- `crawler/frontend/src/api.js` - Add narrative API call.
- `crawler/frontend/src/App.jsx` - Replace score-first rendering with sentiment-first rendering and add narrative panel.
- `crawler/frontend/src/styles.css` - Add responsive styles for sentiment bars, alert severity, and narrative panel.

---

## Task 1: Add Shared Aspect Display Metadata

**Files:**
- Create: `review_absa_pipeline/aspect_metadata.py`
- Test: `tests/test_review_absa_analysis.py`

- [ ] **Step 1: Add failing tests for Vietnamese aspect metadata**

Add these tests to `tests/test_review_absa_analysis.py`:

```python
from review_absa_pipeline.aspect_metadata import enrich_aspect_row, translate_aspect


class AspectMetadataTests(unittest.TestCase):
    def test_translate_known_hotel_aspect_to_vietnamese(self) -> None:
        metadata = translate_aspect("ROOM_AMENITIES#DESIGN&FEATURES", domain="hotel")

        self.assertEqual(metadata["display_name"], "Tiện ích phòng - Thiết kế & trang bị")
        self.assertEqual(metadata["group_name"], "Tiện ích phòng")
        self.assertEqual(metadata["attribute_name"], "Thiết kế & trang bị")
        self.assertEqual(metadata["domain"], "hotel")

    def test_unknown_aspect_keeps_raw_key_but_normalizes_separator(self) -> None:
        metadata = translate_aspect("UNKNOWN#GENERAL", domain="restaurant")

        self.assertEqual(metadata["display_name"], "UNKNOWN - GENERAL")
        self.assertEqual(metadata["group_name"], "UNKNOWN")
        self.assertEqual(metadata["attribute_name"], "GENERAL")
        self.assertEqual(metadata["raw_name"], "UNKNOWN#GENERAL")

    def test_enrich_aspect_row_preserves_metrics(self) -> None:
        row = {
            "aspect": "SERVICE#GENERAL",
            "mentions": 10,
            "positive": 8,
            "neutral": 1,
            "negative": 1,
            "positive_percent": 80.0,
            "neutral_percent": 10.0,
            "negative_percent": 10.0,
        }

        enriched = enrich_aspect_row(row, domain="hotel")

        self.assertEqual(enriched["aspect"], "SERVICE#GENERAL")
        self.assertEqual(enriched["display_name"], "Dịch vụ - Tổng quan")
        self.assertEqual(enriched["mentions"], 10)
        self.assertEqual(enriched["positive"], 8)
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
python -m unittest tests.test_review_absa_analysis.AspectMetadataTests -v
```

Expected: fail with `ModuleNotFoundError: No module named 'review_absa_pipeline.aspect_metadata'`.

- [ ] **Step 3: Create aspect metadata module**

Create `review_absa_pipeline/aspect_metadata.py`:

```python
from __future__ import annotations

from typing import Any


GROUP_TRANSLATIONS = {
    "AMBIENCE": "Không gian",
    "DRINKS": "Đồ uống",
    "FACILITIES": "Cơ sở vật chất",
    "FOOD": "Đồ ăn",
    "FOOD&DRINKS": "Đồ ăn & thức uống",
    "HOTEL": "Khách sạn",
    "LOCATION": "Vị trí",
    "RESTAURANT": "Nhà hàng",
    "ROOMS": "Phòng",
    "ROOM_AMENITIES": "Tiện ích phòng",
    "SERVICE": "Dịch vụ",
}


ATTRIBUTE_TRANSLATIONS = {
    "CLEANLINESS": "Vệ sinh",
    "COMFORT": "Sự thoải mái",
    "DESIGN&FEATURES": "Thiết kế & trang bị",
    "GENERAL": "Tổng quan",
    "MISCELLANEOUS": "Khác",
    "PRICES": "Giá cả",
    "QUALITY": "Chất lượng",
    "STYLE&OPTIONS": "Phong cách & lựa chọn",
}


FULL_TRANSLATIONS = {
    "Cơ sở vật chất#Chất lượng": ("Cơ sở vật chất", "Chất lượng"),
    "Cơ sở vật chất#Khác": ("Cơ sở vật chất", "Khác"),
    "Cơ sở vật chất#Không gian": ("Cơ sở vật chất", "Không gian"),
    "Cơ sở vật chất#Vệ sinh": ("Cơ sở vật chất", "Vệ sinh"),
    "Nhân viên y tế#Chất lượng": ("Nhân viên y tế", "Chất lượng"),
    "Nhân viên y tế#Khác": ("Nhân viên y tế", "Khác"),
    "Nhân viên y tế#Thái độ": ("Nhân viên y tế", "Thái độ"),
    "Trải nghiệm chung#Chất lượng": ("Trải nghiệm chung", "Chất lượng"),
    "Trải nghiệm chung#Giá": ("Trải nghiệm chung", "Giá"),
    "Trải nghiệm chung#Khác": ("Trải nghiệm chung", "Khác"),
    "Trải nghiệm chung#Không gian": ("Trải nghiệm chung", "Không gian"),
    "Trải nghiệm chung#Thái độ": ("Trải nghiệm chung", "Thái độ"),
    "Trải nghiệm chung#Vệ sinh": ("Trải nghiệm chung", "Vệ sinh"),
}


def _split_aspect(raw_name: str) -> tuple[str, str]:
    if raw_name in FULL_TRANSLATIONS:
        return FULL_TRANSLATIONS[raw_name]
    group, _, attribute = raw_name.replace("\\u0026", "&").partition("#")
    return group.strip(), attribute.strip()


def translate_aspect(raw_name: str, domain: str = "") -> dict[str, str]:
    normalized = str(raw_name or "").replace("\\u0026", "&").strip()
    group, attribute = _split_aspect(normalized)
    group_name = GROUP_TRANSLATIONS.get(group, group.replace("_", " "))
    attribute_name = ATTRIBUTE_TRANSLATIONS.get(attribute, attribute.replace("_", " "))
    display_name = group_name if not attribute_name else f"{group_name} - {attribute_name}"
    return {
        "raw_name": normalized,
        "display_name": display_name,
        "group_name": group_name,
        "attribute_name": attribute_name,
        "domain": str(domain or ""),
    }


def enrich_aspect_row(row: dict[str, Any], domain: str = "") -> dict[str, Any]:
    aspect = str(row.get("aspect", ""))
    return {
        **row,
        **translate_aspect(aspect, domain=domain),
    }
```

- [ ] **Step 4: Run metadata tests**

Run:

```bash
python -m unittest tests.test_review_absa_analysis.AspectMetadataTests -v
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add review_absa_pipeline/aspect_metadata.py tests/test_review_absa_analysis.py
git commit -m "feat: add Vietnamese aspect display metadata"
```

---

## Task 2: Enrich ABSA Result JSON And Fix Alert Semantics

**Files:**
- Modify: `review_absa_pipeline/insights.py`
- Modify: `tests/test_review_absa_analysis.py`

- [ ] **Step 1: Add failing tests for enriched aspects, alert severity, and valid ratings**

Add this test method to `ReviewAnalysisTests` in `tests/test_review_absa_analysis.py`:

```python
    def test_analysis_result_enriches_display_metadata_and_marks_low_sample_alerts(self) -> None:
        place_result = {
            "input_id": "hotel-1",
            "title": "Hotel Test",
            "domain": {"domain": "hotel", "confidence": 0.93, "source": "fixed", "fallback": False},
            "reviews": [
                {
                    "text": "Phong on nhung dich vu tot",
                    "rating": 5,
                    "when": "2026-01-02",
                    "prediction": {
                        "ROOM_AMENITIES#DESIGN&FEATURES": "negative",
                        "SERVICE#GENERAL": "positive",
                    },
                },
                {
                    "text": "Tien ich phong chua tot",
                    "rating": 0,
                    "when": "2026-01-03",
                    "prediction": {
                        "ROOM_AMENITIES#DESIGN&FEATURES": "negative",
                        "SERVICE#GENERAL": "positive",
                    },
                },
            ],
        }

        result = build_analysis_result(
            job_id="job-1",
            model_repo_ids={"hotel": "repo/hotel"},
            place_results=[place_result],
        )

        room_alert = result["alerts"][0]
        self.assertEqual(room_alert["display_name"], "Tiện ích phòng - Thiết kế & trang bị")
        self.assertEqual(room_alert["severity"], "watch")
        self.assertEqual(room_alert["sample_note"], "Mẫu nhỏ: 2 lượt đề cập")
        self.assertEqual(result["places"][0]["aspects"][0]["display_name"], "Dịch vụ - Tổng quan")
        self.assertEqual(result["rating_vs_text"]["total_with_rating"], 1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
python -m unittest tests.test_review_absa_analysis.ReviewAnalysisTests.test_analysis_result_enriches_display_metadata_and_marks_low_sample_alerts -v
```

Expected: fail because `display_name`, `severity`, `sample_note`, and valid-rating filtering are not implemented.

- [ ] **Step 3: Import metadata helper and add alert classifier**

Modify `review_absa_pipeline/insights.py`:

```python
from .aspect_metadata import enrich_aspect_row, translate_aspect
```

Add these helpers above `_alerts`:

```python
def _alert_severity(mentions: int, negative: int, negative_percent: float) -> tuple[str, str]:
    if mentions < 5:
        return "watch", f"Mẫu nhỏ: {mentions} lượt đề cập"
    if negative >= 3 and negative_percent >= 35.0:
        return "high", "Ưu tiên xử lý"
    if negative >= 2 and negative_percent >= 25.0:
        return "medium", "Cần theo dõi"
    return "low", "Tín hiệu nhẹ"


def _valid_rating(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and int(value) == value and 1 <= int(value) <= 5:
        return int(value)
    return None
```

- [ ] **Step 4: Enrich place and global aspect rows**

In `build_analysis_result`, replace:

```python
aspects = aspect_rows(summary)
```

with:

```python
domain_name = str((place.get("domain") or {}).get("domain", ""))
aspects = [enrich_aspect_row(item, domain=domain_name) for item in aspect_rows(summary)]
```

Replace:

```python
global_aspects = aspect_rows(global_summary)
```

with:

```python
global_domain = _dominant_domain(place_results)
global_aspects = [enrich_aspect_row(item, domain=global_domain) for item in aspect_rows(global_summary)]
```

Add `_dominant_domain` above `build_analysis_result`:

```python
def _dominant_domain(place_results: list[dict[str, Any]]) -> str:
    counts: dict[str, int] = defaultdict(int)
    for place in place_results:
        domain = str((place.get("domain") or {}).get("domain", ""))
        if domain:
            counts[domain] += 1
    if not counts:
        return ""
    return sorted(counts.items(), key=lambda item: item[1], reverse=True)[0][0]
```

- [ ] **Step 5: Add severity and display metadata to alerts**

Replace `_alerts` return block with:

```python
    enriched_alerts: list[dict[str, Any]] = []
    for item in candidates[:limit]:
        mentions = int(item.get("mentions", 0) or 0)
        negative = int(item.get("negative", 0) or 0)
        negative_percent = float(item.get("negative_percent", 0.0) or 0.0)
        severity, sample_note = _alert_severity(mentions, negative, negative_percent)
        enriched_alerts.append(
            {
                "aspect": item["aspect"],
                "display_name": item.get("display_name") or translate_aspect(str(item["aspect"])).get("display_name"),
                "group_name": item.get("group_name", ""),
                "attribute_name": item.get("attribute_name", ""),
                "domain": item.get("domain", ""),
                "mentions": mentions,
                "negative": negative,
                "negative_percent": item["negative_percent"],
                "priority_score": item.get("priority_score", 0.0),
                "severity": severity,
                "sample_note": sample_note,
            }
        )
    return enriched_alerts
```

- [ ] **Step 6: Filter invalid ratings in mismatch calculation**

In `_rating_mismatches`, replace:

```python
            rating = review.get("rating")
            if rating is None:
                continue
            total_with_rating += 1
```

with:

```python
            rating = _valid_rating(review.get("rating"))
            if rating is None:
                continue
            total_with_rating += 1
```

- [ ] **Step 7: Run Python tests**

Run:

```bash
python -m unittest tests.test_review_absa_analysis -v
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add review_absa_pipeline/insights.py tests/test_review_absa_analysis.py
git commit -m "feat: enrich ABSA result display metadata"
```

---

## Task 3: Add Optional Ollama Narrative Generation In Python

**Files:**
- Create: `review_absa_pipeline/narrative.py`
- Modify: `review_absa_pipeline/service.py`
- Modify: `tests/test_review_absa_analysis.py`

- [ ] **Step 1: Add failing tests for deterministic narrative fallback**

Add this test class to `tests/test_review_absa_analysis.py`:

```python
from review_absa_pipeline.narrative import build_narrative_context, generate_template_narrative


class NarrativeTests(unittest.TestCase):
    def test_template_narrative_uses_existing_absa_result_without_replacing_metrics(self) -> None:
        result = {
            "overall": {
                "mentions": 296,
                "positive": 290,
                "neutral": 0,
                "negative": 6,
                "positive_percent": 97.97,
                "negative_percent": 2.03,
            },
            "aspects": [
                {"display_name": "Dịch vụ - Tổng quan", "mentions": 82, "positive": 82, "negative": 0, "positive_percent": 100.0, "negative_percent": 0.0},
                {"display_name": "Tiện ích phòng - Thiết kế & trang bị", "mentions": 2, "positive": 0, "negative": 2, "positive_percent": 0.0, "negative_percent": 100.0},
            ],
            "alerts": [
                {"display_name": "Tiện ích phòng - Thiết kế & trang bị", "mentions": 2, "negative": 2, "negative_percent": 100.0, "severity": "watch", "sample_note": "Mẫu nhỏ: 2 lượt đề cập"}
            ],
            "places": [{"title": "A25 Hotel - Đội Cấn 1", "description_count": 146}],
        }

        context = build_narrative_context(result)
        narrative = generate_template_narrative(context)

        self.assertEqual(narrative["source"], "template")
        self.assertIn("97.97% tích cực", narrative["summary"])
        self.assertIn("Dịch vụ - Tổng quan", narrative["strengths"][0])
        self.assertIn("Mẫu nhỏ", narrative["caveats"][0])
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
python -m unittest tests.test_review_absa_analysis.NarrativeTests -v
```

Expected: fail because `review_absa_pipeline.narrative` does not exist.

- [ ] **Step 3: Create narrative module**

Create `review_absa_pipeline/narrative.py`:

```python
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


def _num(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return 0.0


def _top_positive_aspects(aspects: list[dict[str, Any]], limit: int = 3) -> list[dict[str, Any]]:
    rows = [item for item in aspects if int(item.get("positive", 0) or 0) > 0]
    return sorted(rows, key=lambda item: (int(item.get("positive", 0) or 0), int(item.get("mentions", 0) or 0)), reverse=True)[:limit]


def build_narrative_context(result: dict[str, Any]) -> dict[str, Any]:
    aspects = result.get("aspects") if isinstance(result.get("aspects"), list) else []
    alerts = result.get("alerts") if isinstance(result.get("alerts"), list) else []
    places = result.get("places") if isinstance(result.get("places"), list) else []
    overall = result.get("overall") if isinstance(result.get("overall"), dict) else {}
    return {
        "overall": {
            "mentions": int(overall.get("mentions", 0) or 0),
            "positive": int(overall.get("positive", 0) or 0),
            "neutral": int(overall.get("neutral", 0) or 0),
            "negative": int(overall.get("negative", 0) or 0),
            "positive_percent": round(_num(overall.get("positive_percent")), 2),
            "negative_percent": round(_num(overall.get("negative_percent")), 2),
        },
        "top_strengths": _top_positive_aspects(aspects),
        "alerts": alerts[:5],
        "places": [
            {
                "title": place.get("title", ""),
                "description_count": int(place.get("description_count", 0) or 0),
            }
            for place in places[:5]
        ],
    }


def generate_template_narrative(context: dict[str, Any]) -> dict[str, Any]:
    overall = context["overall"]
    strengths = [
        f"{item.get('display_name', item.get('aspect', 'Khía cạnh'))}: {item.get('positive', 0)} lượt tích cực trên {item.get('mentions', 0)} lượt đề cập."
        for item in context.get("top_strengths", [])
    ]
    issues = [
        f"{item.get('display_name', item.get('aspect', 'Khía cạnh'))}: {item.get('negative', 0)} lượt tiêu cực trên {item.get('mentions', 0)} lượt đề cập ({item.get('negative_percent', 0)}%)."
        for item in context.get("alerts", [])
    ]
    caveats = [
        item["sample_note"]
        for item in context.get("alerts", [])
        if str(item.get("sample_note", "")).startswith("Mẫu nhỏ")
    ]
    return {
        "source": "template",
        "summary": (
            f"Kết quả ABSA ghi nhận {overall['mentions']} lượt khía cạnh, "
            f"trong đó {overall['positive_percent']}% tích cực và {overall['negative_percent']}% tiêu cực."
        ),
        "strengths": strengths,
        "issues": issues,
        "recommended_actions": [
            "Ưu tiên đọc các review bằng chứng ở những khía cạnh có cảnh báo.",
            "Không kết luận mạnh với khía cạnh có rất ít lượt đề cập.",
        ],
        "caveats": caveats,
    }


def _build_prompt(context: dict[str, Any]) -> str:
    return (
        "Bạn là chuyên gia phân tích review khách hàng. "
        "Chỉ sử dụng JSON ABSA được cung cấp, không tự bịa thêm thông tin. "
        "Viết tiếng Việt ngắn gọn, có nhắc rõ khi dữ liệu mẫu ít. "
        "Trả về JSON hợp lệ với các key: summary, strengths, issues, recommended_actions, caveats.\n\n"
        f"ABSA_JSON:\n{json.dumps(context, ensure_ascii=False)}"
    )


def generate_ollama_narrative(context: dict[str, Any], base_url: str, model: str, timeout_seconds: float = 45.0) -> dict[str, Any]:
    request = urllib.request.Request(
        url=base_url.rstrip("/") + "/api/generate",
        method="POST",
        data=json.dumps({"model": model, "prompt": _build_prompt(context), "stream": False}, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        payload = json.loads(response.read().decode("utf-8"))
    generated = json.loads(str(payload.get("response", "{}")).strip())
    return {"source": "ollama", **generated}


def generate_narrative(result: dict[str, Any], use_ollama: bool = True) -> dict[str, Any]:
    context = build_narrative_context(result)
    if not use_ollama:
        return generate_template_narrative(context)
    base_url = os.getenv("ABSA_OLLAMA_URL", "http://localhost:11434")
    model = os.getenv("ABSA_OLLAMA_MODEL", "llama3.2:3b")
    try:
        return generate_ollama_narrative(context, base_url=base_url, model=model)
    except (OSError, TimeoutError, urllib.error.URLError, json.JSONDecodeError, ValueError):
        return generate_template_narrative(context)
```

- [ ] **Step 4: Add FastAPI narrative endpoint**

Modify `review_absa_pipeline/service.py`:

```python
from .narrative import generate_narrative
```

Add this request model after `AnalyzeCSVRequest`:

```python
class NarrativeRequest(BaseModel):
    analysis_result: dict[str, Any]
    use_ollama: bool = True
```

Add this route before `return app`:

```python
    @app.post("/v1/narrative")
    def narrative(req: NarrativeRequest) -> dict[str, Any]:
        return generate_narrative(req.analysis_result, use_ollama=req.use_ollama)
```

- [ ] **Step 5: Run Python tests**

Run:

```bash
python -m unittest tests.test_review_absa_analysis -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add review_absa_pipeline/narrative.py review_absa_pipeline/service.py tests/test_review_absa_analysis.py
git commit -m "feat: add optional Ollama narrative generation"
```

---

## Task 4: Add Go Backend Narrative Proxy And Cache

**Files:**
- Create: `crawler/backend/internal/app/narrative.go`
- Modify: `crawler/backend/internal/app/analysis.go`
- Modify: `crawler/backend/internal/app/analyzer.go`
- Modify: `crawler/backend/internal/app/http_server.go`
- Modify: `crawler/backend/internal/app/analysis_test.go`

- [ ] **Step 1: Add failing cache lifecycle test**

Add this test to `crawler/backend/internal/app/analysis_test.go`:

```go
func TestAnalysisStoreNarrativeLifecycle(t *testing.T) {
	store := newAnalysisStore(t.TempDir())
	jobID := "job-1"
	payload := map[string]any{
		"source":  "template",
		"summary": "Kết quả ABSA rất tích cực.",
	}

	if err := store.SaveNarrative(jobID, payload); err != nil {
		t.Fatalf("SaveNarrative() error = %v", err)
	}

	got, err := store.Narrative(jobID)
	if err != nil {
		t.Fatalf("Narrative() error = %v", err)
	}
	if got["summary"] != payload["summary"] {
		t.Fatalf("summary = %v, want %v", got["summary"], payload["summary"])
	}

	if err := store.Delete(jobID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if _, err := store.Narrative(jobID); err == nil {
		t.Fatalf("Narrative() expected error after delete")
	}
}
```

- [ ] **Step 2: Run Go test to verify it fails**

Run:

```bash
go test ./crawler/backend/internal/app -run TestAnalysisStoreNarrativeLifecycle -v
```

Expected: fail because `SaveNarrative` and `Narrative` are undefined.

- [ ] **Step 3: Add narrative sidecar methods**

Modify `crawler/backend/internal/app/analysis.go`:

```go
func (s *analysisStore) Narrative(jobID string) (map[string]any, error) {
	path, err := s.narrativePath(jobID)
	if err != nil {
		return nil, err
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func (s *analysisStore) SaveNarrative(jobID string, payload map[string]any) error {
	path, err := s.narrativePath(jobID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), os.ModePerm); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func (s *analysisStore) narrativePath(jobID string) (string, error) {
	if err := validateSidecarJobID(jobID); err != nil {
		return "", err
	}
	return filepath.Join(s.dataFolder, jobID+".analysis.narrative.json"), nil
}
```

Update `Delete` so it removes the narrative sidecar:

```go
narrativePath, err := s.narrativePath(jobID)
if err != nil {
	return err
}

for _, path := range []string{statusPath, resultPath, narrativePath} {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
}
```

- [ ] **Step 4: Add Python-service narrative client**

Create `crawler/backend/internal/app/narrative.go`:

```go
package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type narrativeRequest struct {
	AnalysisResult map[string]any `json:"analysis_result"`
	UseOllama      bool           `json:"use_ollama"`
}

type narrativeRunner interface {
	generateNarrative(context.Context, map[string]any, bool) (map[string]any, error)
}

func (a *reviewAnalyzer) generateNarrative(ctx context.Context, analysisResult map[string]any, useOllama bool) (map[string]any, error) {
	serviceURL := strings.TrimRight(strings.TrimSpace(a.cfg.ABSAServiceURL), "/")
	if serviceURL == "" {
		return nil, fmt.Errorf("chưa cấu hình ABSA service URL")
	}
	parsed, err := url.Parse(serviceURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("ABSA service URL không hợp lệ")
	}

	body, err := json.Marshal(narrativeRequest{AnalysisResult: analysisResult, UseOllama: useOllama})
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, serviceURL+"/v1/narrative", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("không gọi được ABSA narrative service: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("ABSA narrative service trả lỗi %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}

	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("output narrative không hợp lệ: %w", err)
	}
	return payload, nil
}
```

- [ ] **Step 5: Register narrative route**

Modify `crawler/backend/internal/app/http_server.go`:

```go
handler.HandleFunc("/api/v1/jobs/{id}/analysis/narrative", ans.jobAnalysisNarrative)
```

Add handler:

```go
func (s *httpServer) jobAnalysisNarrative(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id, ok := parseJobID(r)
	if !ok {
		writeError(w, http.StatusUnprocessableEntity, "id không hợp lệ")
		return
	}

	if r.Method == http.MethodGet {
		narrative, err := s.analysisStore.Narrative(id)
		if err == nil {
			writeJSON(w, http.StatusOK, narrative)
			return
		}
	}

	status, err := s.analysisStore.Status(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if status.Status != analysisStatusOK {
		writeError(w, http.StatusConflict, "analysis chưa hoàn tất")
		return
	}

	result, err := s.analysisStore.Result(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	runner, ok := s.analyzer.(narrativeRunner)
	if !ok {
		writeError(w, http.StatusInternalServerError, "analyzer không hỗ trợ narrative")
		return
	}

	force := r.URL.Query().Get("force") == "1"
	useOllama := r.URL.Query().Get("ollama") != "0"
	if r.Method == http.MethodGet && !force {
		if narrative, err := s.analysisStore.Narrative(id); err == nil {
			writeJSON(w, http.StatusOK, narrative)
			return
		}
	}

	narrative, err := runner.generateNarrative(r.Context(), result, useOllama)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := s.analysisStore.SaveNarrative(id, narrative); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, narrative)
}
```

- [ ] **Step 6: Run Go tests**

Run:

```bash
go test ./crawler/backend/internal/app -v
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add crawler/backend/internal/app/analysis.go crawler/backend/internal/app/analyzer.go crawler/backend/internal/app/http_server.go crawler/backend/internal/app/narrative.go crawler/backend/internal/app/analysis_test.go
git commit -m "feat: proxy ABSA narrative generation"
```

---

## Task 5: Replace Score-First Aspect UI With Sentiment Display

**Files:**
- Create: `crawler/frontend/src/utils/aspectDisplay.js`
- Create: `crawler/frontend/src/components/SentimentBar.jsx`
- Modify: `crawler/frontend/src/App.jsx`
- Modify: `crawler/frontend/src/styles.css`

- [ ] **Step 1: Add frontend fallback helper**

Create `crawler/frontend/src/utils/aspectDisplay.js`:

```javascript
const GROUP_TRANSLATIONS = {
  AMBIENCE: "Không gian",
  DRINKS: "Đồ uống",
  FACILITIES: "Cơ sở vật chất",
  FOOD: "Đồ ăn",
  "FOOD&DRINKS": "Đồ ăn & thức uống",
  HOTEL: "Khách sạn",
  LOCATION: "Vị trí",
  RESTAURANT: "Nhà hàng",
  ROOMS: "Phòng",
  ROOM_AMENITIES: "Tiện ích phòng",
  SERVICE: "Dịch vụ"
};

const ATTRIBUTE_TRANSLATIONS = {
  CLEANLINESS: "Vệ sinh",
  COMFORT: "Sự thoải mái",
  "DESIGN&FEATURES": "Thiết kế & trang bị",
  GENERAL: "Tổng quan",
  MISCELLANEOUS: "Khác",
  PRICES: "Giá cả",
  QUALITY: "Chất lượng",
  "STYLE&OPTIONS": "Phong cách & lựa chọn"
};

export function aspectDisplayName(itemOrRaw) {
  if (itemOrRaw && typeof itemOrRaw === "object" && itemOrRaw.display_name) {
    return itemOrRaw.display_name;
  }
  const raw = String(typeof itemOrRaw === "string" ? itemOrRaw : itemOrRaw?.aspect || "").replace(/\\u0026/g, "&");
  const [group, attribute = ""] = raw.split("#");
  const groupName = GROUP_TRANSLATIONS[group] || group.replace(/_/g, " ");
  const attributeName = ATTRIBUTE_TRANSLATIONS[attribute] || attribute.replace(/_/g, " ");
  return attributeName ? `${groupName} - ${attributeName}` : groupName;
}
```

- [ ] **Step 2: Add sentiment bar component**

Create `crawler/frontend/src/components/SentimentBar.jsx`:

```jsx
function segmentPercent(value, total) {
  return total > 0 ? Math.max(0, Math.min(100, (Number(value || 0) / total) * 100)) : 0;
}

export function SentimentBar({ positive = 0, neutral = 0, negative = 0 }) {
  const total = Number(positive || 0) + Number(neutral || 0) + Number(negative || 0);
  const positivePercent = segmentPercent(positive, total);
  const neutralPercent = segmentPercent(neutral, total);
  const negativePercent = segmentPercent(negative, total);

  return (
    <div className="sentiment-summary">
      <div className="sentiment-bar" aria-label={`Tích cực ${positive}, trung lập ${neutral}, tiêu cực ${negative}`}>
        {positive > 0 && <span className="sentiment-segment positive" style={{ width: `${positivePercent}%` }} />}
        {neutral > 0 && <span className="sentiment-segment neutral" style={{ width: `${neutralPercent}%` }} />}
        {negative > 0 && <span className="sentiment-segment negative" style={{ width: `${negativePercent}%` }} />}
      </div>
      <div className="sentiment-counts">
        <span className="positive">{positive} tích cực</span>
        {neutral > 0 && <span className="neutral">{neutral} trung lập</span>}
        <span className="negative">{negative} tiêu cực</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update App.jsx imports**

Modify imports in `crawler/frontend/src/App.jsx`:

```jsx
import { SentimentBar } from "./components/SentimentBar";
import { aspectDisplayName } from "./utils/aspectDisplay";
```

- [ ] **Step 4: Replace score rendering in `InsightCards`**

Replace the first card in `InsightCards`:

```jsx
      <article>
        <span>Tổng quan cảm xúc</span>
        <strong>{percentText(overall.positive_percent)}</strong>
        <small>{overall.positive || 0} tích cực · {overall.negative || 0} tiêu cực</small>
      </article>
```

Keep the "Tỷ lệ tiêu cực", "Địa điểm", and "Lệch sao / nội dung" cards.

- [ ] **Step 5: Replace `AspectRows` score meter with sentiment bar**

Replace the body of `AspectRows` row rendering:

```jsx
          <article className="aspect-row" key={item.aspect}>
            <div className="aspect-label">
              <strong>{aspectDisplayName(item)}</strong>
              <small>{item.mentions || 0} lượt đề cập</small>
            </div>
            <SentimentBar
              positive={item.positive || 0}
              neutral={item.neutral || 0}
              negative={item.negative || 0}
            />
          </article>
```

- [ ] **Step 6: Replace aspect names in alert/evidence/place UI**

Change these usages:

```jsx
prettifyAspectName(item.aspect)
```

to:

```jsx
aspectDisplayName(item)
```

Change mapped raw aspect names in evidence footers:

```jsx
item.negative_aspects.map(prettifyAspectName).join(", ")
```

to:

```jsx
item.negative_aspects.map(aspectDisplayName).join(", ")
```

- [ ] **Step 7: Add sentiment CSS**

Add to `crawler/frontend/src/styles.css`:

```css
.sentiment-summary {
  display: grid;
  gap: 0.45rem;
  min-width: 220px;
}

.sentiment-bar {
  display: flex;
  height: 12px;
  overflow: hidden;
  border-radius: 999px;
  background: #e5e7eb;
}

.sentiment-segment.positive {
  background: #16a34a;
}

.sentiment-segment.neutral {
  background: #94a3b8;
}

.sentiment-segment.negative {
  background: #dc2626;
}

.sentiment-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  font-size: 0.82rem;
}

.sentiment-counts .positive {
  color: #15803d;
}

.sentiment-counts .neutral {
  color: #64748b;
}

.sentiment-counts .negative {
  color: #b91c1c;
}
```

- [ ] **Step 8: Run frontend build**

Run:

```bash
cd crawler/frontend
npm run build
```

Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git add crawler/frontend/src/App.jsx crawler/frontend/src/styles.css crawler/frontend/src/components/SentimentBar.jsx crawler/frontend/src/utils/aspectDisplay.js
git commit -m "feat: show ABSA sentiment distribution"
```

---

## Task 6: Add Narrative Panel To Frontend

**Files:**
- Create: `crawler/frontend/src/components/NarrativePanel.jsx`
- Modify: `crawler/frontend/src/api.js`
- Modify: `crawler/frontend/src/App.jsx`
- Modify: `crawler/frontend/src/styles.css`

- [ ] **Step 1: Add API function**

Modify `crawler/frontend/src/api.js`:

```javascript
export async function generateJobNarrative(id, { force = false, ollama = true } = {}) {
  const params = new URLSearchParams();
  if (force) params.set("force", "1");
  if (!ollama) params.set("ollama", "0");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${apiBase}/api/v1/jobs/${id}/analysis/narrative${suffix}`, {
    method: "POST"
  });
  return toJSON(response);
}
```

- [ ] **Step 2: Add narrative component**

Create `crawler/frontend/src/components/NarrativePanel.jsx`:

```jsx
import { useState } from "react";

export function NarrativePanel({ jobID, onGenerate }) {
  const [narrative, setNarrative] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleGenerate(force = false) {
    setLoading(true);
    setError("");
    try {
      const payload = await onGenerate(jobID, { force, ollama: true });
      setNarrative(payload);
    } catch (err) {
      setError(err.message || "Không thể tạo phân tích diễn giải");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="narrative-panel">
      <div className="section-heading">
        <div>
          <h3>Phân tích diễn giải</h3>
          <span>{narrative?.source === "ollama" ? "Sinh bởi Ollama từ kết quả ABSA" : "Không thay thế số liệu ABSA"}</span>
        </div>
        <button type="button" className="ghost-button" onClick={() => handleGenerate(Boolean(narrative))} disabled={loading}>
          {loading ? "Đang tạo..." : narrative ? "Tạo lại" : "Tạo phân tích"}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {narrative ? (
        <div className="narrative-content">
          <p>{narrative.summary}</p>
          {Array.isArray(narrative.strengths) && narrative.strengths.length > 0 && (
            <div>
              <strong>Điểm mạnh</strong>
              <ul>{narrative.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {Array.isArray(narrative.issues) && narrative.issues.length > 0 && (
            <div>
              <strong>Vấn đề cần theo dõi</strong>
              <ul>{narrative.issues.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {Array.isArray(narrative.caveats) && narrative.caveats.length > 0 && (
            <p className="narrative-caveat">{narrative.caveats.join(" ")}</p>
          )}
        </div>
      ) : (
        <p className="empty-analysis">Nhấn "Tạo phân tích" để Ollama diễn giải kết quả ABSA hiện có.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Wire narrative panel into dashboard**

Modify imports in `crawler/frontend/src/App.jsx`:

```jsx
import { NarrativePanel } from "./components/NarrativePanel";
import { analyzeJobCsv, createJob, deleteJob, downloadJobCsv, fetchJobAnalysis, fetchJobs, generateJobNarrative } from "./api";
```

Add after `<InsightCards result={result} />`:

```jsx
      <NarrativePanel jobID={jobID} onGenerate={generateJobNarrative} />
```

- [ ] **Step 4: Add narrative styles**

Add to `crawler/frontend/src/styles.css`:

```css
.narrative-panel {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
  padding: 1rem;
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  background: #f8fafc;
}

.narrative-content {
  display: grid;
  gap: 0.85rem;
  line-height: 1.6;
}

.narrative-content p,
.narrative-content ul {
  margin: 0;
}

.narrative-content ul {
  padding-left: 1.2rem;
}

.narrative-caveat {
  color: #92400e;
  font-size: 0.9rem;
}
```

- [ ] **Step 5: Run frontend build**

Run:

```bash
cd crawler/frontend
npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add crawler/frontend/src/api.js crawler/frontend/src/App.jsx crawler/frontend/src/components/NarrativePanel.jsx crawler/frontend/src/styles.css
git commit -m "feat: add ABSA narrative panel"
```

---

## Task 7: End-To-End Verification

**Files:**
- No source files unless verification finds a defect.

- [ ] **Step 1: Run Python tests**

Run:

```bash
python -m unittest tests.test_review_absa_analysis -v
```

Expected: all tests pass.

- [ ] **Step 2: Run Go tests**

Run:

```bash
go test ./crawler/backend/internal/app -v
```

Expected: all tests pass.

- [ ] **Step 3: Run frontend build**

Run:

```bash
cd crawler/frontend
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Manual smoke without Ollama**

Run the ABSA service and backend normally, then open a completed job analysis. Click `Tạo phân tích`.

Expected:
- Dashboard still shows sentiment distribution even if Ollama is not running.
- Narrative panel returns a `source: template` interpretation.
- No score is shown as the main aspect evaluation.
- Low-sample alerts show the sample note.

- [ ] **Step 5: Manual smoke with Ollama**

Run:

```bash
ollama serve
ollama pull llama3.2:3b
```

Then click `Tạo lại` in the narrative panel.

Expected:
- Narrative panel returns `source: ollama`.
- Summary is Vietnamese.
- It does not invent facts outside the displayed ABSA data.
- It mentions low sample size when the selected alerts have few mentions.

- [ ] **Step 6: Commit verification fixes if needed**

If any defect is fixed during verification:

```bash
git add <changed-files>
git commit -m "fix: stabilize ABSA display verification"
```

---

## Self-Review Checklist

- [x] The plan keeps Ollama as an optional narrative section, not a replacement for current ABSA metrics.
- [x] The plan removes score-first UI from aspect display and replaces it with positive/neutral/negative counts.
- [x] The plan adds Vietnamese aspect names through backend metadata, with frontend fallback for older JSON.
- [x] The plan fixes misleading low-sample negative alerts.
- [x] The plan fixes `rating=0` being counted as a real rating.
- [x] The plan includes tests before implementation for Python and Go behavior.
- [x] The plan includes frontend build verification and manual Ollama/no-Ollama smoke checks.

---

## Execution Handoff

Plan complete and saved to `plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
