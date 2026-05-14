from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any

import torch
from torch import nn
from transformers import AutoConfig, AutoModel, PreTrainedModel
from transformers.utils import ModelOutput

from .configuration_uni import UniVSFCConfig


@dataclass
class UniVSFCOutput(ModelOutput):
    loss: torch.FloatTensor | None = None
    logits: torch.FloatTensor | None = None
    logits_by_task: dict[str, torch.FloatTensor] | None = None
    hidden_states: tuple[torch.FloatTensor, ...] | None = None
    attentions: tuple[torch.FloatTensor, ...] | None = None


class UniVSFCForMultiTaskClassification(PreTrainedModel):
    config_class = UniVSFCConfig
    base_model_prefix = "transformer"
    model_type = UniVSFCConfig.model_type

    def __init__(self, config: UniVSFCConfig) -> None:
        super().__init__(config)

        backbone_config_dict = dict(config.backbone_config)
        backbone_model_type = backbone_config_dict.pop("model_type")
        backbone_config = AutoConfig.for_model(backbone_model_type, **backbone_config_dict)

        self.transformer = AutoModel.from_config(backbone_config)
        hidden_size = self.transformer.config.hidden_size
        self.dropout = nn.Dropout(config.dropout_prob)
        self.heads = nn.ModuleDict(
            {name: nn.Linear(hidden_size, config.num_classes_by_task[name]) for name in config.task_names}
        )
        self._transformer_forward_args = set(inspect.signature(self.transformer.forward).parameters)

        self.post_init()

    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: torch.Tensor | None = None,
        token_type_ids: torch.Tensor | None = None,
        labels: dict[str, torch.Tensor] | None = None,
        **kwargs: Any,
    ) -> UniVSFCOutput | tuple[torch.Tensor, ...]:
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

        pooled_output = self.dropout(pooled_output)
        logits_by_task = {name: self.heads[name](pooled_output) for name in self.config.task_names}
        flat_logits = torch.cat([logits_by_task[name] for name in self.config.task_names], dim=-1)

        loss = None
        if labels is not None:
            if not isinstance(labels, dict):
                raise ValueError("`labels` must be a dict keyed by task name.")
            losses = []
            for name in self.config.task_names:
                if name not in labels:
                    raise ValueError(f"`labels` is missing task `{name}`.")
                losses.append(nn.functional.cross_entropy(logits_by_task[name], labels[name]))
            loss = torch.stack(losses).mean()

        if not return_dict:
            output = (flat_logits, logits_by_task)
            if getattr(outputs, "hidden_states", None) is not None:
                output += (outputs.hidden_states,)
            if getattr(outputs, "attentions", None) is not None:
                output += (outputs.attentions,)
            if loss is not None:
                return (loss,) + output
            return output

        return UniVSFCOutput(
            loss=loss,
            logits=flat_logits,
            logits_by_task=logits_by_task,
            hidden_states=getattr(outputs, "hidden_states", None),
            attentions=getattr(outputs, "attentions", None),
        )

    def decode_predictions(self, logits_by_task: dict[str, torch.Tensor]) -> list[dict[str, int]]:
        batch_size = next(iter(logits_by_task.values())).size(0)
        decoded = [dict() for _ in range(batch_size)]
        for name in self.config.task_names:
            predictions = logits_by_task[name].argmax(dim=-1).detach().cpu().tolist()
            for row, prediction in zip(decoded, predictions):
                row[name] = int(prediction)
        return decoded
