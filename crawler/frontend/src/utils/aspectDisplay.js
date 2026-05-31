const GROUP_TRANSLATIONS = {
  AMBIENCE: "Không gian",
  DRINKS: "Đồ uống",
  FACILITIES: "Cơ sở vật chất",
  FOOD: "Đồ ăn",
  "FOOD&DRINKS": "Đồ ăn & thức uống",
  HOTEL: "Khách sạn",
  LOCATION: "Vị trí",
  RESTAURANT: "Nhà hàng",
  ROOMS: "Phòng",
  ROOM_AMENITIES: "Tiện ích phòng",
  SERVICE: "Dịch vụ"
};

const ATTRIBUTE_TRANSLATIONS = {
  CLEANLINESS: "Vệ sinh",
  COMFORT: "Sự thoải mái",
  "DESIGN&FEATURES": "Thiết kế & trang bị",
  GENERAL: "Tổng quan",
  MISCELLANEOUS: "Khác",
  PRICES: "Giá cả",
  QUALITY: "Chất lượng",
  "STYLE&OPTIONS": "Phong cách & lựa chọn"
};

export function aspectDisplayName(itemOrRaw) {
  if (itemOrRaw && typeof itemOrRaw === "object" && itemOrRaw.display_name) {
    return itemOrRaw.display_name;
  }
  const raw = String(typeof itemOrRaw === "string" ? itemOrRaw : itemOrRaw?.aspect || "").replace(/\\u0026/g, "&");
  const [group, attribute = ""] = raw.split("#");
  const groupName = GROUP_TRANSLATIONS[group] || group.replace(/_/g, " ");
  const attributeName = ATTRIBUTE_TRANSLATIONS[attribute] || attribute.replace(/_/g, " ");
  return attributeName ? `${groupName} - ${attributeName}` : groupName;
}
