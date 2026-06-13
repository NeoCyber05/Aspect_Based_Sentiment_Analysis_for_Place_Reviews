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


def _build_by_domain(places: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for place in places:
        domain_name = str((place.get("domain") or {}).get("domain", "unknown"))
        if domain_name not in grouped:
            grouped[domain_name] = {
                "domain": domain_name,
                "place_count": 0,
                "review_count": 0,
                "top_positive": [],
                "top_negative": [],
            }
        entry = grouped[domain_name]
        entry["place_count"] += 1
        entry["review_count"] += int(place.get("description_count", 0) or 0)
        for asp in place.get("top_positive_aspects", [])[:3]:
            entry["top_positive"].append({
                "display_name": asp.get("display_name", asp.get("aspect", "")),
                "positive": int(asp.get("positive", 0) or 0),
                "mentions": int(asp.get("mentions", 0) or 0),
            })
        for asp in place.get("top_negative_aspects", [])[:3]:
            entry["top_negative"].append({
                "display_name": asp.get("display_name", asp.get("aspect", "")),
                "negative": int(asp.get("negative", 0) or 0),
                "mentions": int(asp.get("mentions", 0) or 0),
                "negative_percent": round(float(asp.get("negative_percent", 0.0) or 0.0), 1),
            })
    for entry in grouped.values():
        seen_pos: set[str] = set()
        deduped_pos = []
        for asp in entry["top_positive"]:
            key = asp["display_name"]
            if key not in seen_pos:
                seen_pos.add(key)
                deduped_pos.append(asp)
        entry["top_positive"] = sorted(deduped_pos, key=lambda x: x["positive"], reverse=True)[:3]
        seen_neg: set[str] = set()
        deduped_neg = []
        for asp in entry["top_negative"]:
            key = asp["display_name"]
            if key not in seen_neg:
                seen_neg.add(key)
                deduped_neg.append(asp)
        entry["top_negative"] = sorted(deduped_neg, key=lambda x: x["negative"], reverse=True)[:3]
    return sorted(grouped.values(), key=lambda x: x["review_count"], reverse=True)


_DOMAIN_PROFILES: dict[str, str] = {
    "hotel": (
        "Khách sạn / Resort / Homestay: các khía cạnh quan trọng gồm "
        "phòng ốc (vệ sinh, tiện nghi, thiết kế), dịch vụ lễ tân, vị trí & di chuyển, "
        "đồ ăn sáng, giá trị so với giá tiền, yên tĩnh & an toàn."
    ),
    "restaurant": (
        "Nhà hàng / Quán ăn / Cafe: các khía cạnh quan trọng gồm "
        "chất lượng & hương vị món ăn, thức uống, thái độ phục vụ, "
        "không gian & vệ sinh, giá cả, thời gian chờ."
    ),
    "hospital": (
        "Bệnh viện / Phòng khám: các khía cạnh quan trọng gồm "
        "thời gian chờ khám, thái độ bác sĩ & y tá, chi phí & tính minh bạch, "
        "cơ sở vật chất & thiết bị, kết quả điều trị, quy trình thủ tục."
    ),
}

_SYSTEM_BASE = (
    "Bạn là chuyên gia phân tích trải nghiệm khách hàng tại Việt Nam. "
    "Nhiệm vụ: diễn giải kết quả ABSA (Aspect-Based Sentiment Analysis) thành nhận xét ngắn gọn, có cơ sở số liệu. "
    "Quy tắc bắt buộc:\n"
    "1. Chỉ dùng số liệu trong ABSA_JSON, không bịa thêm thông tin.\n"
    "2. Trích dẫn con số cụ thể khi nhận xét (ví dụ: '82/128 lượt tích cực').\n"
    "3. Ghi rõ cảnh báo khi khía cạnh có ít hơn 5 lượt đề cập (mẫu nhỏ).\n"
    "4. Viết tiếng Việt, ngắn gọn, tránh sáo ngữ.\n"
    "5. Trả về JSON hợp lệ với đúng các key: summary, strengths, issues, recommended_actions, caveats.\n"
    "   - summary: string, tổng quan 1-2 câu.\n"
    "   - strengths: list[string], mỗi điểm mạnh 1 dòng.\n"
    "   - issues: list[string], mỗi vấn đề 1 dòng.\n"
    "   - recommended_actions: list[string], hành động cụ thể.\n"
    "   - caveats: list[string], lưu ý về độ tin cậy dữ liệu.\n"
)


def _build_system_prompt(by_domain: list[dict[str, Any]]) -> str:
    present_domains = {entry["domain"] for entry in by_domain}
    profiles = [
        profile
        for domain, profile in _DOMAIN_PROFILES.items()
        if domain in present_domains
    ]
    if profiles:
        domain_section = "\nBối cảnh domain:\n" + "\n".join(f"- {p}" for p in profiles) + "\n"
    else:
        domain_section = ""
    return _SYSTEM_BASE + domain_section


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
        "by_domain": _build_by_domain(places),
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
    for entry in context.get("by_domain", []):
        domain = entry.get("domain", "")
        for asp in entry.get("top_positive", []):
            line = f"[{domain}] {asp['display_name']}: {asp['positive']} lượt tích cực trên {asp['mentions']} lượt đề cập."
            if line not in strengths:
                strengths.append(line)
        for asp in entry.get("top_negative", []):
            line = f"[{domain}] {asp['display_name']}: {asp['negative']} lượt tiêu cực trên {asp['mentions']} lượt đề cập ({asp['negative_percent']}%)."
            if line not in issues:
                issues.append(line)
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
        "Dưới đây là kết quả ABSA. Hãy phân tích và trả về JSON theo đúng schema đã quy định.\n\n"
        f"ABSA_JSON:\n{json.dumps(context, ensure_ascii=False)}"
    )


def generate_ollama_narrative(context: dict[str, Any], base_url: str, model: str, timeout_seconds: float = 45.0) -> dict[str, Any]:
    by_domain = context.get("by_domain", [])
    system_prompt = _build_system_prompt(by_domain)
    payload = {
        "model": model,
        "system": system_prompt,
        "prompt": _build_prompt(context),
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.2},
    }
    request = urllib.request.Request(
        url=base_url.rstrip("/") + "/api/generate",
        method="POST",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        raw = json.loads(response.read().decode("utf-8"))
    generated = json.loads(str(raw.get("response", "{}")).strip())
    return {"source": "ollama", **generated}


def generate_narrative(result: dict[str, Any], use_ollama: bool = True) -> dict[str, Any]:
    context = build_narrative_context(result)
    if not use_ollama:
        return generate_template_narrative(context)
    base_url = os.getenv("ABSA_OLLAMA_URL", "http://localhost:11434")
    model = os.getenv("ABSA_OLLAMA_MODEL", "gemma4:e4b")
    try:
        return generate_ollama_narrative(context, base_url=base_url, model=model)
    except (OSError, TimeoutError, urllib.error.URLError, json.JSONDecodeError, ValueError):
        return generate_template_narrative(context)
