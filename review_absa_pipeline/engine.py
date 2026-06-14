from __future__ import annotations

from pathlib import Path
from typing import Any

from .domain import DomainRouter, ExternalDomainRouter
from .insights import build_analysis_result
from .model_manager import ModelManager
from .pipeline import PlaceReviewBatch, ReviewRecord, load_place_review_batches


def _route_to_dict(route: Any) -> dict[str, Any]:
    if hasattr(route, "to_dict"):
        return route.to_dict()
    if isinstance(route, dict):
        return route
    return {
        "domain": str(getattr(route, "domain", "")),
        "confidence": float(getattr(route, "confidence", 0.0)),
        "source": str(getattr(route, "source", "")),
        "fallback": bool(getattr(route, "fallback", False)),
    }


class AnalysisEngine:
    def __init__(
        self,
        model_manager: Any | None = None,
        domain_router: DomainRouter | None = None,
    ) -> None:
        self.model_manager = model_manager or ModelManager()
        self.domain_router = domain_router or ExternalDomainRouter()

    def analyze_csv(self, job_id: str, csv_path: str | Path, force: bool = False) -> dict[str, Any]:
        del force
        batches = load_place_review_batches(csv_path)
        place_results = [self._analyze_place(batch) for batch in batches]

        domains = {
            str(place["domain"].get("domain", "restaurant"))
            for place in place_results
        }
        model_repo_ids = {
            domain: self.model_manager.model_repo_id(domain)
            for domain in sorted(domains)
        }
        return build_analysis_result(
            job_id=job_id,
            model_repo_ids=model_repo_ids,
            place_results=place_results,
        )

    def _analyze_place(self, batch: PlaceReviewBatch) -> dict[str, Any]:
        route = self.domain_router.route(batch)
        route_dict = _route_to_dict(route)
        domain = str(route_dict.get("domain", "restaurant"))
        predictions = self.model_manager.predict(domain, batch.descriptions)
        reviews = [
            self._review_payload(review, predictions[index] if index < len(predictions) else {})
            for index, review in enumerate(batch.reviews)
        ]
        return {
            "input_id": batch.input_id,
            "title": batch.title,
            "category": batch.category,
            "address": batch.address,
            "source_column": batch.source_column,
            "domain": route_dict,
            "reviews": reviews,
            "review_count": batch.review_count,
            "review_rating": batch.review_rating,
            "reviews_per_rating": batch.reviews_per_rating,
            "open_hours": batch.open_hours,
            "latitude": batch.latitude,
            "longitude": batch.longitude,
        }

    @staticmethod
    def _review_payload(review: ReviewRecord, prediction: dict[str, str | None]) -> dict[str, Any]:
        return {
            "text": review.text,
            "rating": review.rating,
            "when": review.when,
            "reviewer_name": review.reviewer_name,
            "source_column": review.source_column,
            "prediction": prediction,
        }
