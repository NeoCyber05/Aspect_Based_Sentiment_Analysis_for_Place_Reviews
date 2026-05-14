from __future__ import annotations

from typing import Any

from transformers import PretrainedConfig


class ABSAConfig(PretrainedConfig):
    model_type = "absa_transformer"
    has_no_defaults_at_init = True

    def __init__(
        self,
        backbone_config: dict[str, Any],
        aspect_category_names: list[str],
        base_model_name_or_path: str = "",
        num_labels_per_aspect: int = 4,
        dropout_prob: float = 0.2,
        multi_branch: bool = False,
        sentiment_labels: list[str] | None = None,
        **kwargs: Any,
    ) -> None:
        if not backbone_config:
            raise ValueError("`backbone_config` must not be empty.")
        if "model_type" not in backbone_config:
            raise ValueError("`backbone_config` must contain `model_type`.")
        if not aspect_category_names:
            raise ValueError("`aspect_category_names` must not be empty.")

        self.backbone_config = dict(backbone_config)
        self.base_model_name_or_path = base_model_name_or_path
        self.aspect_category_names = list(aspect_category_names)
        self.num_aspects = len(self.aspect_category_names)
        self.num_labels_per_aspect = int(num_labels_per_aspect)
        self.dropout_prob = float(dropout_prob)
        self.multi_branch = bool(multi_branch)
        self.sentiment_labels = list(sentiment_labels or ["none", "positive", "negative", "neutral"])
        if len(self.sentiment_labels) != self.num_labels_per_aspect:
            raise ValueError("`sentiment_labels` length must equal `num_labels_per_aspect`.")

        provided_num_labels = kwargs.pop("num_labels", None)
        provided_id2label = kwargs.pop("id2label", None)
        provided_label2id = kwargs.pop("label2id", None)

        num_labels = int(provided_num_labels or self.num_labels_per_aspect)
        id2label = provided_id2label or {index: label for index, label in enumerate(self.sentiment_labels)}
        label2id = provided_label2id or {label: index for index, label in id2label.items()}

        super().__init__(
            num_labels=num_labels,
            id2label=id2label,
            label2id=label2id,
            **kwargs,
        )
