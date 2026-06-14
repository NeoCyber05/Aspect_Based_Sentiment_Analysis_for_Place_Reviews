import vietmapgl from "@vietmap/vietmap-gl-js/dist/vietmap-gl";
import "@vietmap/vietmap-gl-js/dist/vietmap-gl.css";
import { useEffect, useRef, useState } from "react";

const vietMapApiKey = import.meta.env.VITE_VIETMAP_API_KEY?.trim() || "";

function rasterFallbackStyle() {
  return {
    version: 8,
    sources: {
      "osm-raster": {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      {
        id: "osm-raster",
        type: "raster",
        source: "osm-raster",
      },
    ],
  };
}

function parseCoordinate(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getMarkerColor(rating) {
  if (rating === undefined || rating === null) return "#64748b";
  if (rating >= 4.0) return "#22c55e";
  if (rating >= 3.0) return "#f59e0b";
  return "#ef4444";
}

function scoreText(value) {
  return `${Number(value || 0).toFixed(1)}/5`;
}

export function AnalysisMap({ places, selectedPlaceId, onSelectPlace }) {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const [mapState, setMapState] = useState(vietMapApiKey ? "loading" : "missing-key");

  const placesWithCoords = places.filter((place) => {
    const lat = parseCoordinate(place.latitude);
    const lng = parseCoordinate(place.longitude);
    return lat !== null && lng !== null;
  });

  useEffect(() => {
    if (!mapElementRef.current) return undefined;

    setMapState(vietMapApiKey ? "loading" : "missing-key");
    if (!vietMapApiKey) return undefined;

    let lastMapError = "";
    const map = new vietmapgl.Map({
      container: mapElementRef.current,
      style: rasterFallbackStyle(),
      center: [106.657747, 10.772047],
      zoom: 10,
      accessToken: vietMapApiKey,
    });
    mapRef.current = map;
    map.addControl(new vietmapgl.NavigationControl(), "top-right");

    const markReady = () => setMapState("ready");
    const handleError = (event) => {
      lastMapError = event?.error?.message || "Không tải được tài nguyên bản đồ.";
      setMapState("error");
    };

    map.on("styledata", markReady);
    map.on("load", markReady);
    map.on("error", handleError);

    window.requestAnimationFrame(() => map.resize());

    return () => {
      map.off("styledata", markReady);
      map.off("load", markReady);
      map.off("error", handleError);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = new Map();

    if (placesWithCoords.length === 0) return;

    const bounds = new vietmapgl.LngLatBounds();

    placesWithCoords.forEach((place) => {
      const lat = parseCoordinate(place.latitude);
      const lng = parseCoordinate(place.longitude);
      const rating = place.adjusted_avg_rating ?? place.review_rating;
      const color = getMarkerColor(rating);
      const isSelected = place.title === selectedPlaceId;
      const placeId = place.title;

      const el = document.createElement("div");
      el.className = `dash-map-marker ${isSelected ? "dash-map-marker--selected" : ""}`;
      el.style.backgroundColor = color;
      el.style.width = isSelected ? "22px" : "16px";
      el.style.height = isSelected ? "22px" : "16px";

      const popup = new vietmapgl.Popup({ offset: 12 }).setHTML(
        `<div class="dash-map-popup">
          <strong>${place.title || "Địa điểm"}</strong>
          <span>${place.category || ""}</span>
          <span>Điểm TB: ${scoreText(rating)}</span>
          <span>${place.review_count || 0} review</span>
        </div>`
      );

      const marker = new vietmapgl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(map);

      marker.getElement().addEventListener("click", () => {
        onSelectPlace?.(placeId);
      });

      markersRef.current.set(placeId, marker);
      bounds.extend([lng, lat]);
    });

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 600 });
    }
  }, [placesWithCoords, mapState, onSelectPlace]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready" || !selectedPlaceId) return;

    const place = placesWithCoords.find(
      (p) => p.title === selectedPlaceId
    );
    if (!place) return;

    const lat = parseCoordinate(place.latitude);
    const lng = parseCoordinate(place.longitude);
    const marker = markersRef.current.get(selectedPlaceId);

    map.flyTo({ center: [lng, lat], zoom: 16, duration: 800 });
    marker?.togglePopup();
  }, [selectedPlaceId, placesWithCoords, mapState]);

  return (
    <div className="dash-map-wrap">
      <div className="dash-map-header">
        <h3>Bản đồ địa điểm đã cào</h3>
        <span>
          {placesWithCoords.length}/{places.length} địa điểm có tọa độ
        </span>
      </div>
      <div className="dash-map-canvas-wrap">
        <div ref={mapElementRef} className="dash-map-canvas" />
        {!vietMapApiKey && (
          <div className="dash-map-placeholder">
            <strong>Chưa cấu hình VietMap</strong>
            <span>Thêm VITE_VIETMAP_API_KEY vào .env.local để hiển thị bản đồ.</span>
          </div>
        )}
        {vietMapApiKey && mapState === "loading" && (
          <div className="dash-map-placeholder">
            <strong>Đang tải bản đồ...</strong>
          </div>
        )}
        {vietMapApiKey && mapState === "error" && (
          <div className="dash-map-placeholder error-state">
            <strong>Không tải được bản đồ</strong>
            <span>Kiểm tra API key VietMap và kết nối mạng.</span>
          </div>
        )}
      </div>
      <div className="dash-map-legend">
        <span className="dash-map-legend-item">
          <i style={{ background: "#22c55e" }} /> Tốt (≥4.0)
        </span>
        <span className="dash-map-legend-item">
          <i style={{ background: "#f59e0b" }} /> Trung bình (3.0–3.9)
        </span>
        <span className="dash-map-legend-item">
          <i style={{ background: "#ef4444" }} /> Kém (&lt;3.0)
        </span>
        <span className="dash-map-legend-item">
          <i style={{ background: "#64748b" }} /> Chưa có điểm
        </span>
      </div>
    </div>
  );
}
