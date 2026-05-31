from __future__ import annotations

import csv
import json
import tempfile
import unittest
from pathlib import Path

from review_absa_pipeline.domain import DomainRoute, RuleBasedDomainRouter
from review_absa_pipeline.engine import AnalysisEngine
from review_absa_pipeline.insights import build_analysis_result
from review_absa_pipeline.pipeline import load_place_review_batches


class FakeModelManager:
    def __init__(self, predictions_by_domain: dict[str, list[dict[str, str | None]]]) -> None:
        self.predictions_by_domain = predictions_by_domain
        self.calls: list[tuple[str, list[str]]] = []

    def predict(self, domain: str, reviews: list[str]) -> list[dict[str, str | None]]:
        self.calls.append((domain, list(reviews)))
        predictions = self.predictions_by_domain[domain]
        return predictions[: len(reviews)]

    def model_repo_id(self, domain: str) -> str:
        return f"repo/{domain}"


class FixedRouter:
    def __init__(self, domain: str, confidence: float = 0.91) -> None:
        self.domain = domain
        self.confidence = confidence

    def route(self, place) -> DomainRoute:
        return DomainRoute(
            domain=self.domain,
            confidence=self.confidence,
            source="fixed",
            fallback=False,
        )


def write_crawled_csv(path: Path) -> None:
    rows = [
        {
            "input_id": "place-1",
            "title": "Cafe Test",
            "category": "Cafe",
            "address": "Ha Noi",
            "user_reviews": json.dumps(
                [
                    {
                        "Name": "Anh",
                        "Rating": 1,
                        "Description": "Service was slow and staff ignored us",
                        "When": "2026-01-02",
                    },
                    {
                        "Name": "Binh",
                        "Rating": 5,
                        "Description": "",
                        "When": "2026-01-03",
                    },
                ],
                ensure_ascii=False,
            ),
            "user_reviews_extended": "",
        }
    ]
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=[
                "input_id",
                "title",
                "category",
                "address",
                "user_reviews",
                "user_reviews_extended",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)


class ReviewAnalysisTests(unittest.TestCase):
    def test_loader_preserves_review_metadata_and_skips_empty_descriptions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "reviews.csv"
            write_crawled_csv(csv_path)

            batches = load_place_review_batches(csv_path)

        self.assertEqual(len(batches), 1)
        self.assertEqual(batches[0].category, "Cafe")
        self.assertEqual(batches[0].address, "Ha Noi")
        self.assertEqual(batches[0].descriptions, ["Service was slow and staff ignored us"])
        self.assertEqual(len(batches[0].reviews), 1)
        self.assertEqual(batches[0].reviews[0].rating, 1)
        self.assertEqual(batches[0].reviews[0].when, "2026-01-02")
        self.assertEqual(batches[0].reviews[0].reviewer_name, "Anh")

    def test_rule_based_router_returns_domain_confidence_and_fallback_flag(self) -> None:
        router = RuleBasedDomainRouter(default_domain="restaurant")

        route = router.route(type("Place", (), {"title": "ABC Hotel", "category": "Khach san"})())
        fallback = router.route(type("Place", (), {"title": "Unknown", "category": "Store"})())

        self.assertEqual(route.domain, "hotel")
        self.assertGreater(route.confidence, 0.8)
        self.assertFalse(route.fallback)
        self.assertEqual(fallback.domain, "restaurant")
        self.assertLess(fallback.confidence, 0.6)
        self.assertTrue(fallback.fallback)

    def test_insights_include_alerts_evidence_and_rating_mismatch(self) -> None:
        place_result = {
            "input_id": "place-1",
            "title": "Cafe Test",
            "domain": {"domain": "restaurant", "confidence": 0.93, "source": "fixed", "fallback": False},
            "reviews": [
                {
                    "text": "Great food but rude service",
                    "rating": 5,
                    "when": "2026-01-02",
                    "prediction": {"SERVICE#GENERAL": "negative", "FOOD#QUALITY": "positive"},
                }
            ],
        }

        result = build_analysis_result(
            job_id="job-1",
            model_repo_ids={"restaurant": "repo/restaurant"},
            place_results=[place_result],
        )

        self.assertEqual(result["job_id"], "job-1")
        self.assertEqual(result["overall"]["mentions"], 2)
        self.assertEqual(result["domain_summary"]["domains"]["restaurant"]["place_count"], 1)
        self.assertEqual(result["alerts"][0]["aspect"], "SERVICE#GENERAL")
        self.assertEqual(result["places"][0]["top_negative_aspects"][0]["aspect"], "SERVICE#GENERAL")
        self.assertEqual(result["places"][0]["evidence"][0]["rating"], 5)
        self.assertEqual(result["rating_vs_text"]["mismatch_count"], 1)

    def test_analysis_engine_routes_places_and_batches_predictions_by_domain(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "reviews.csv"
            write_crawled_csv(csv_path)

            engine = AnalysisEngine(
                model_manager=FakeModelManager(
                    {
                        "restaurant": [
                            {
                                "SERVICE#GENERAL": "negative",
                                "FOOD#QUALITY": None,
                            }
                        ]
                    }
                ),
                domain_router=FixedRouter("restaurant"),
            )

            result = engine.analyze_csv(job_id="job-1", csv_path=csv_path)

        self.assertEqual(result["job_id"], "job-1")
        self.assertEqual(result["description_count"], 1)
        self.assertEqual(result["places"][0]["domain"]["domain"], "restaurant")
        self.assertEqual(result["places"][0]["top_negative_aspects"][0]["aspect"], "SERVICE#GENERAL")


if __name__ == "__main__":
    unittest.main()
