from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class PlaceReviewBatch:
    input_id: str
    title: str
    descriptions: list[str]


def _to_reviews(raw_value: str) -> list[dict[str, Any]]:
    if raw_value is None:
        return []
    text = str(raw_value).strip()
    if not text or text.lower() == "null":
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict)]


def _normalize_description(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() == "null":
        return None
    return text


def load_place_review_batches(csv_path: str | Path) -> list[PlaceReviewBatch]:
    csv_path = Path(csv_path)
    results: list[PlaceReviewBatch] = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            raw_reviews = row.get("user_reviews_extended", "")
            reviews = _to_reviews(raw_reviews)
            descriptions = []
            for review in reviews:
                description = _normalize_description(review.get("Description"))
                if description:
                    descriptions.append(description)
            if not descriptions:
                continue
            results.append(
                PlaceReviewBatch(
                    input_id=str(row.get("input_id", "")).strip(),
                    title=str(row.get("title", "")).strip(),
                    descriptions=descriptions,
                )
            )
    return results


def summarize_aspects(predictions: list[dict[str, str | None]]) -> dict[str, dict[str, float | int]]:
    per_aspect_counter: dict[str, Counter[str]] = defaultdict(Counter)

    for row in predictions:
        for aspect, polarity in row.items():
            label = polarity or "none"
            per_aspect_counter[aspect][label] += 1

    summary: dict[str, dict[str, float | int]] = {}
    for aspect, counts in per_aspect_counter.items():
        total = sum(counts.values())
        mentioned = total - counts["none"]
        pos = counts["positive"]
        neg = counts["negative"]
        neu = counts["neutral"]

        if mentioned > 0:
            positive_percent = pos * 100.0 / mentioned
            neutral_percent = neu * 100.0 / mentioned
            negative_percent = neg * 100.0 / mentioned
            score_5 = (pos * 5.0 + neu * 3.0 + neg * 1.0) / mentioned
        else:
            positive_percent = neutral_percent = negative_percent = 0.0
            score_5 = 0.0

        summary[aspect] = {
            "mentions": int(mentioned),
            "positive": int(pos),
            "neutral": int(neu),
            "negative": int(neg),
            "positive_percent": round(positive_percent, 2),
            "neutral_percent": round(neutral_percent, 2),
            "negative_percent": round(negative_percent, 2),
            "score_5": round(score_5, 2),
            "score_percent": round(score_5 * 20.0, 2),
        }
    return summary

