from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REVIEW_COLUMNS = ("user_review", "user_reviews_extended", "user_reviews")
DESCRIPTION_KEYS = ("Description", "description", "Text", "text", "Review", "review")


@dataclass
class ReviewRecord:
    text: str
    rating: int | None = None
    when: str = ""
    reviewer_name: str = ""
    source_column: str = ""


@dataclass
class PlaceReviewBatch:
    input_id: str
    title: str
    source_column: str
    descriptions: list[str]
    category: str = ""
    address: str = ""
    reviews: list[ReviewRecord] = field(default_factory=list)


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


def _rating_from_review(review: dict[str, Any]) -> int | None:
    raw_rating = review.get("Rating", review.get("rating"))
    if raw_rating is None or raw_rating == "":
        return None
    try:
        return int(float(str(raw_rating).strip()))
    except (TypeError, ValueError):
        return None


def _text_from_review(record: ReviewRecord | dict[str, Any] | str) -> str:
    if isinstance(record, ReviewRecord):
        return record.text
    if isinstance(record, dict):
        return _description_from_review(record) or ""
    return _normalize_description(record) or ""


def _review_record_from_item(item: Any, source_column: str) -> ReviewRecord | None:
    if isinstance(item, dict):
        description = _description_from_review(item)
        if not description:
            return None
        return ReviewRecord(
            text=description,
            rating=_rating_from_review(item),
            when=str(item.get("When") or item.get("when") or "").strip(),
            reviewer_name=str(item.get("Name") or item.get("name") or "").strip(),
            source_column=source_column,
        )

    description = _normalize_description(item)
    if not description:
        return None
    return ReviewRecord(text=description, source_column=source_column)


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


def _review_records_from_column(raw_value: Any, source_column: str) -> list[ReviewRecord]:
    if raw_value is None:
        return []
    text = str(raw_value).strip()
    if not text or text.lower() == "null":
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        record = _review_record_from_item(text, source_column)
        return [record] if record else []

    if isinstance(parsed, (str, dict)):
        record = _review_record_from_item(parsed, source_column)
        return [record] if record else []

    if not isinstance(parsed, list):
        return []

    records: list[ReviewRecord] = []
    for item in parsed:
        record = _review_record_from_item(item, source_column)
        if record:
            records.append(record)
    return records


def load_place_review_batches(csv_path: str | Path) -> list[PlaceReviewBatch]:
    csv_path = Path(csv_path)
    results: list[PlaceReviewBatch] = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            reviews: list[ReviewRecord] = []
            source_column = ""
            for column in REVIEW_COLUMNS:
                reviews = _review_records_from_column(row.get(column, ""), column)
                if reviews:
                    source_column = column
                    break
            if not reviews:
                continue
            descriptions = [_text_from_review(review) for review in reviews]
            results.append(
                PlaceReviewBatch(
                    input_id=str(row.get("input_id", "")).strip(),
                    title=str(row.get("title") or row.get("name") or "").strip(),
                    source_column=source_column,
                    descriptions=descriptions,
                    category=str(row.get("category", "")).strip(),
                    address=str(row.get("address", "")).strip(),
                    reviews=reviews,
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
            "negative_rate": round(negative_percent, 2),
            "priority_score": round(neg * max(1.0, negative_percent), 2),
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
