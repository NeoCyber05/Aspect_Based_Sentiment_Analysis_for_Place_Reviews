from __future__ import annotations

import argparse
import json

from transformers import AutoModelForSequenceClassification, AutoTokenizer

import hf_absa_model  # noqa: F401


def from_pretrained_prefer_cache(loader, repo_id: str, **kwargs):
    try:
        return loader.from_pretrained(repo_id, local_files_only=True, **kwargs)
    except OSError:
        return loader.from_pretrained(repo_id, **kwargs)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Load a published Hugging Face model and run a quick inference.",
    )
    parser.add_argument(
        "--repo-id",
        required=True,
        help="Hugging Face model repo, for example NeoCyber/m-e5-small-vlsp2018-hotel.",
    )
    parser.add_argument(
        "--text",
        action="append",
        required=True,
        help="Input review text. Repeat --text to pass multiple reviews.",
    )
    parser.add_argument("--max-length", type=int, default=256)
    return parser


def main() -> None:
    args = build_parser().parse_args()

    tokenizer = from_pretrained_prefer_cache(AutoTokenizer, args.repo_id)
    model = from_pretrained_prefer_cache(
        AutoModelForSequenceClassification,
        args.repo_id,
        trust_remote_code=False,
    )
    model.eval()

    encoded = tokenizer(
        args.text,
        padding=True,
        truncation=True,
        max_length=args.max_length,
        return_tensors="pt",
    )
    outputs = model(**encoded)

    if hasattr(outputs, "logits_by_task") and outputs.logits_by_task is not None:
        predictions = model.decode_predictions(outputs.logits_by_task)
    else:
        predictions = model.decode_predictions(outputs.logits)

    print(json.dumps(predictions, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
