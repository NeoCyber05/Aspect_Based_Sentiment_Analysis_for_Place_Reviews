from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REVIEW_COLUMNS = ("user_review", "user_reviews_extended", "user_reviews")
DESCRIPTION_KEYS = ("Description", "description", "Text", "text", "Review", "review")


@dataclass
class PlaceReviewBatch:
    input_id: str
    title: str
    source_column: str
    descriptions: list[str]


def _normalize_description(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() == "null":
        return None
    return text


def _description_from_review(review: dict[str, Any]) -> str | None:
    for key in DESCRIPTION_KEYS:
        description = _normalize_description(review.get(key))
        if description:
            return description
    return None


def _descriptions_from_column(raw_value: Any) -> list[str]:
    if raw_value is None:
        return []
    text = str(raw_value).strip()
    if not text or text.lower() == "null":
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return [text]

    if isinstance(parsed, str):
        description = _normalize_description(parsed)
        return [description] if description else []

    if isinstance(parsed, dict):
        description = _description_from_review(parsed)
        return [description] if description else []

    if not isinstance(parsed, list):
        return []

    descriptions: list[str] = []
    for item in parsed:
        if isinstance(item, dict):
            description = _description_from_review(item)
        else:
            description = _normalize_description(item)
        if description:
            descriptions.append(description)
    return descriptions


def load_place_review_batches(csv_path: str | Path) -> list[PlaceReviewBatch]:
    csv_path = Path(csv_path)
    results: list[PlaceReviewBatch] = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            descriptions: list[str] = []
            source_column = ""
            for column in REVIEW_COLUMNS:
                descriptions = _descriptions_from_column(row.get(column, ""))
                if descriptions:
                    source_column = column
                    break
            if not descriptions:
                continue
            results.append(
                PlaceReviewBatch(
                    input_id=str(row.get("input_id", "")).strip(),
                    title=str(row.get("title") or row.get("name") or "").strip(),
                    source_column=source_column,
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


def aspect_rows(summary: dict[str, dict[str, float | int]]) -> list[dict[str, float | int | str]]:
    return [
        {"aspect": aspect, **metrics}
        for aspect, metrics in sorted(
            summary.items(),
            key=lambda item: (int(item[1]["mentions"]), float(item[1]["score_5"])),
            reverse=True,
        )
    ]


def summarize_overall(summary: dict[str, dict[str, float | int]]) -> dict[str, float | int]:
    positive = sum(int(metrics["positive"]) for metrics in summary.values())
    neutral = sum(int(metrics["neutral"]) for metrics in summary.values())
    negative = sum(int(metrics["negative"]) for metrics in summary.values())
    mentions = positive + neutral + negative

    if mentions > 0:
        positive_percent = positive * 100.0 / mentions
        neutral_percent = neutral * 100.0 / mentions
        negative_percent = negative * 100.0 / mentions
        score_5 = (positive * 5.0 + neutral * 3.0 + negative * 1.0) / mentions
    else:
        positive_percent = neutral_percent = negative_percent = 0.0
        score_5 = 0.0

    return {
        "mentions": mentions,
        "positive": positive,
        "neutral": neutral,
        "negative": negative,
        "positive_percent": round(positive_percent, 2),
        "neutral_percent": round(neutral_percent, 2),
        "negative_percent": round(negative_percent, 2),
        "score_5": round(score_5, 2),
        "score_percent": round(score_5 * 20.0, 2),
    }
