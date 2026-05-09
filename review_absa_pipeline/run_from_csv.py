from __future__ import annotations

import argparse
import json
from pathlib import Path

from .model import ABSAInferenceConfig, ABSAInferenceModel
from .pipeline import load_place_review_batches, summarize_aspects


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Đọc user_reviews_extended, lấy Description hợp lệ và chạy ABSA.",
    )
    parser.add_argument("--input-csv", required=True, help="Đường dẫn file CSV crawl.")
    parser.add_argument(
        "--checkpoint",
        required=True,
        help="Checkpoint model (.pt) đã train, có model_state_dict và aspect_category_names.",
    )
    parser.add_argument(
        "--pretrained-model",
        default="intfloat/multilingual-e5-small",
        help="Tên base model HuggingFace giống lúc train.",
    )
    parser.add_argument(
        "--teencode-path",
        default="training/teencode/hotel_teencode.txt",
        help="File mapping teencode.",
    )
    parser.add_argument("--max-length", type=int, default=256)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--disable-preprocess", action="store_true")
    parser.add_argument("--use-word-segmentation", action="store_true")
    parser.add_argument(
        "--output-json",
        default="",
        help="Nếu truyền path, sẽ ghi kết quả JSON ra file.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    batches = load_place_review_batches(args.input_csv)
    if not batches:
        empty = {
            "place_count": 0,
            "description_count": 0,
            "aspect_summary": {},
            "aspects": [],
            "places": [],
        }
        output_text = json.dumps(empty, ensure_ascii=False, indent=2)
        if args.output_json:
            out_path = Path(args.output_json)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(output_text, encoding="utf-8")
            print(f"Đã ghi kết quả: {out_path}")
        else:
            print(output_text)
        return

    cfg = ABSAInferenceConfig(
        pretrained_model_name=args.pretrained_model,
        checkpoint_path=args.checkpoint,
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
        places.append(
            {
                "input_id": batch.input_id,
                "title": batch.title,
                "description_count": len(batch.descriptions),
                "aspect_summary": summarize_aspects(predictions),
            }
        )

    global_summary = summarize_aspects(all_predictions)
    aspects = [
        {"aspect": aspect, **metrics}
        for aspect, metrics in sorted(global_summary.items(), key=lambda item: item[1]["score_5"], reverse=True)
    ]
    final_result = {
        "place_count": len(places),
        "description_count": len(all_predictions),
        "aspect_summary": global_summary,
        "aspects": aspects,
        "places": places,
    }

    output_text = json.dumps(final_result, ensure_ascii=False, indent=2)
    if args.output_json:
        out_path = Path(args.output_json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output_text, encoding="utf-8")
        print(f"Đã ghi kết quả: {out_path}")
    else:
        print(output_text)


if __name__ == "__main__":
    main()

