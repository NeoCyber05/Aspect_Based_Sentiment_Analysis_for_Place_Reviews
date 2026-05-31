from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


def _num(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    return 0.0


def _top_positive_aspects(aspects: list[dict[str, Any]], limit: int = 3) -> list[dict[str, Any]]:
    rows = [item for item in aspects if int(item.get("positive", 0) or 0) > 0]
    return sorted(rows, key=lambda item: (int(item.get("positive", 0) or 0), int(item.get("mentions", 0) or 0)), reverse=True)[:limit]


def build_narrative_context(result: dict[str, Any]) -> dict[str, Any]:
    aspects = result.get("aspects") if isinstance(result.get("aspects"), list) else []
    alerts = result.get("alerts") if isinstance(result.get("alerts"), list) else []
    places = result.get("places") if isinstance(result.get("places"), list) else []
    overall = result.get("overall") if isinstance(result.get("overall"), dict) else {}
    return {
        "overall": {
            "mentions": int(overall.get("mentions", 0) or 0),
            "positive": int(overall.get("positive", 0) or 0),
            "neutral": int(overall.get("neutral", 0) or 0),
            "negative": int(overall.get("negative", 0) or 0),
            "positive_percent": round(_num(overall.get("positive_percent")), 2),
            "negative_percent": round(_num(overall.get("negative_percent")), 2),
        },
        "top_strengths": _top_positive_aspects(aspects),
        "alerts": alerts[:5],
        "places": [
            {
                "title": place.get("title", ""),
                "description_count": int(place.get("description_count", 0) or 0),
            }
            for place in places[:5]
        ],
    }


def generate_template_narrative(context: dict[str, Any]) -> dict[str, Any]:
    overall = context["overall"]
    strengths = [
        f"{item.get('display_name', item.get('aspect', 'Khía cạnh'))}: {item.get('positive', 0)} lượt tích cực trên {item.get('mentions', 0)} lượt đề cập."
        for item in context.get("top_strengths", [])
    ]
    issues = [
        f"{item.get('display_name', item.get('aspect', 'Khía cạnh'))}: {item.get('negative', 0)} lượt tiêu cực trên {item.get('mentions', 0)} lượt đề cập ({item.get('negative_percent', 0)}%)."
        for item in context.get("alerts", [])
    ]
    caveats = [
        item["sample_note"]
        for item in context.get("alerts", [])
        if str(item.get("sample_note", "")).startswith("Mẫu nhỏ")
    ]
    return {
        "source": "template",
        "summary": (
            f"Kết quả ABSA ghi nhận {overall['mentions']} lượt khía cạnh, "
            f"trong đó {overall['positive_percent']}% tích cực và {overall['negative_percent']}% tiêu cực."
        ),
        "strengths": strengths,
        "issues": issues,
        "recommended_actions": [
            "Ưu tiên đọc các review bằng chứng ở những khía cạnh có cảnh báo.",
            "Không kết luận mạnh với khía cạnh có rất ít lượt đề cập.",
        ],
        "caveats": caveats,
    }


def _build_prompt(context: dict[str, Any]) -> str:
    return (
        "Bạn là chuyên gia phân tích review khách hàng. "
        "Chỉ sử dụng JSON ABSA được cung cấp, không tự bịa thêm thông tin. "
        "Viết tiếng Việt ngắn gọn, có nhắc rõ khi dữ liệu mẫu ít. "
        "Trả về JSON hợp lệ với các key: summary, strengths, issues, recommended_actions, caveats.\n\n"
        f"ABSA_JSON:\n{json.dumps(context, ensure_ascii=False)}"
    )


def generate_ollama_narrative(context: dict[str, Any], base_url: str, model: str, timeout_seconds: float = 45.0) -> dict[str, Any]:
    request = urllib.request.Request(
        url=base_url.rstrip("/") + "/api/generate",
        method="POST",
        data=json.dumps({"model": model, "prompt": _build_prompt(context), "stream": False}, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        payload = json.loads(response.read().decode("utf-8"))
    generated = json.loads(str(payload.get("response", "{}")).strip())
    return {"source": "ollama", **generated}


def generate_narrative(result: dict[str, Any], use_ollama: bool = True) -> dict[str, Any]:
    context = build_narrative_context(result)
    if not use_ollama:
        return generate_template_narrative(context)
    base_url = os.getenv("ABSA_OLLAMA_URL", "http://localhost:11434")
    model = os.getenv("ABSA_OLLAMA_MODEL", "llama3.2:3b")
    try:
        return generate_ollama_narrative(context, base_url=base_url, model=model)
    except (OSError, TimeoutError, urllib.error.URLError, json.JSONDecodeError, ValueError):
        return generate_template_narrative(context)
