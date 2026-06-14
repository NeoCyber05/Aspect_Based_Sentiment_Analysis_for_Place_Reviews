from __future__ import annotations

import argparse
import inspect
import json
import sys
from pathlib import Path
from typing import Any

import torch
from transformers import AutoConfig, AutoTokenizer

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from hf_absa_model import ABSAConfig, ABSAForAspectSentimentClassification


DEFAULT_BASE_MODEL = "intfloat/multilingual-e5-small"
SENTIMENT_LABELS = ["none", "positive", "negative", "neutral"]
MODEL_CARD_METADATA = {
    "vlsp-2018-restaurant-e5-small-best": {
        "dataset_name": "VLSP 2018 Sentiment Analysis - Restaurant",
        "dataset_path": "training/datasets/vlsp2018_restaurant",
        "notebook": "training/pipeline/full_pipeline_res.ipynb",
        "metrics": {
            "aspect_category": {
                "precision": 0.816910,
                "recall": 0.825833,
                "f1": 0.815224,
                "support": 6000,
            },
            "aspect_category_polarity": {
                "precision": 0.749515,
                "recall": 0.755833,
                "f1": 0.733340,
                "support": 6000,
            },
        },
    },
    "vlsp-2018-hotel-e5-small-best": {
        "dataset_name": "VLSP 2018 Sentiment Analysis - Hotel",
        "dataset_path": "training/datasets/vlsp2018_hotel",
        "notebook": "training/pipeline/full_pipeline_hotel.ipynb",
        "metrics": {
            "aspect_category": {
                "precision": 0.937400,
                "recall": 0.941520,
                "f1": 0.931863,
                "support": 20400,
            },
            "aspect_category_polarity": {
                "precision": 0.931039,
                "recall": 0.933578,
                "f1": 0.919990,
                "support": 20400,
            },
        },
    },
    "hosrev-e5-small-best": {
        "dataset_name": "HosRev",
        "dataset_path": "training/datasets/hosrev",
        "notebook": "training/pipeline/full_pipeline_hosRev.ipynb",
        "metrics": {
            "aspect_category": {
                "precision": 0.894861,
                "recall": 0.905712,
                "f1": 0.897999,
                "support": 12727,
            },
            "aspect_category_polarity": {
                "precision": 0.887875,
                "recall": 0.898248,
                "f1": 0.889022,
                "support": 12727,
            },
        },
    },
}


def _torch_load_kwargs() -> dict[str, Any]:
    kwargs: dict[str, Any] = {"map_location": "cpu", "weights_only": False}
    if "mmap" in inspect.signature(torch.load).parameters:
        kwargs["mmap"] = True
    return kwargs


def load_checkpoint(path: str | Path) -> dict[str, Any]:
    checkpoint = torch.load(Path(path), **_torch_load_kwargs())
    if not isinstance(checkpoint, dict):
        raise ValueError(f"Expected checkpoint dict, got {type(checkpoint).__name__}")
    if "model_state_dict" not in checkpoint:
        raise ValueError("Checkpoint is missing `model_state_dict`.")
    return checkpoint


def resolve_base_model_name(checkpoint: dict[str, Any], fallback: str = "") -> str:
    return str(checkpoint.get("pretrained_model_name") or fallback or DEFAULT_BASE_MODEL)


def resolve_aspect_names(checkpoint: dict[str, Any]) -> list[str]:
    aspect_names = checkpoint.get("aspect_category_names")
    if not aspect_names:
        raise ValueError("Checkpoint is missing `aspect_category_names`.")
    return [str(name) for name in aspect_names]


def _jsonable(value: Any) -> Any:
    if hasattr(value, "item"):
        return value.item()
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def resolve_model_card_metadata(checkpoint_path: str | Path, repo_id: str | None = None) -> dict[str, Any]:
    checkpoint_stem = Path(checkpoint_path).stem
    candidates = [checkpoint_stem]
    if repo_id:
        repo_name = repo_id.rsplit("/", 1)[-1]
        candidates.append(repo_name)
        if repo_name == "m-e5-small-vlsp2018-restaurant":
            candidates.append("vlsp-2018-restaurant-e5-small-best")
        elif repo_name == "m-e5-small-vlsp2018-hotel":
            candidates.append("vlsp-2018-hotel-e5-small-best")
        elif repo_name == "m-e5-small-hosrev":
            candidates.append("hosrev-e5-small-best")

    for candidate in candidates:
        if candidate in MODEL_CARD_METADATA:
            return MODEL_CARD_METADATA[candidate]
    return {}


