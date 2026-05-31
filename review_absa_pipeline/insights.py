from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from .pipeline import aspect_rows, summarize_aspects, summarize_overall


def _prediction_counts(prediction: dict[str, str | None]) -> dict[str, int]:
    counts = {"positive": 0, "neutral": 0, "negative": 0}
    for polarity in prediction.values():
        if polarity in counts:
            counts[polarity] += 1
    return counts


def _negative_aspects(prediction: dict[str, str | None]) -> list[str]:
    return [aspect for aspect, polarity in prediction.items() if polarity == "negative"]


def _positive_aspects(prediction: dict[str, str | None]) -> list[str]:
    return [aspect for aspect, polarity in prediction.items() if polarity == "positive"]


def _place_evidence(reviews: list[dict[str, Any]], limit: int = 5) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    for review in reviews:
        prediction = review.get("prediction") or {}
        negatives = _negative_aspects(prediction)
        if not negatives:
            continue
        evidence.append(
            {
                "text": review.get("text", ""),
                "rating": review.get("rating"),
                "when": review.get("when", ""),
                "reviewer_name": review.get("reviewer_name", ""),
                "negative_aspects": negatives,
                "positive_aspects": _positive_aspects(prediction),
            }
        )
        if len(evidence) >= limit:
            break
    return evidence


def _rating_mismatches(place_results: list[dict[str, Any]], limit: int = 10) -> dict[str, Any]:
    examples: list[dict[str, Any]] = []
    total_with_rating = 0
    for place in place_results:
        for review in place.get("reviews", []):
            rating = review.get("rating")
            if rating is None:
                continue
            total_with_rating += 1
            counts = _prediction_counts(review.get("prediction") or {})
            high_rating_negative = rating >= 4 and counts["negative"] > 0
            low_rating_positive = rating <= 2 and counts["positive"] > 0
            if not high_rating_negative and not low_rating_positive:
                continue
            examples.append(
                {
                    "input_id": place.get("input_id", ""),
                    "title": place.get("title", ""),
                    "rating": rating,
                    "text": review.get("text", ""),
                    "negative_aspects": _negative_aspects(review.get("prediction") or {}),
                    "positive_aspects": _positive_aspects(review.get("prediction") or {}),
                }
            )
    return {
        "total_with_rating": total_with_rating,
        "mismatch_count": len(examples),
        "examples": examples[:limit],
    }


def _domain_summary(place_results: list[dict[str, Any]]) -> dict[str, Any]:
    domains: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "place_count": 0,
            "review_count": 0,
            "confidence_total": 0.0,
            "fallback_count": 0,
        }
    )
    low_confidence: list[dict[str, Any]] = []

    for place in place_results:
        domain = place.get("domain") or {}
        domain_name = str(domain.get("domain", "unknown"))
        confidence = float(domain.get("confidence", 0.0) or 0.0)
        entry = domains[domain_name]
        entry["place_count"] += 1
        entry["review_count"] += len(place.get("reviews", []))
        entry["confidence_total"] += confidence
        if domain.get("fallback"):
            entry["fallback_count"] += 1
        if confidence < 0.6 or domain.get("fallback"):
            low_confidence.append(
                {
                    "input_id": place.get("input_id", ""),
                    "title": place.get("title", ""),
                    "domain": domain_name,
                    "confidence": round(confidence, 3),
                    "source": domain.get("source", ""),
                }
            )

    normalized: dict[str, dict[str, Any]] = {}
    for domain_name, entry in domains.items():
        place_count = int(entry["place_count"])
        normalized[domain_name] = {
            "place_count": place_count,
            "review_count": int(entry["review_count"]),
            "avg_confidence": round(float(entry["confidence_total"]) / max(1, place_count), 3),
            "fallback_count": int(entry["fallback_count"]),
        }

    return {
        "domains": normalized,
        "low_confidence": low_confidence,
    }


def _alerts(global_aspects: list[dict[str, Any]], limit: int = 8) -> list[dict[str, Any]]:
    candidates = [
        aspect
        for aspect in global_aspects
        if int(aspect.get("negative", 0) or 0) > 0 and float(aspect.get("negative_percent", 0.0) or 0.0) >= 25.0
    ]
    candidates.sort(
        key=lambda item: (
            float(item.get("priority_score", 0.0) or 0.0),
            int(item.get("mentions", 0) or 0),
        ),
        reverse=True,
    )
    return [
        {
            "aspect": item["aspect"],
            "mentions": item["mentions"],
            "negative": item["negative"],
            "negative_percent": item["negative_percent"],
            "priority_score": item.get("priority_score", 0.0),
        }
        for item in candidates[:limit]
    ]


def build_analysis_result(
    job_id: str,
    model_repo_ids: dict[str, str],
    place_results: list[dict[str, Any]],
) -> dict[str, Any]:
    all_predictions: list[dict[str, str | None]] = []
    places: list[dict[str, Any]] = []

    for place in place_results:
        reviews = place.get("reviews", [])
        predictions = [review.get("prediction") or {} for review in reviews]
        all_predictions.extend(predictions)

        summary = summarize_aspects(predictions)
        aspects = aspect_rows(summary)
        top_negative = [
            item
            for item in aspects
            if int(item.get("negative", 0) or 0) > 0
        ][:5]
        top_positive = [
            item
            for item in aspects
            if int(item.get("positive", 0) or 0) > 0
        ][:5]

        places.append(
            {
                "input_id": place.get("input_id", ""),
                "title": place.get("title", ""),
                "category": place.get("category", ""),
                "address": place.get("address", ""),
                "domain": place.get("domain", {}),
                "description_count": len(reviews),
                "overall": summarize_overall(summary),
                "aspect_summary": summary,
                "aspects": aspects,
                "top_positive_aspects": top_positive,
                "top_negative_aspects": top_negative,
                "evidence": _place_evidence(reviews),
            }
        )

    global_summary = summarize_aspects(all_predictions)
    global_aspects = aspect_rows(global_summary)
    return {
        "job_id": job_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_repo_ids": model_repo_ids,
        "place_count": len(places),
        "description_count": len(all_predictions),
        "overall": summarize_overall(global_summary),
        "domain_summary": _domain_summary(place_results),
        "aspect_summary": global_summary,
        "aspects": global_aspects,
        "alerts": _alerts(global_aspects),
        "rating_vs_text": _rating_mismatches(place_results),
        "places": places,
    }
