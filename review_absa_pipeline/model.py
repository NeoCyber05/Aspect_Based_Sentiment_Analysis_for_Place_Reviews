from __future__ import annotations

import inspect
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import torch
from torch import nn
from transformers import AutoModel, AutoTokenizer

from .preprocess import TextPreprocessor


class PolarityMapping:
    INDEX_TO_POLARITY = {0: None, 1: "positive", 2: "negative", 3: "neutral"}


class TransformerABSA(nn.Module):

    def __init__(
        self,
        pretrained_model_name: str,
        aspect_category_names: Iterable[str],
        multi_branch: bool = False,
        dropout: float = 0.2,
    ) -> None:
        super().__init__()
        self.aspect_category_names = list(aspect_category_names)
        self.multi_branch = multi_branch
        self.transformer = AutoModel.from_pretrained(pretrained_model_name)
        hidden_size = self.transformer.config.hidden_size
        self.dropout = nn.Dropout(dropout)
        self.classifier_heads = nn.ModuleList([nn.Linear(hidden_size, 4) for _ in self.aspect_category_names])
        self._transformer_forward_args = set(inspect.signature(self.transformer.forward).parameters)

    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: torch.Tensor | None = None,
        token_type_ids: torch.Tensor | None = None,
    ) -> torch.Tensor:
        model_inputs = {"input_ids": input_ids}
        if attention_mask is not None:
            model_inputs["attention_mask"] = attention_mask
        if token_type_ids is not None and "token_type_ids" in self._transformer_forward_args:
            model_inputs["token_type_ids"] = token_type_ids

        outputs = self.transformer(**model_inputs)
        token_embeddings = outputs.last_hidden_state
        if attention_mask is None:
            pooled_output = token_embeddings.mean(dim=1)
        else:
            mask = attention_mask.unsqueeze(-1).type_as(token_embeddings)
            pooled_output = (token_embeddings * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
        review_embedding = self.dropout(pooled_output)
        logits_by_aspect = torch.stack([head(review_embedding) for head in self.classifier_heads], dim=1)
        if self.multi_branch:
            return logits_by_aspect
        return logits_by_aspect.reshape(logits_by_aspect.size(0), -1)

    def reshape_logits(self, logits: torch.Tensor) -> torch.Tensor:
        if logits.dim() == 3:
            return logits
        return logits.reshape(logits.size(0), len(self.aspect_category_names), 4)


@dataclass
class ABSAInferenceConfig:
    pretrained_model_name: str
    checkpoint_path: str
    teencode_path: str = "training/teencode/hotel_teencode.txt"
    max_length: int = 256
    batch_size: int = 16
    use_text_preprocessing: bool = True
    use_word_segmentation: bool = False


class ABSAInferenceModel:
    def __init__(self, cfg: ABSAInferenceConfig) -> None:
        self.cfg = cfg
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        checkpoint = torch.load(cfg.checkpoint_path, map_location=self.device)
        aspect_category_names = checkpoint.get("aspect_category_names")
        if not aspect_category_names:
            raise ValueError("Checkpoint thiếu `aspect_category_names`.")

        self.aspect_category_names: list[str] = list(aspect_category_names)
        self.tokenizer = AutoTokenizer.from_pretrained(cfg.pretrained_model_name)
        self.model = TransformerABSA(
            pretrained_model_name=cfg.pretrained_model_name,
            aspect_category_names=self.aspect_category_names,
            multi_branch=False,
        ).to(self.device)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()

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
            logits = self.model(**encoded)
            logits = self.model.reshape_logits(logits)
            y_pred = logits.argmax(dim=-1).detach().cpu().tolist()
            all_predictions.extend(y_pred)

        mapped: list[dict[str, str | None]] = []
        for row in all_predictions:
            mapped.append(
                {
                    aspect: PolarityMapping.INDEX_TO_POLARITY[int(idx)]
                    for aspect, idx in zip(self.aspect_category_names, row)
                }
            )
        return mapped

