# Cải Thiện Hiển Thị Kết Quả Phân Tích ABSA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cải thiện giao diện hiển thị kết quả phân tích ABSA với tên khía cạnh tiếng Việt, hiển thị sentiment thay vì điểm số, và tích hợp Ollama để tạo lời phân tích tự nhiên.

**Architecture:** 
- Frontend: Thêm bản dịch tiếng Việt cho aspect names, thay đổi UI từ score-based sang sentiment-based display với biểu đồ phân bố sentiment
- Backend: Tích hợp Ollama API để post-process kết quả ABSA và tạo natural language insights
- Service: Thêm endpoint mới để generate insights từ analysis results

**Tech Stack:** React (Frontend), Go (Backend), Python FastAPI (ABSA Service), Ollama (LLM for insights generation)

---

## File Structure

### Files to Create:
- `crawler/frontend/src/utils/aspectTranslations.js` - Aspect name translations Vietnamese
- `crawler/frontend/src/components/SentimentBar.jsx` - New sentiment distribution component
- `crawler/frontend/src/components/AspectInsight.jsx` - Display AI-generated insights
- `crawler/backend/internal/app/ollama_client.go` - Ollama API client
- `crawler/backend/internal/app/insight_generator.go` - Generate insights from analysis
- `review_absa_pipeline/insight_generator.py` - Python-side insight generation (optional)

### Files to Modify:
- `crawler/frontend/src/App.jsx` - Update AspectRows, add new components
- `crawler/frontend/src/styles.css` - New styles for sentiment display
- `crawler/backend/internal/app/analyzer.go` - Add insight generation endpoint
- `review_absa_pipeline/service.py` - Add insight generation endpoint (optional)

---

## Task 1: Tạo Bản Dịch Aspect Names Tiếng Việt

**Files:**
- Create: `crawler/frontend/src/utils/aspectTranslations.js`

- [ ] **Step 1: Tạo file translation mapping**

