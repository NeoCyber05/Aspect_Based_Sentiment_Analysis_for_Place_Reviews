from __future__ import annotations

from typing import Any

from transformers import PretrainedConfig


class UniVSFCConfig(PretrainedConfig):
    model_type = "uni_vsfc_transformer"
    has_no_defaults_at_init = True

    def __init__(
        self,
        backbone_config: dict[str, Any],
        task_names: list[str],
        num_classes_by_task: dict[str, int],
        base_model_name_or_path: str = "",
        dropout_prob: float = 0.2,
        multi_branch: bool = False,
        **kwargs: Any,
    ) -> None:
        if not backbone_config:
            raise ValueError("`backbone_config` must not be empty.")
        if "model_type" not in backbone_config:
            raise ValueError("`backbone_config` must contain `model_type`.")
        if not task_names:
            raise ValueError("`task_names` must not be empty.")
        if not num_classes_by_task:
            raise ValueError("`num_classes_by_task` must not be empty.")

        self.backbone_config = dict(backbone_config)
        self.base_model_name_or_path = base_model_name_or_path
        self.task_names = list(task_names)
        self.num_classes_by_task = {name: int(num_classes_by_task[name]) for name in self.task_names}
        self.num_tasks = len(self.task_names)
        self.dropout_prob = float(dropout_prob)
        self.multi_branch = bool(multi_branch)

        provided_num_labels = kwargs.pop("num_labels", None)
        num_labels = int(provided_num_labels or sum(self.num_classes_by_task.values()))

        super().__init__(num_labels=num_labels, **kwargs)
