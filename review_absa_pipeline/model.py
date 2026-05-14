from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from .preprocess import TextPreprocessor

# Importing this package registers the local custom config/model classes with
# Transformers AutoClass APIs. The Hugging Face repo is only used for tokenizer,
# config, and weights.
import hf_absa_model  # noqa: F401


class PolarityMapping:
    INDEX_TO_POLARITY = {0: None, 1: "positive", 2: "negative", 3: "neutral"}


@dataclass
class ABSAInferenceConfig:
    model_repo_id: str
    teencode_path: str = "training/teencode/res_teencode.txt"
    max_length: int = 256
    batch_size: int = 16
    use_text_preprocessing: bool = True
    use_word_segmentation: bool = False
    prefer_local_cache: bool = True


def _from_pretrained_prefer_cache(loader, model_repo_id: str, prefer_local_cache: bool, **kwargs):
    if prefer_local_cache:
        try:
            return loader.from_pretrained(model_repo_id, local_files_only=True, **kwargs)
        except OSError:
            pass
    return loader.from_pretrained(model_repo_id, **kwargs)


class ABSAInferenceModel:
    def __init__(self, cfg: ABSAInferenceConfig) -> None:
        self.cfg = cfg
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.tokenizer = _from_pretrained_prefer_cache(
            AutoTokenizer,
            cfg.model_repo_id,
            cfg.prefer_local_cache,
        )
        self.model = _from_pretrained_prefer_cache(
            AutoModelForSequenceClassification,
            cfg.model_repo_id,
            cfg.prefer_local_cache,
            trust_remote_code=False,
        ).to(self.device)
        self.model.eval()

        aspect_category_names = getattr(self.model.config, "aspect_category_names", None)
        if not aspect_category_names:
            raise ValueError("Model Hugging Face thiếu `aspect_category_names` trong config.")
        self.aspect_category_names: list[str] = list(aspect_category_names)

        self.preprocessor = TextPreprocessor(
            teencode_path=Path(cfg.teencode_path),
            use_word_segmentation=cfg.use_word_segmentation,
        )

    @torch.no_grad()
    def predict(self, reviews: list[str]) -> list[dict[str, str | None]]:
        if not reviews:
            return []

        if self.cfg.use_text_preprocessing:
            texts = [self.preprocessor(text) for text in reviews]
        else:
            texts = reviews

        all_predictions: list[list[int]] = []
        for start in range(0, len(texts), self.cfg.batch_size):
            batch_texts = texts[start : start + self.cfg.batch_size]
            encoded = self.tokenizer(
                batch_texts,
                max_length=self.cfg.max_length,
                padding=True,
                truncation=True,
                return_tensors="pt",
            )
            encoded = {k: v.to(self.device) for k, v in encoded.items()}
            outputs = self.model(**encoded)
            logits = outputs.logits if hasattr(outputs, "logits") else outputs[0]
            if hasattr(self.model, "reshape_logits"):
                logits = self.model.reshape_logits(logits)
            elif logits.dim() != 3:
                logits = logits.reshape(logits.size(0), len(self.aspect_category_names), 4)
            all_predictions.extend(logits.argmax(dim=-1).detach().cpu().tolist())

        mapped: list[dict[str, str | None]] = []
        for row in all_predictions:
            mapped.append(
                {
                    aspect: self._decode_label(int(idx))
                    for aspect, idx in zip(self.aspect_category_names, row)
                }
            )
        return mapped

    def _decode_label(self, index: int) -> str | None:
        if hasattr(self.model, "_decode_label"):
            return self.model._decode_label(index)

        id2label = getattr(self.model.config, "id2label", {})
        label = id2label.get(index, id2label.get(str(index), PolarityMapping.INDEX_TO_POLARITY.get(index)))
        if label == "none":
            return None
        return label