def build_model(
    checkpoint: dict[str, Any],
    base_model_name: str,
    aspect_category_names: list[str],
    dropout_prob: float,
) -> tuple[ABSAForAspectSentimentClassification, ABSAConfig, str]:
    backbone_config = AutoConfig.from_pretrained(base_model_name)
    config = ABSAConfig(
        backbone_config=backbone_config.to_dict(),
        aspect_category_names=aspect_category_names,
        base_model_name_or_path=base_model_name,
        num_labels_per_aspect=len(SENTIMENT_LABELS),
        dropout_prob=dropout_prob,
        multi_branch=bool(checkpoint.get("multi_branch", False)),
        sentiment_labels=SENTIMENT_LABELS,
    )
    config.architectures = ["ABSAForAspectSentimentClassification"]

    model = ABSAForAspectSentimentClassification(config)
    model.load_state_dict(checkpoint["model_state_dict"], strict=True)
    model.eval()
    return model, config, "absa"


def write_model_card(
    output_dir: str | Path,
    checkpoint_path: str | Path,
    checkpoint: dict[str, Any],
    config: ABSAConfig,
    kind: str,
    repo_id: str | None = None,
) -> None:
    del kind
    output_dir = Path(output_dir)
    checkpoint_path = Path(checkpoint_path)
    metrics = json.dumps(_jsonable(checkpoint.get("metrics", {})), ensure_ascii=False, indent=2)
    aspects = "\n".join(f"- {name}" for name in config.aspect_category_names)
    repo_heading = repo_id or output_dir.name
    card_metadata = resolve_model_card_metadata(checkpoint_path, repo_id=repo_id)
    dataset_lines = ""
    weighted_metrics_lines = ""
    if card_metadata:
        dataset_lines = f"""
## Training Dataset

- Dataset: {card_metadata["dataset_name"]}
- Local dataset path: `{card_metadata["dataset_path"]}`
- Result source: `{card_metadata["notebook"]}`
"""
        rows = []
        for metric_name, metric_values in card_metadata["metrics"].items():
            rows.append(
                "| {name} | {precision:.6f} | {recall:.6f} | {f1:.6f} | {support} |".format(
                    name=metric_name,
                    precision=metric_values["precision"],
                    recall=metric_values["recall"],
                    f1=metric_values["f1"],
                    support=metric_values["support"],
                ),
            )
        weighted_metrics_lines = f"""
## Test Metrics (Weighted Avg)

| Report | Precision | Recall | F1 | Support |
|--------|-----------|--------|----|---------|
{chr(10).join(rows)}
"""

    readme = f"""---
language:
- vi
license: mit
library_name: transformers
pipeline_tag: text-classification
base_model: {config.base_model_name_or_path}
tags:
- absa_transformer
- aspect-based-sentiment-analysis
- multilingual-e5
- vietnamese
---

# {repo_heading}

Aspect-based sentiment model exported from `{checkpoint_path.name}`.

## Training Metadata

- Base model: `{config.base_model_name_or_path}`
- Epoch: `{checkpoint.get("epoch", "")}`
- Multi branch: `{config.multi_branch}`
- Aspect count: `{len(config.aspect_category_names)}`
- Sentiment labels: `{", ".join(config.sentiment_labels)}`
{dataset_lines}
{weighted_metrics_lines}

## Checkpoint Metrics

```json
{metrics}
```

## Aspects

{aspects}
"""
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "README.md").write_text(readme, encoding="utf-8")


def export_checkpoint(
    checkpoint_path: str | Path,
    output_dir: str | Path,
    base_model_name: str = "",
    dropout_prob: float = 0.2,
    repo_id: str | None = None,
) -> Path:
    checkpoint_path = Path(checkpoint_path)
    output_dir = Path(output_dir)

    checkpoint = load_checkpoint(checkpoint_path)
    resolved_base_model = resolve_base_model_name(checkpoint, base_model_name)
    aspect_names = resolve_aspect_names(checkpoint)
    model, config, kind = build_model(checkpoint, resolved_base_model, aspect_names, dropout_prob)

    output_dir.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(output_dir, safe_serialization=True)
    tokenizer = AutoTokenizer.from_pretrained(resolved_base_model)
    tokenizer.save_pretrained(output_dir)
    write_model_card(output_dir, checkpoint_path, checkpoint, config, kind, repo_id=repo_id)
    return output_dir


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Export a notebook ABSA .pt checkpoint to Hugging Face format.")
    parser.add_argument("checkpoint_path")
    parser.add_argument("output_dir")
    parser.add_argument("--base-model-name", default="")
    parser.add_argument("--dropout-prob", type=float, default=0.2)
    parser.add_argument("--repo-id", default="")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    export_checkpoint(
        checkpoint_path=args.checkpoint_path,
        output_dir=args.output_dir,
        base_model_name=args.base_model_name,
        dropout_prob=args.dropout_prob,
        repo_id=args.repo_id or None,
    )


if __name__ == "__main__":
    main()
