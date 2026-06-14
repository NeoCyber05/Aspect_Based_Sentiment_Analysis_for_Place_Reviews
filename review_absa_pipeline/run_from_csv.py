from __future__ import annotations

import argparse
import json
from pathlib import Path

from .model import ABSAInferenceConfig, ABSAInferenceModel
from .pipeline import aspect_rows, load_place_review_batches, summarize_aspects, summarize_overall

DEFAULT_MODEL_REPO_ID = "NeoCyber/m-e5-small-vlsp2018-restaurant"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read crawled review text and run ABSA with local architecture plus Hugging Face weights.",
    )
    parser.add_argument("--input-csv", required=True, help="Path to the crawled CSV file.")
    parser.add_argument(
        "--model-repo-id",
        default=DEFAULT_MODEL_REPO_ID,
        help="Hugging Face model repo that stores tokenizer, config, and weights.",
    )
    parser.add_argument(
        "--teencode-path",
        default="training/teencode/res_teencode.txt",
        help="Teencode mapping file used before inference.",
    )
    parser.add_argument("--max-length", type=int, default=256)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--disable-preprocess", action="store_true")
    segmentation_group = parser.add_mutually_exclusive_group()
    segmentation_group.add_argument(
        "--use-word-segmentation",
        dest="use_word_segmentation",
        action="store_true",
        default=True,
        help="Enable VnCoreNLP word segmentation before inference (default).",
    )
    segmentation_group.add_argument(
        "--disable-word-segmentation",
        dest="use_word_segmentation",
        action="store_false",
        help="Disable VnCoreNLP word segmentation before inference.",
    )
    parser.add_argument(
        "--output-json",
        default="",
        help="Optional path to write the JSON result.",
    )
    return parser


def write_output(payload: dict[str, object], output_json: str) -> None:
    output_text = json.dumps(payload, ensure_ascii=False, indent=2)
    if output_json:
        out_path = Path(output_json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output_text, encoding="utf-8")
        print(f"Wrote result: {out_path}")
    else:
        print(output_text)


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    batches = load_place_review_batches(args.input_csv)
    if not batches:
        write_output(
            {
                "model_repo_id": args.model_repo_id,
                "place_count": 0,
                "description_count": 0,
                "overall": summarize_overall({}),
                "aspect_summary": {},
                "aspects": [],
                "places": [],
            },
            args.output_json,
        )
        return

    cfg = ABSAInferenceConfig(
        model_repo_id=args.model_repo_id,
        teencode_path=args.teencode_path,
        max_length=args.max_length,
        batch_size=args.batch_size,
        use_text_preprocessing=not args.disable_preprocess,
        use_word_segmentation=args.use_word_segmentation,
    )
    model = ABSAInferenceModel(cfg)

    all_predictions: list[dict[str, str | None]] = []
    places: list[dict[str, object]] = []
    for batch in batches:
        predictions = model.predict(batch.descriptions)
        all_predictions.extend(predictions)
        summary = summarize_aspects(predictions)
        places.append(
            {
                "input_id": batch.input_id,
                "title": batch.title,
                "source_column": batch.source_column,
                "description_count": len(batch.descriptions),
                "overall": summarize_overall(summary),
                "aspect_summary": summary,
                "aspects": aspect_rows(summary),
            }
        )

    global_summary = summarize_aspects(all_predictions)
    final_result = {
        "model_repo_id": args.model_repo_id,
        "place_count": len(places),
        "description_count": len(all_predictions),
        "overall": summarize_overall(global_summary),
        "aspect_summary": global_summary,
        "aspects": aspect_rows(global_summary),
        "places": places,
    }

    write_output(final_result, args.output_json)


if __name__ == "__main__":
    main()
