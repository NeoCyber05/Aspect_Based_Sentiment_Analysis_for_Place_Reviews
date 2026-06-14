from __future__ import annotations

import csv
import json
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

from review_absa_pipeline.aspect_metadata import enrich_aspect_row, translate_aspect
from review_absa_pipeline.domain import DomainRoute, RuleBasedDomainRouter, SklearnDomainRouter
from review_absa_pipeline.engine import AnalysisEngine
from review_absa_pipeline.insights import build_analysis_result
from review_absa_pipeline.model_manager import ModelManager
from review_absa_pipeline.narrative import build_narrative_context, generate_template_narrative
from review_absa_pipeline.pipeline import load_place_review_batches
from review_absa_pipeline.preprocess import TextPreprocessor
from review_absa_pipeline.run_from_csv import build_parser


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
            "title": "Cafe Test",
            "category": "Cafe",
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
                "title",
                "category",
                "user_reviews",
                "user_reviews_extended",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)


def write_router_model(path: Path) -> None:
    training_rows = pd.DataFrame(
        [
            {"title": "Khach san Bien Nho", "category": "Khach san", "domain": "hotel"},
            {"title": "Resort Song Xanh", "category": "Resort", "domain": "hotel"},
            {"title": "Benh vien Thanh Cong", "category": "Benh vien", "domain": "hospital"},
            {"title": "Phong kham Minh Tam", "category": "Phong kham", "domain": "hospital"},
            {"title": "Quan Pho 24", "category": "Nha hang", "domain": "restaurant"},
            {"title": "Cafe Pho Co", "category": "Cafe", "domain": "restaurant"},
            {"title": "Dai hoc Bach Khoa", "category": "Truong dai hoc", "domain": "university"},
            {"title": "Cao dang Cong nghe", "category": "Truong cao dang", "domain": "university"},
        ]
    )
    features = ColumnTransformer(
        transformers=[
            (
                "title_tfidf",
                TfidfVectorizer(lowercase=True, ngram_range=(1, 1), min_df=1, sublinear_tf=True),
                "title",
            ),
            (
                "category_tfidf",
                TfidfVectorizer(lowercase=True, ngram_range=(1, 1), min_df=1, sublinear_tf=True),
                "category",
            ),
        ]
    )
    pipeline = Pipeline(
        [
            ("features", features),
            ("clf", LinearSVC(C=1.0, class_weight="balanced", max_iter=5000, dual="auto", random_state=42)),
        ]
    )
    pipeline.fit(training_rows[["title", "category"]], training_rows["domain"])
    joblib.dump(pipeline, path)


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
    def test_build_narrative_context_includes_by_domain(self) -> None:
        result = {
            "overall": {
                "mentions": 100,
                "positive": 80,
                "neutral": 5,
                "negative": 15,
                "positive_percent": 80.0,
                "negative_percent": 15.0,
            },
            "aspects": [],
            "alerts": [],
            "places": [
                {
                    "title": "Khách sạn ABC",
                    "domain": {"domain": "hotel"},
                    "description_count": 60,
                    "top_positive_aspects": [
                        {"display_name": "Dịch vụ - Tổng quan", "positive": 50, "mentions": 55}
                    ],
                    "top_negative_aspects": [
                        {"display_name": "Phòng - Vệ sinh", "negative": 10, "mentions": 20, "negative_percent": 50.0}
                    ],
                },
                {
                    "title": "Nhà hàng XYZ",
                    "domain": {"domain": "restaurant"},
                    "description_count": 40,
                    "top_positive_aspects": [
                        {"display_name": "Đồ ăn - Chất lượng", "positive": 35, "mentions": 38}
                    ],
                    "top_negative_aspects": [],
                },
            ],
        }

        context = build_narrative_context(result)

        self.assertIn("by_domain", context)
        domains = {d["domain"]: d for d in context["by_domain"]}
        self.assertIn("hotel", domains)
        self.assertIn("restaurant", domains)
        self.assertEqual(domains["hotel"]["place_count"], 1)
        self.assertEqual(domains["hotel"]["review_count"], 60)
        self.assertGreaterEqual(len(domains["hotel"]["top_positive"]), 1)
        self.assertEqual(domains["hotel"]["top_positive"][0]["display_name"], "Dịch vụ - Tổng quan")
        self.assertGreaterEqual(len(domains["hotel"]["top_negative"]), 1)
        self.assertEqual(domains["restaurant"]["place_count"], 1)
        self.assertEqual(len(domains["restaurant"]["top_negative"]), 0)

    def test_build_system_prompt_contains_domain_vocabulary(self) -> None:
        from review_absa_pipeline.narrative import _build_system_prompt

        by_domain_hotel = [{"domain": "hotel", "place_count": 1, "review_count": 60}]
        prompt_hotel = _build_system_prompt(by_domain_hotel)
        self.assertIn("khách sạn", prompt_hotel.lower())
        self.assertIn("JSON", prompt_hotel)

        by_domain_multi = [
            {"domain": "restaurant", "place_count": 2, "review_count": 80},
            {"domain": "hotel", "place_count": 1, "review_count": 20},
        ]
        prompt_multi = _build_system_prompt(by_domain_multi)
        self.assertIn("nhà hàng", prompt_multi.lower())
        self.assertIn("khách sạn", prompt_multi.lower())

        prompt_empty = _build_system_prompt([])
        self.assertIn("JSON", prompt_empty)

    def test_generate_ollama_narrative_sends_system_and_json_format(self) -> None:
        from review_absa_pipeline.narrative import generate_ollama_narrative
        import json as json_mod

        captured: list[bytes] = []

        class FakeHTTPResponse:
            def read(self):
                return json_mod.dumps({
                    "response": json_mod.dumps({
                        "summary": "Tổng quan tốt.",
                        "strengths": ["Dịch vụ tốt."],
                        "issues": [],
                        "recommended_actions": [],
                        "caveats": [],
                    })
                }).encode("utf-8")
            def __enter__(self): return self
            def __exit__(self, *_): pass

        import urllib.request as _urllib_request

        original_urlopen = _urllib_request.urlopen

        def fake_urlopen(req, timeout=None):
            captured.append(req.data)
            return FakeHTTPResponse()

        _urllib_request.urlopen = fake_urlopen
        try:
            context = {
                "overall": {"mentions": 50, "positive": 40, "negative": 5, "neutral": 5, "positive_percent": 80.0, "negative_percent": 10.0},
                "top_strengths": [],
                "alerts": [],
                "places": [],
                "by_domain": [{"domain": "restaurant", "place_count": 1, "review_count": 50, "top_positive": [], "top_negative": []}],
            }
            result = generate_ollama_narrative(context, base_url="http://localhost:11434", model="gemma4:e4b")
        finally:
            _urllib_request.urlopen = original_urlopen

        self.assertEqual(len(captured), 1)
        body = json_mod.loads(captured[0].decode("utf-8"))
        self.assertIn("system", body)
        self.assertIn("nhà hàng", body["system"].lower())
        self.assertEqual(body.get("format"), "json")
        self.assertIn("temperature", body.get("options", {}))
        self.assertEqual(result["source"], "ollama")
        self.assertEqual(result["summary"], "Tổng quan tốt.")

    def test_template_narrative_includes_domain_context_when_by_domain_present(self) -> None:
        result = {
            "overall": {
                "mentions": 100,
                "positive": 80,
                "neutral": 5,
                "negative": 15,
                "positive_percent": 80.0,
                "negative_percent": 15.0,
            },
            "aspects": [],
            "alerts": [],
            "places": [
                {
                    "title": "Quán Cơm Ngon",
                    "domain": {"domain": "restaurant"},
                    "description_count": 100,
                    "top_positive_aspects": [
                        {"display_name": "Đồ ăn - Chất lượng", "positive": 70, "mentions": 80}
                    ],
                    "top_negative_aspects": [
                        {"display_name": "Phục vụ - Thái độ", "negative": 12, "mentions": 20, "negative_percent": 60.0}
                    ],
                }
            ],
        }

        context = build_narrative_context(result)
        narrative = generate_template_narrative(context)

        strengths_text = " ".join(narrative["strengths"])
        issues_text = " ".join(narrative["issues"])
        self.assertIn("restaurant", strengths_text + issues_text)

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
        self.assertEqual(batches[0].descriptions, ["Service was slow and staff ignored us"])
        self.assertEqual(len(batches[0].reviews), 1)
        self.assertEqual(batches[0].reviews[0].rating, 1)
        self.assertEqual(batches[0].reviews[0].when, "2026-01-02")
        self.assertEqual(batches[0].reviews[0].reviewer_name, "Anh")

    def test_loader_accepts_large_review_json_fields_from_crawler(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "large_reviews.csv"
            long_description = "dịch vụ tốt " * 15000
            row = {
                "title": "Cafe Large",
                "category": "Cafe",
                "user_reviews": "",
                "user_reviews_extended": json.dumps(
                    [
                        {
                            "Name": "Anh",
                            "Rating": 5,
                            "Description": long_description,
                            "When": "2026-06-14",
                        }
                    ],
                    ensure_ascii=False,
                ),
            }
            with csv_path.open("w", encoding="utf-8", newline="") as file:
                writer = csv.DictWriter(file, fieldnames=list(row))
                writer.writeheader()
                writer.writerow(row)

            batches = load_place_review_batches(csv_path)

        self.assertEqual(len(batches), 1)
        self.assertEqual(batches[0].title, "Cafe Large")
        self.assertEqual(batches[0].source_column, "user_reviews_extended")
        self.assertEqual(batches[0].reviews[0].text, long_description.strip())

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

    def test_sklearn_router_loads_joblib_weight_and_predicts_domain(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            model_path = Path(tmp) / "router.joblib"
            write_router_model(model_path)
            router = SklearnDomainRouter(model_path=model_path, fallback=RuleBasedDomainRouter())

            route = router.route(type("Place", (), {"title": "Khach san Ho Guom", "category": "Khach san"})())

        self.assertEqual(route.domain, "hotel")
        self.assertEqual(route.source, "sklearn")
        self.assertFalse(route.fallback)
        self.assertGreaterEqual(route.confidence, 0.5)

    def test_sklearn_router_falls_back_when_model_file_missing(self) -> None:
        router = SklearnDomainRouter(
            model_path=Path("training/router/weights/definitely-missing-router.joblib"),
            fallback=RuleBasedDomainRouter(default_domain="restaurant"),
        )

        route = router.route(type("Place", (), {"title": "ABC Hotel", "category": "Khach san"})())

        self.assertEqual(route.domain, "hotel")
        self.assertEqual(route.source, "sklearn_error")
        self.assertTrue(route.fallback)

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

    def test_analysis_engine_uses_sklearn_router_domain_for_model_selection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "reviews.csv"
            model_path = Path(tmp) / "router.joblib"
            write_crawled_csv(csv_path)
            write_router_model(model_path)

            engine = AnalysisEngine(
                model_manager=FakeModelManager(
                    {
                        "restaurant": [{"SERVICE#GENERAL": "negative", "FOOD#QUALITY": None}],
                        "hotel": [{"SERVICE#GENERAL": "positive", "ROOMS#GENERAL": None}],
                    }
                ),
                domain_router=SklearnDomainRouter(model_path=model_path, fallback=RuleBasedDomainRouter()),
            )

            result = engine.analyze_csv(job_id="job-1", csv_path=csv_path)

        self.assertEqual(result["places"][0]["domain"]["domain"], "restaurant")
        self.assertEqual(result["places"][0]["domain"]["source"], "sklearn")
        self.assertEqual(result["model_repo_ids"]["restaurant"], "repo/restaurant")

    def test_model_manager_uses_training_preprocess_settings_per_domain(self) -> None:
        captured_configs = []

        class FakeInferenceModel:
            def __init__(self, cfg) -> None:
                captured_configs.append(cfg)

        manager = ModelManager(
            model_repos={
                "restaurant": "repo/restaurant",
                "hotel": "repo/hotel",
                "hospital": "repo/hospital",
            }
        )

        with patch("review_absa_pipeline.model.ABSAInferenceModel", FakeInferenceModel):
            manager.get_model("restaurant")
            manager.get_model("hotel")
            manager.get_model("hospital")

        self.assertEqual(
            [cfg.teencode_path for cfg in captured_configs],
            [
                "training/teencode/res_teencode.txt",
                "training/teencode/hotel_teencode.txt",
                "training/teencode/hosRev_teencode.txt",
            ],
        )
        self.assertTrue(all(cfg.use_word_segmentation for cfg in captured_configs))
        self.assertFalse(any(cfg.prefer_local_cache for cfg in captured_configs))

    def test_run_from_csv_enables_training_word_segmentation_by_default(self) -> None:
        parser = build_parser()

        default_args = parser.parse_args(["--input-csv", "reviews.csv"])
        disabled_args = parser.parse_args(
            ["--input-csv", "reviews.csv", "--disable-word-segmentation"]
        )

        self.assertTrue(default_args.use_word_segmentation)
        self.assertFalse(disabled_args.use_word_segmentation)

    def test_text_preprocessor_downloads_vncorenlp_assets_when_segmentation_is_enabled(self) -> None:
        tmp = Path(".test-vncorenlp-assets")
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(exist_ok=True)
        vncorenlp_dir = tmp / "VnCoreNLP"
        downloaded_paths = []

        class FakeVnCoreNLP:
            def __init__(self, jar_path, annotators, quiet) -> None:
                self.jar_path = Path(jar_path)
                self.annotators = annotators
                self.quiet = quiet

            def tokenize(self, text: str):
                return [[text.replace(" ", "_")]]

        def fake_urlretrieve(url: str, local_path: str | Path):
            del url
            local_path = Path(local_path)
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_text("asset", encoding="utf-8")
            downloaded_paths.append(local_path.relative_to(vncorenlp_dir).as_posix())
            return str(local_path), None

        fake_module = types.ModuleType("vncorenlp")
        fake_module.VnCoreNLP = FakeVnCoreNLP
        old_module = sys.modules.get("vncorenlp")
        sys.modules["vncorenlp"] = fake_module
        try:
            preprocessor = TextPreprocessor(
                teencode_path=tmp / "missing_teencode.txt",
                use_word_segmentation=True,
                vncorenlp_dir=vncorenlp_dir,
            )
            with patch("review_absa_pipeline.preprocess.urlretrieve", fake_urlretrieve):
                segmented = preprocessor._word_segmentation("dịch vụ tốt")
        finally:
            if old_module is None:
                sys.modules.pop("vncorenlp", None)
            else:
                sys.modules["vncorenlp"] = old_module
            shutil.rmtree(tmp, ignore_errors=True)

        self.assertEqual(segmented, "dịch_vụ_tốt")
        self.assertEqual(
            downloaded_paths,
            [
                "VnCoreNLP-1.2.jar",
                "models/wordsegmenter/vi-vocab",
                "models/wordsegmenter/wordsegmenter.rdr",
            ],
        )

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
