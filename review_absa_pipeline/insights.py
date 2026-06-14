from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from .aspect_metadata import enrich_aspect_row, translate_aspect
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
            rating = _valid_rating(review.get("rating"))
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


def _dominant_domain(place_results: list[dict[str, Any]]) -> str:
    counts: dict[str, int] = defaultdict(int)
    for place in place_results:
        domain = str((place.get("domain") or {}).get("domain", ""))
        if domain:
            counts[domain] += 1
    if not counts:
        return ""
    return sorted(counts.items(), key=lambda item: item[1], reverse=True)[0][0]


def _global_review_rating_mean(place_results: list[dict[str, Any]]) -> float:
    values = [
        float(place["review_rating"])
        for place in place_results
        if place.get("review_rating") is not None and float(place["review_rating"]) > 0
    ]
    if not values:
        return 3.5
    return sum(values) / len(values)


def _rating_distribution_std(reviews_per_rating: dict[str, int]) -> float:
    total = sum(reviews_per_rating.values())
    if total == 0:
        return 0.0
    mean = sum(int(rating) * count for rating, count in reviews_per_rating.items()) / total
    variance = sum(count * (int(rating) - mean) ** 2 for rating, count in reviews_per_rating.items()) / total
    return variance ** 0.5


def _adjusted_avg_rating(
    review_rating: float | None,
    review_count: int | None,
    reviews_per_rating: dict[str, int],
    global_mean: float,
    prior_count: int = 20,
) -> float | None:
    if review_rating is None or review_count is None or review_count <= 0:
        return None

    # Bayesian average to shrink low-review places toward global mean
    smoothed = (review_rating * review_count + global_mean * prior_count) / (review_count + prior_count)

    # Controversy penalty: high variance in reviews_per_rating lowers the score slightly
    std = _rating_distribution_std(reviews_per_rating)
    penalty = min(0.3, 0.12 * max(0.0, std - 0.8))

    return round(max(0.0, min(5.0, smoothed - penalty)), 2)


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


def build_analysis_result(
    job_id: str,
    model_repo_ids: dict[str, str],
    place_results: list[dict[str, Any]],
) -> dict[str, Any]:
    all_predictions: list[dict[str, str | None]] = []
    places: list[dict[str, Any]] = []
    global_review_mean = _global_review_rating_mean(place_results)

    for place in place_results:
        reviews = place.get("reviews", [])
        predictions = [review.get("prediction") or {} for review in reviews]
        all_predictions.extend(predictions)

        domain_name = str((place.get("domain") or {}).get("domain", ""))
        summary = summarize_aspects(predictions)
        aspects = [enrich_aspect_row(item, domain=domain_name) for item in aspect_rows(summary)]
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
                "title": place.get("title", ""),
                "category": place.get("category", ""),
                "domain": place.get("domain", {}),
                "description_count": len(reviews),
                "overall": summarize_overall(summary),
                "aspect_summary": summary,
                "aspects": aspects,
                "top_positive_aspects": top_positive,
                "top_negative_aspects": top_negative,
                "evidence": _place_evidence(reviews),
                "review_count": place.get("review_count"),
                "review_rating": place.get("review_rating"),
                "reviews_per_rating": place.get("reviews_per_rating", {}),
                "open_hours": place.get("open_hours", {}),
                "latitude": place.get("latitude"),
                "longitude": place.get("longitude"),
                "adjusted_avg_rating": _adjusted_avg_rating(
                    place.get("review_rating"),
                    place.get("review_count"),
                    place.get("reviews_per_rating", {}),
                    global_review_mean,
                ),
            }
        )

    global_summary = summarize_aspects(all_predictions)
    global_domain = _dominant_domain(place_results)
    global_aspects = [enrich_aspect_row(item, domain=global_domain) for item in aspect_rows(global_summary)]
    adjusted_ratings = [p["adjusted_avg_rating"] for p in places if p["adjusted_avg_rating"] is not None]
    global_adjusted_avg = round(sum(adjusted_ratings) / len(adjusted_ratings), 2) if adjusted_ratings else 0.0
    total_review_count = sum(p["review_count"] or 0 for p in places)

    # Sort places by adjusted average rating descending for ranking
    places.sort(
        key=lambda p: (
            p["adjusted_avg_rating"] if p["adjusted_avg_rating"] is not None else 0,
            p["review_count"] or 0,
        ),
        reverse=True,
    )

    return {
        "job_id": job_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_repo_ids": model_repo_ids,
        "place_count": len(places),
        "description_count": len(all_predictions),
        "total_review_count": total_review_count,
        "global_review_rating_mean": round(global_review_mean, 2),
        "global_adjusted_avg_rating": global_adjusted_avg,
        "overall": summarize_overall(global_summary),
        "domain_summary": _domain_summary(place_results),
        "aspect_summary": global_summary,
        "aspects": global_aspects,
        "alerts": _alerts(global_aspects),
        "rating_vs_text": _rating_mismatches(place_results),
        "places": places,
    }
