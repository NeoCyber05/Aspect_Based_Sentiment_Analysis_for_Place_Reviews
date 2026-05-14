from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any

import torch
from torch import nn
from transformers import AutoConfig, AutoModel, PreTrainedModel
from transformers.utils import ModelOutput

from .configuration_absa import ABSAConfig


@dataclass
class ABSAOutput(ModelOutput):
    loss: torch.FloatTensor | None = None
    logits: torch.FloatTensor | None = None
    hidden_states: tuple[torch.FloatTensor, ...] | None = None
    attentions: tuple[torch.FloatTensor, ...] | None = None


class ABSAForAspectSentimentClassification(PreTrainedModel):
    config_class = ABSAConfig
    base_model_prefix = "transformer"
    model_type = ABSAConfig.model_type

    def __init__(self, config: ABSAConfig) -> None:
        super().__init__(config)

        backbone_config_dict = dict(config.backbone_config)
        backbone_model_type = backbone_config_dict.pop("model_type")
        backbone_config = AutoConfig.for_model(backbone_model_type, **backbone_config_dict)

        self.transformer = AutoModel.from_config(backbone_config)
        hidden_size = self.transformer.config.hidden_size
        self.dropout = nn.Dropout(config.dropout_prob)
        self.classifier_heads = nn.ModuleList(
            [nn.Linear(hidden_size, config.num_labels_per_aspect) for _ in config.aspect_category_names]
        )
        self._transformer_forward_args = set(inspect.signature(self.transformer.forward).parameters)

        self.post_init()

    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: torch.Tensor | None = None,
        token_type_ids: torch.Tensor | None = None,
        labels: torch.Tensor | None = None,
        **kwargs: Any,
    ) -> ABSAOutput | tuple[torch.Tensor, ...]:
        return_dict = kwargs.pop("return_dict", getattr(self.config, "return_dict", True))

        model_inputs: dict[str, Any] = {"input_ids": input_ids}
        if attention_mask is not None:
            model_inputs["attention_mask"] = attention_mask
        if token_type_ids is not None and "token_type_ids" in self._transformer_forward_args:
            model_inputs["token_type_ids"] = token_type_ids

        for key, value in kwargs.items():
            if key in self._transformer_forward_args:
                model_inputs[key] = value

        if "return_dict" in self._transformer_forward_args:
            model_inputs["return_dict"] = True

        outputs = self.transformer(**model_inputs)
        token_embeddings = outputs.last_hidden_state

        if attention_mask is None:
            pooled_output = token_embeddings.mean(dim=1)
        else:
            mask = attention_mask.unsqueeze(-1).type_as(token_embeddings)
            pooled_output = (token_embeddings * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)

        review_embedding = self.dropout(pooled_output)
        logits = torch.stack([head(review_embedding) for head in self.classifier_heads], dim=1)

        loss = None
        if labels is not None:
            if labels.dim() != 2:
                raise ValueError("`labels` must have shape [batch_size, num_aspects].")
            if labels.size(1) != len(self.config.aspect_category_names):
                raise ValueError(
                    "`labels` second dimension does not match the configured number of aspects."
                )
            loss = nn.functional.cross_entropy(
                logits.reshape(-1, self.config.num_labels_per_aspect),
                labels.reshape(-1),
            )

        if not return_dict:
            output = (logits,)
            if getattr(outputs, "hidden_states", None) is not None:
                output += (outputs.hidden_states,)
            if getattr(outputs, "attentions", None) is not None:
                output += (outputs.attentions,)
            if loss is not None:
                return (loss,) + output
            return output

        return ABSAOutput(
            loss=loss,
            logits=logits,
            hidden_states=getattr(outputs, "hidden_states", None),
            attentions=getattr(outputs, "attentions", None),
        )

    def reshape_logits(self, logits: torch.Tensor) -> torch.Tensor:
        if logits.dim() == 3:
            return logits
        return logits.reshape(logits.size(0), len(self.config.aspect_category_names), self.config.num_labels_per_aspect)

    def decode_predictions(self, logits: torch.Tensor) -> list[dict[str, str | None]]:
        logits = self.reshape_logits(logits)
        predicted_indices = logits.argmax(dim=-1).detach().cpu().tolist()

        decoded: list[dict[str, str | None]] = []
        for row in predicted_indices:
            decoded.append(
                {
                    aspect: self._decode_label(int(index))
                    for aspect, index in zip(self.config.aspect_category_names, row)
                }
            )
        return decoded

    def _decode_label(self, index: int) -> str | None:
        label = self.config.id2label[int(index)]
        if label == "none":
            return None
        return label
