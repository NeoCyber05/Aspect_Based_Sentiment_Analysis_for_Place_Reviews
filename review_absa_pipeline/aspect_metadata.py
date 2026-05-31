from __future__ import annotations

from typing import Any


GROUP_TRANSLATIONS = {
    "AMBIENCE": "Không gian",
    "DRINKS": "Đồ uống",
    "FACILITIES": "Cơ sở vật chất",
    "FOOD": "Đồ ăn",
    "FOOD&DRINKS": "Đồ ăn & thức uống",
    "HOTEL": "Khách sạn",
    "LOCATION": "Vị trí",
    "RESTAURANT": "Nhà hàng",
    "ROOMS": "Phòng",
    "ROOM_AMENITIES": "Tiện ích phòng",
    "SERVICE": "Dịch vụ",
}


ATTRIBUTE_TRANSLATIONS = {
    "CLEANLINESS": "Vệ sinh",
    "COMFORT": "Sự thoải mái",
    "DESIGN&FEATURES": "Thiết kế & trang bị",
    "GENERAL": "Tổng quan",
    "MISCELLANEOUS": "Khác",
    "PRICES": "Giá cả",
    "QUALITY": "Chất lượng",
    "STYLE&OPTIONS": "Phong cách & lựa chọn",
}


FULL_TRANSLATIONS = {
    "Cơ sở vật chất#Chất lượng": ("Cơ sở vật chất", "Chất lượng"),
    "Cơ sở vật chất#Khác": ("Cơ sở vật chất", "Khác"),
    "Cơ sở vật chất#Không gian": ("Cơ sở vật chất", "Không gian"),
    "Cơ sở vật chất#Vệ sinh": ("Cơ sở vật chất", "Vệ sinh"),
    "Nhân viên y tế#Chất lượng": ("Nhân viên y tế", "Chất lượng"),
    "Nhân viên y tế#Khác": ("Nhân viên y tế", "Khác"),
    "Nhân viên y tế#Thái độ": ("Nhân viên y tế", "Thái độ"),
    "Trải nghiệm chung#Chất lượng": ("Trải nghiệm chung", "Chất lượng"),
    "Trải nghiệm chung#Giá": ("Trải nghiệm chung", "Giá"),
    "Trải nghiệm chung#Khác": ("Trải nghiệm chung", "Khác"),
    "Trải nghiệm chung#Không gian": ("Trải nghiệm chung", "Không gian"),
    "Trải nghiệm chung#Thái độ": ("Trải nghiệm chung", "Thái độ"),
    "Trải nghiệm chung#Vệ sinh": ("Trải nghiệm chung", "Vệ sinh"),
}


def _split_aspect(raw_name: str) -> tuple[str, str]:
    if raw_name in FULL_TRANSLATIONS:
        return FULL_TRANSLATIONS[raw_name]
    group, _, attribute = raw_name.replace("\\u0026", "&").partition("#")
    return group.strip(), attribute.strip()


def translate_aspect(raw_name: str, domain: str = "") -> dict[str, str]:
    normalized = str(raw_name or "").replace("\\u0026", "&").strip()
    group, attribute = _split_aspect(normalized)
    group_name = GROUP_TRANSLATIONS.get(group, group.replace("_", " "))
    attribute_name = ATTRIBUTE_TRANSLATIONS.get(attribute, attribute.replace("_", " "))
    display_name = group_name if not attribute_name else f"{group_name} - {attribute_name}"
    return {
        "raw_name": normalized,
        "display_name": display_name,
        "group_name": group_name,
        "attribute_name": attribute_name,
        "domain": str(domain or ""),
    }


def enrich_aspect_row(row: dict[str, Any], domain: str = "") -> dict[str, Any]:
    aspect = str(row.get("aspect", ""))
    return {
        **row,
        **translate_aspect(aspect, domain=domain),
    }
