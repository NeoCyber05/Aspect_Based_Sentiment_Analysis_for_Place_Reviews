from __future__ import annotations

import csv
import json
import tempfile
import unittest
from pathlib import Path

from review_absa_pipeline.aspect_metadata import enrich_aspect_row, translate_aspect
from review_absa_pipeline.domain import DomainRoute, RuleBasedDomainRouter
from review_absa_pipeline.engine import AnalysisEngine
from review_absa_pipeline.insights import build_analysis_result
from review_absa_pipeline.narrative import build_narrative_context, generate_template_narrative
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


class AspectMetadataTests(unittest.TestCase):
    def test_translate_known_hotel_aspect_to_vietnamese(self) -> None:
        metadata = translate_aspect("ROOM_AMENITIES#DESIGN&FEATURES", domain="hotel")

        self.assertEqual(metadata["display_name"], "Tiện ích phòng - Thiết kế & trang bị")
        self.assertEqual(metadata["group_name"], "Tiện ích phòng")
        self.assertEqual(metadata["attribute_name"], "Thiết kế & trang bị")
        self.assertEqual(metadata["domain"], "hotel")

    def test_unknown_aspect_keeps_raw_key_but_normalizes_separator(self) -> None:
        metadata = translate_aspect("UNKNOWN#MYSTERY", domain="restaurant")

        self.assertEqual(metadata["display_name"], "UNKNOWN - MYSTERY")
        self.assertEqual(metadata["group_name"], "UNKNOWN")
        self.assertEqual(metadata["attribute_name"], "MYSTERY")
        self.assertEqual(metadata["raw_name"], "UNKNOWN#MYSTERY")

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


if __name__ == "__main__":
    unittest.main()