```javascript
// crawler/frontend/src/utils/aspectTranslations.js

/**
 * Bản dịch tên khía cạnh từ tiếng Anh sang tiếng Việt
 * Format: "CATEGORY#ATTRIBUTE" -> "Danh mục - Thuộc tính"
 */
export const ASPECT_TRANSLATIONS = {
  // Hotel aspects
  "HOTEL#GENERAL": "Khách sạn - Tổng quan",
  "HOTEL#CLEANLINESS": "Khách sạn - Vệ sinh",
  "HOTEL#COMFORT": "Khách sạn - Tiện nghi",
  "HOTEL#DESIGN&FEATURES": "Khách sạn - Thiết kế & Trang bị",
  "HOTEL#PRICES": "Khách sạn - Giá cả",
  "HOTEL#QUALITY": "Khách sạn - Chất lượng",
  "HOTEL#MISCELLANEOUS": "Khách sạn - Khác",

  // Rooms aspects
  "ROOMS#GENERAL": "Phòng - Tổng quan",
  "ROOMS#CLEANLINESS": "Phòng - Vệ sinh",
  "ROOMS#COMFORT": "Phòng - Tiện nghi",
  "ROOMS#DESIGN&FEATURES": "Phòng - Thiết kế & Trang bị",
  "ROOMS#PRICES": "Phòng - Giá cả",
  "ROOMS#QUALITY": "Phòng - Chất lượng",
  "ROOMS#MISCELLANEOUS": "Phòng - Khác",

  // Room amenities
  "ROOM_AMENITIES#GENERAL": "Tiện ích phòng - Tổng quan",
  "ROOM_AMENITIES#CLEANLINESS": "Tiện ích phòng - Vệ sinh",
  "ROOM_AMENITIES#COMFORT": "Tiện ích phòng - Tiện nghi",
  "ROOM_AMENITIES#DESIGN&FEATURES": "Tiện ích phòng - Thiết kế & Trang bị",
  "ROOM_AMENITIES#PRICES": "Tiện ích phòng - Giá cả",
  "ROOM_AMENITIES#QUALITY": "Tiện ích phòng - Chất lượng",
  "ROOM_AMENITIES#MISCELLANEOUS": "Tiện ích phòng - Khác",

  // Service
  "SERVICE#GENERAL": "Dịch vụ - Tổng quan",

  // Location
  "LOCATION#GENERAL": "Vị trí - Tổng quan",

  // Food & Drinks
  "FOOD&DRINKS#QUALITY": "Đồ ăn & Thức uống - Chất lượng",
  "FOOD&DRINKS#PRICES": "Đồ ăn & Thức uống - Giá cả",
  "FOOD&DRINKS#STYLE&OPTIONS": "Đồ ăn & Thức uống - Phong cách & Lựa chọn",
  "FOOD&DRINKS#MISCELLANEOUS": "Đồ ăn & Thức uống - Khác",

  // Facilities
  "FACILITIES#GENERAL": "Cơ sở vật chất - Tổng quan",
  "FACILITIES#CLEANLINESS": "Cơ sở vật chất - Vệ sinh",
  "FACILITIES#COMFORT": "Cơ sở vật chất - Tiện nghi",
  "FACILITIES#DESIGN&FEATURES": "Cơ sở vật chất - Thiết kế & Trang bị",
  "FACILITIES#PRICES": "Cơ sở vật chất - Giá cả",
  "FACILITIES#QUALITY": "Cơ sở vật chất - Chất lượng",
  "FACILITIES#MISCELLANEOUS": "Cơ sở vật chất - Khác",

  // Restaurant aspects (for future domains)
  "RESTAURANT#GENERAL": "Nhà hàng - Tổng quan",
  "RESTAURANT#PRICES": "Nhà hàng - Giá cả",
  "RESTAURANT#QUALITY": "Nhà hàng - Chất lượng",
  "RESTAURANT#STYLE&OPTIONS": "Nhà hàng - Phong cách & Lựa chọn",
  "RESTAURANT#MISCELLANEOUS": "Nhà hàng - Khác",

  // Ambience
  "AMBIENCE#GENERAL": "Không gian - Tổng quan",

  // Laptop aspects (for future domains)
  "LAPTOP#GENERAL": "Laptop - Tổng quan",
  "LAPTOP#DESIGN&FEATURES": "Laptop - Thiết kế & Tính năng",
  "LAPTOP#PRICES": "Laptop - Giá cả",
  "LAPTOP#QUALITY": "Laptop - Chất lượng",
  "LAPTOP#OPERATION&PERFORMANCE": "Laptop - Hiệu năng & Vận hành",
  "LAPTOP#PORTABILITY": "Laptop - Tính di động",
  "LAPTOP#MISCELLANEOUS": "Laptop - Khác",
};

/**
 * Dịch tên aspect sang tiếng Việt
 * @param {string} aspectKey - Aspect key (e.g., "HOTEL#CLEANLINESS")
 * @returns {string} - Tên tiếng Việt hoặc tên gốc nếu không tìm thấy
 */
export function translateAspect(aspectKey) {
  if (!aspectKey) return "";
  
  // Normalize the key (replace & with &)
  const normalizedKey = String(aspectKey).replace(/\\u0026/g, "&");
  
  return ASPECT_TRANSLATIONS[normalizedKey] || aspectKey;
}

/**
 * Lấy category từ aspect key
 * @param {string} aspectKey - Aspect key (e.g., "HOTEL#CLEANLINESS")
 * @returns {string} - Category (e.g., "HOTEL")
 */
export function getAspectCategory(aspectKey) {
  if (!aspectKey) return "";
  const parts = String(aspectKey).split("#");
  return parts[0] || "";
}

/**
 * Lấy attribute từ aspect key
 * @param {string} aspectKey - Aspect key (e.g., "HOTEL#CLEANLINESS")
 * @returns {string} - Attribute (e.g., "CLEANLINESS")
 */
export function getAspectAttribute(aspectKey) {
  if (!aspectKey) return "";
  const parts = String(aspectKey).split("#");
  return parts[1] || "";
}
