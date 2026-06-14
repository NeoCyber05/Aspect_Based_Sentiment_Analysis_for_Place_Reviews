from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .model import ABSAInferenceModel


DEFAULT_DOMAIN_MODEL_REPOS = {
    "restaurant": "NeoCyber/m-e5-small-vlsp2018-restaurant",
    "hotel": "NeoCyber/m-e5-small-vlsp2018-hotel",
    "hospital": "NeoCyber/m-e5-small-hosrev",
}

DEFAULT_DOMAIN_TEENCODE_PATHS = {
    "restaurant": "training/teencode/res_teencode.txt",
    "hotel": "training/teencode/hotel_teencode.txt",
    "hospital": "training/teencode/hosRev_teencode.txt",
}


@dataclass
class ModelManager:
    model_repos: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_DOMAIN_MODEL_REPOS))
    default_domain: str = "restaurant"
    teencode_path: str = "training/teencode/res_teencode.txt"
    teencode_paths: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_DOMAIN_TEENCODE_PATHS))
    max_length: int = 256
    batch_size: int = 16
    use_text_preprocessing: bool = True
    use_word_segmentation: bool = True
    prefer_local_cache: bool = False

    def __post_init__(self) -> None:
        self._models: dict[str, "ABSAInferenceModel"] = {}

    def _resolve_domain(self, domain: str) -> str:
        if domain in self.model_repos:
            return domain
        return self.default_domain

    def model_repo_id(self, domain: str) -> str:
        resolved = self._resolve_domain(domain)
        return self.model_repos[resolved]

    def teencode_path_for(self, domain: str) -> str:
        resolved = self._resolve_domain(domain)
        return self.teencode_paths.get(resolved, self.teencode_path)

    def get_model(self, domain: str) -> ABSAInferenceModel:
        from .model import ABSAInferenceConfig, ABSAInferenceModel

        resolved = self._resolve_domain(domain)
        if resolved not in self._models:
            cfg = ABSAInferenceConfig(
                model_repo_id=self.model_repos[resolved],
                teencode_path=self.teencode_path_for(resolved),
                max_length=self.max_length,
                batch_size=self.batch_size,
                use_text_preprocessing=self.use_text_preprocessing,
                use_word_segmentation=self.use_word_segmentation,
                prefer_local_cache=self.prefer_local_cache,
            )
            self._models[resolved] = ABSAInferenceModel(cfg)
        return self._models[resolved]

    def predict(self, domain: str, reviews: list[str]) -> list[dict[str, str | None]]:
        if not reviews:
            return []
        return self.get_model(domain).predict(reviews)

    def preload(self) -> None:
        """Eagerly load all configured domain models into memory."""
        for domain in self.model_repos:
            self.get_model(domain)

    @property
    def loaded_domains(self) -> list[str]:
        return list(self._models.keys())
