from __future__ import annotations

import importlib
import os
import unicodedata
from dataclasses import asdict, dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class DomainRoute:
    domain: str
    confidence: float
    source: str
    fallback: bool = False

    def to_dict(self) -> dict[str, str | float | bool]:
        return asdict(self)


class DomainRouter(Protocol):
    def route(self, place: Any) -> DomainRoute:
        ...


def _value(place: Any, key: str) -> str:
    if isinstance(place, dict):
        return str(place.get(key, "") or "")
    return str(getattr(place, key, "") or "")


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return " ".join(text.split())


class RuleBasedDomainRouter:
    """Small deterministic fallback router used until a trained router is plugged in."""

    KEYWORDS = {
        "hotel": (
            "hotel",
            "khach san",
            "resort",
            "homestay",
            "motel",
            "villa",
        ),
        "hospital": (
            "hospital",
            "benh vien",
            "phong kham",
            "clinic",
            "medical",
            "nha thuoc",
            "pharmacy",
        ),
        "restaurant": (
            "restaurant",
            "nha hang",
            "quan an",
            "cafe",
            "coffee",
            "tra sua",
            "food",
            "banh",
            "bun",
            "pho",
        ),
    }

    def __init__(self, default_domain: str = "restaurant") -> None:
        self.default_domain = default_domain

    def route(self, place: Any) -> DomainRoute:
        text = _normalize(" ".join([_value(place, "title"), _value(place, "category")]))
        for domain, keywords in self.KEYWORDS.items():
            if any(keyword in text for keyword in keywords):
                return DomainRoute(
                    domain=domain,
                    confidence=0.92,
                    source="rule",
                    fallback=False,
                )
        return DomainRoute(
            domain=self.default_domain,
            confidence=0.35,
            source="default",
            fallback=True,
        )


class ExternalDomainRouter:
    """Adapter for a user-provided router module.

    Set ABSA_DOMAIN_ROUTER_MODULE to a module exposing either `route(place)` or
    `Router().route(place)`. Return values can be DomainRoute, dict, or string.
    """

    def __init__(self, module_name: str | None = None, fallback: DomainRouter | None = None) -> None:
        self.module_name = module_name or os.getenv("ABSA_DOMAIN_ROUTER_MODULE", "").strip()
        self.fallback = fallback or RuleBasedDomainRouter()
        self._router: Any | None = None

    def _load_router(self) -> Any:
        if not self.module_name:
            return None
        if self._router is not None:
            return self._router

        module = importlib.import_module(self.module_name)
        if hasattr(module, "Router"):
            self._router = module.Router()
        else:
            self._router = module
        return self._router

    def route(self, place: Any) -> DomainRoute:
        try:
            router = self._load_router()
            if router is None:
                return self.fallback.route(place)
            raw_route = router.route(place)
            if isinstance(raw_route, DomainRoute):
                return raw_route
            if isinstance(raw_route, dict):
                return DomainRoute(
                    domain=str(raw_route.get("domain", "") or self.fallback.route(place).domain),
                    confidence=float(raw_route.get("confidence", 0.0)),
                    source=str(raw_route.get("source", "external")),
                    fallback=bool(raw_route.get("fallback", False)),
                )
            return DomainRoute(
                domain=str(raw_route),
                confidence=0.8,
                source="external",
                fallback=False,
            )
        except Exception:
            route = self.fallback.route(place)
            return DomainRoute(
                domain=route.domain,
                confidence=route.confidence,
                source="external_error",
                fallback=True,
            )
