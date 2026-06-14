import vietmapgl from "@vietmap/vietmap-gl-js/dist/vietmap-gl";
import "@vietmap/vietmap-gl-js/dist/vietmap-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeJobCsv, createJob, deleteJob, downloadJobCsv, fetchJobAnalysis, fetchJobs } from "./api";
import { AnalysisDashboard } from "./components/AnalysisDashboard";

const vietMapApiKey = import.meta.env.VITE_VIETMAP_API_KEY?.trim() || "";
const vietMapApiBase = "https://maps.vietmap.vn/api";

function rasterFallbackStyle() {
  return {
    version: 8,
    sources: {
      "osm-raster": {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors"
      }
    },
    layers: [
      {
        id: "osm-raster",
        type: "raster",
        source: "osm-raster"
      }
    ]
  };
}

const initialForm = {
  name: "",
  keywordsText: "",
  lang: "vi",
  radius: 10000,
  maxPlaces: 30,
  maxTimeSeconds: 600,
  urlMode: false,
  lat: "21.004781",
  lon: "105.845582",
  crawlMode: "full"
};

const defaultMapCenter = {
  // ĐH Bách Khoa TP.HCM - cổng Trần Đại Nghĩa
  lat: 10.772047,
  lng: 106.657747
};

const statusLabels = {
  pending: "Chờ xử lý",
  working: "Đang chạy",
  ok: "Hoàn tất",
  failed: "Thất bại"
};

const analysisStatusLabels = {
  pending: "Chưa phân tích",
  working: "Đang phân tích",
  ok: "Đã phân tích",
  failed: "Lỗi phân tích"
};

function formatDate(isoString) {
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("vi-VN");
}

function statusText(status) {
  return statusLabels[status] || status;
}

function analysisStatusText(status) {
  return analysisStatusLabels[status] || status || "Chưa phân tích";
}

function prettifyAspectName(raw) {
  return String(raw || "")
    .replace(/&/g, " & ")
    .replace(/#/g, " · ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function scoreText(value) {
  return `${Number(value || 0).toFixed(1)}/5`;
}

function percentText(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function visibleAspects(aspects) {
  return (Array.isArray(aspects) ? aspects : []).filter((item) => Number(item.mentions || 0) > 0);
}

// Chuyển đổi ngành hàng sang bảng dữ liệu
function domainSummaryRows(summary) {
  const domains = summary?.domains || {};
  return Object.entries(domains).map(([domain, metrics]) => ({ domain, ...metrics }));
}

function analysisButtonLabel(job, busy) {
  if (busy) return "Đang tải...";
  switch (job.analysis_status) {
    case "ok":
      return "Xem phân tích";
    case "failed":
      return "Chạy lại";
    case "working":
      return "Đang phân tích";
    default:
      return "Chạy phân tích";
  }
}

function formatCoordinate(value) {
  return Number(value).toFixed(6);
}

function parseCoordinate(value) {
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getLocationName(place, fallback) {
  const candidates = [
    place?.name,
    fallback?.name,
    place?.display,
    fallback?.display,
    place?.address,
    fallback?.address
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.predictions)) return data.predictions;
  return [];
}

function getRefID(item) {
  return item?.ref_id || item?.refid || item?.place_id || item?.id || "";
}

function getLatLng(item) {
  const lat = parseCoordinate(item?.lat ?? item?.latitude ?? item?.location?.lat);
  const lng = parseCoordinate(item?.lng ?? item?.lon ?? item?.longitude ?? item?.location?.lng);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

async function fetchVietMap(path, params, signal) {
  const url = new URL(`${vietMapApiBase}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url, { signal });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || data?.error || "Yêu cầu VietMap thất bại.");
  }

  if (data?.status && data.status !== "OK") {
    throw new Error(data?.message || data?.error_message || `VietMap trả về trạng thái ${data.status}.`);
  }

  return data;
}

const CRAWL_CIRCLE_SOURCE = "crawl-radius";
const EARTH_RADIUS_M = 6378137;

function formatRadius(meters) {
  const value = Number(meters) || 0;
  if (value >= 1000) {
    const km = value / 1000;
    return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
  }
  return `${Math.round(value)} m`;
}

// Xấp xỉ hình tròn (bán kính theo mét) thành polygon GeoJSON quanh tâm lat/lng.
function circlePolygon(lat, lng, radiusMeters, points = 72) {
  const coords = [];
  const latRad = (lat * Math.PI) / 180;
  for (let i = 0; i <= points; i += 1) {
    const theta = (i / points) * 2 * Math.PI;
    const dLng = ((radiusMeters * Math.cos(theta)) / (EARTH_RADIUS_M * Math.cos(latRad))) * (180 / Math.PI);
    const dLat = ((radiusMeters * Math.sin(theta)) / EARTH_RADIUS_M) * (180 / Math.PI);
    coords.push([lng + dLng, lat + dLat]);
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] } };
}

function circleBounds(lat, lng, radiusMeters) {
  const latRad = (lat * Math.PI) / 180;
  const dLat = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = (radiusMeters / (EARTH_RADIUS_M * Math.cos(latRad))) * (180 / Math.PI);
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat + dLat]
  ];
}

function PlacePicker({ apiKey, onPick, selectedLocation, radius }) {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onPickRef = useRef(onPick);
  const [mapState, setMapState] = useState(apiKey ? "loading" : "missing-key");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [pickStatus, setPickStatus] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  const placeMarker = useCallback((lat, lng, options = {}) => {
    if (!mapRef.current) return;

    const lngLat = [lng, lat];
    if (!markerRef.current) {
      markerRef.current = new vietmapgl.Marker({ color: "#0284c7" }).setLngLat(lngLat).addTo(mapRef.current);
    } else {
      markerRef.current.setLngLat(lngLat);
    }

    if (options.move) {
      mapRef.current.flyTo({
        center: lngLat,
        zoom: Math.max(mapRef.current.getZoom(), 16),
        duration: 650
      });
    }
  }, []);

  const ensureCircleLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || map.getSource(CRAWL_CIRCLE_SOURCE)) return;
    map.addSource(CRAWL_CIRCLE_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] }
    });
    map.addLayer({
      id: "crawl-radius-fill",
      type: "fill",
      source: CRAWL_CIRCLE_SOURCE,
      paint: { "fill-color": "#0284c7", "fill-opacity": 0.12 }
    });
    map.addLayer({
      id: "crawl-radius-line",
      type: "line",
      source: CRAWL_CIRCLE_SOURCE,
      paint: { "line-color": "#0284c7", "line-width": 2, "line-dasharray": [2, 1] }
    });
  }, []);

  useEffect(() => {
    if (!apiKey) {
      setMapState("missing-key");
      return undefined;
    }

    if (!mapElementRef.current) return undefined;

    let cancelled = false;
    let ready = false;
    let lastMapError = "";
    setMapState("loading");
    setPickStatus("");

    // VietMap tile (Web SDK) bị giới hạn theo plan/quota của API key (HTTP 423
    // "Your request is limited"), nên dùng nền OpenStreetMap làm chính. VietMap
    // vẫn được dùng cho tìm kiếm/geocode qua REST API (fetchVietMap).
    const start = selectedLocation || defaultMapCenter;
    const map = new vietmapgl.Map({
      container: mapElementRef.current,
      style: rasterFallbackStyle(),
      center: [start.lng, start.lat],
      zoom: selectedLocation ? 16 : 15,
      attributionControl: true
    });

    mapRef.current = map;
    map.addControl(new vietmapgl.NavigationControl(), "top-right");

    const readyTimer = window.setTimeout(() => {
      if (cancelled || ready) return;
      setMapState("error");
      setPickStatus(lastMapError || "Không tải được nền bản đồ OpenStreetMap.");
    }, 15000);

    const markReady = () => {
      if (cancelled || ready) return;
      ready = true;
      window.clearTimeout(readyTimer);
      setMapState("ready");
      ensureCircleLayers();
      window.requestAnimationFrame(() => map.resize());
      if (selectedLocation) {
        placeMarker(selectedLocation.lat, selectedLocation.lng);
      }
    };

    const handleError = (event) => {
      if (cancelled || ready) return;
      lastMapError = event?.error?.message || "Một tài nguyên bản đồ chưa tải được.";
      setPickStatus(`Một số tài nguyên bản đồ chưa tải được: ${lastMapError}`);
    };

    const handleClick = async (event) => {
      if (!event?.lngLat) return;

      const lat = event.lngLat.lat;
      const lng = event.lngLat.lng;
      placeMarker(lat, lng);
      setPickStatus("Đang lấy địa chỉ gần vị trí đã chọn...");

      try {
        const data = await fetchVietMap("/reverse/v4", {
          apikey: apiKey,
          lat,
          lng,
          display_type: 5
        });
        const result = normalizeList(data)[0] || data;
        const name = getLocationName(result);
        onPickRef.current({
          name,
          lat: formatCoordinate(lat),
          lon: formatCoordinate(lng)
        });
        setPickStatus(name ? `Đã chọn: ${name}` : "Đã cập nhật tọa độ từ bản đồ.");
      } catch (err) {
        onPickRef.current({
          lat: formatCoordinate(lat),
          lon: formatCoordinate(lng)
        });
        setPickStatus(err.name === "AbortError" ? "" : "Đã cập nhật tọa độ, nhưng chưa lấy được địa chỉ.");
      }
    };

    map.on("styledata", markReady);
    map.on("load", markReady);
    map.on("error", handleError);
    map.on("click", handleClick);

    return () => {
      cancelled = true;
      window.clearTimeout(readyTimer);
      markerRef.current?.remove();
      markerRef.current = null;
      map.off("styledata", markReady);
      map.off("load", markReady);
      map.off("error", handleError);
      map.off("click", handleClick);
      map.remove();
      mapRef.current = null;
    };
  }, [apiKey, placeMarker, ensureCircleLayers]);

  useEffect(() => {
    if (!selectedLocation) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    placeMarker(selectedLocation.lat, selectedLocation.lng);
  }, [placeMarker, selectedLocation]);

  // Cập nhật dữ liệu vòng tròn (polygon) khi tâm hoặc bán kính thay đổi.
  // Không gọi fitBounds ở đây để tránh zoom map mỗi khi chỉnh radius (sẽ khiến vòng tròn
  // lúc nào cũng "rất lớn" trên màn hình vì viewport luôn được fit vừa khít).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    ensureCircleLayers();
    const source = map.getSource(CRAWL_CIRCLE_SOURCE);
    if (!source) return;

    if (!selectedLocation || !(radius > 0)) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const { lat, lng } = selectedLocation;
    source.setData({ type: "FeatureCollection", features: [circlePolygon(lat, lng, radius)] });
  }, [selectedLocation, radius, mapState, ensureCircleLayers]);

  // Chỉ fitBounds (zoom/pan để vừa khung vòng tròn) khi thay đổi vị trí chọn (lần pick mới).
  // Không phụ thuộc vào radius để người dùng có thể chỉnh bán kính và thấy kích thước vòng tròn
  // thay đổi tương đối trên bản đồ ở mức zoom hiện tại.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapState !== "ready") return;
    if (!selectedLocation || !(radius > 0)) return;

    const { lat, lng } = selectedLocation;
    map.fitBounds(circleBounds(lat, lng, radius), { padding: 48, maxZoom: 16, duration: 600 });
  }, [selectedLocation, mapState]);

  useEffect(() => {
    const text = query.trim();
    setSearchError("");

    if (!apiKey || text.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const center = mapRef.current?.getCenter();
        const focus = center ? `${center.lat},${center.lng}` : `${defaultMapCenter.lat},${defaultMapCenter.lng}`;
        const data = await fetchVietMap(
          "/autocomplete/v4",
          {
            apikey: apiKey,
            text,
            focus,
            display_type: 5
          },
          controller.signal
        );
        setSuggestions(normalizeList(data).slice(0, 8));
      } catch (err) {
        if (err.name !== "AbortError") {
          setSearchError(err.message || "Không tìm được địa điểm.");
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      }
    }, 280);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiKey, query]);

  useEffect(() => {
    if (!isExpanded) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isExpanded]);

  useEffect(() => {
    if (!mapRef.current || mapState !== "ready") return undefined;

    const map = mapRef.current;
    const timer = window.setTimeout(() => map.resize(), 80);
    return () => window.clearTimeout(timer);
  }, [isExpanded, mapState]);

  async function chooseSuggestion(suggestion) {
    const fallbackName = getLocationName(suggestion) || "Địa điểm đã chọn";
    const refid = getRefID(suggestion);

    setQuery(fallbackName);
    setSuggestions([]);
    setSearchError("");
    setPickStatus("Đang lấy tọa độ địa điểm...");

    try {
      const detail = refid
        ? await fetchVietMap("/place/v4", {
            apikey: apiKey,
            refid
          })
        : suggestion;
      const location = getLatLng(detail) || getLatLng(suggestion);

      if (!location) {
        throw new Error("VietMap không trả về tọa độ cho địa điểm này.");
      }

      const name = getLocationName(detail, suggestion) || fallbackName;
      placeMarker(location.lat, location.lng, { move: true });
      onPickRef.current({
        name,
        lat: formatCoordinate(location.lat),
        lon: formatCoordinate(location.lng)
      });
      setPickStatus(`Đã chọn: ${name}`);
    } catch (err) {
      setPickStatus(err.message || "Không lấy được tọa độ địa điểm.");
    }
  }

  return (
    <>
      {isExpanded && (
        <div
          className="map-expanded-backdrop"
          onClick={() => setIsExpanded(false)}
          aria-hidden="true"
        />
      )}
      <section
        className={`panel map-panel${isExpanded ? " map-panel--expanded" : ""}`}
        aria-label="Chọn địa điểm trên bản đồ"
      >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">VietMap</p>
          <h2>Chọn địa điểm trên bản đồ</h2>
        </div>
        <div className="map-panel-actions">
          <button
            type="button"
            className="map-expand-button"
            onClick={() => setIsExpanded((expanded) => !expanded)}
            disabled={mapState !== "ready"}
            aria-label={isExpanded ? "Thu nhỏ bản đồ" : "Phóng to bản đồ"}
            title={isExpanded ? "Thu nhỏ bản đồ (Esc)" : "Phóng to bản đồ"}
          >
            {isExpanded ? "Thu nhỏ" : "Phóng to"}
          </button>
          <span className={`map-state ${mapState}`}>
            {mapState === "ready"
              ? "Sẵn sàng"
              : mapState === "loading"
                ? "Đang tải"
                : mapState === "error"
                  ? "Lỗi"
                  : "Cần cấu hình"}
          </span>
        </div>
      </div>

      <div className="map-search">
        <label htmlFor="place-search">Tìm địa điểm</label>
        <input
          id="place-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={!apiKey || mapState === "error"}
          autoComplete="off"
          placeholder="Nhập tên quán, địa chỉ hoặc địa danh..."
        />
        {(suggestions.length > 0 || searching || searchError) && (
          <div className="suggestions" role="listbox">
            {searching && <div className="suggestion muted">Đang tìm...</div>}
            {searchError && <div className="suggestion error-text">{searchError}</div>}
            {!searching &&
              suggestions.map((item) => {
                const label = getLocationName(item) || "Không có tên";
                return (
                  <button
                    type="button"
                    className="suggestion"
                    key={getRefID(item) || `${label}-${item.address || ""}`}
                    onClick={() => chooseSuggestion(item)}
                  >
                    <strong>{label}</strong>
                    <span>{item.display || item.address || "VietMap"}</span>
                  </button>
                );
              })}
          </div>
        )}
      </div>

      <div className="map-canvas-wrap">
        <div ref={mapElementRef} className="map-canvas" />
        {selectedLocation && (
          <div className="map-scope-card">
            <span className="scope-pulse place" aria-hidden="true" />
            <div>
              <strong>Địa điểm được chọn</strong>
              <span>
                {formatCoordinate(selectedLocation.lat)}, {formatCoordinate(selectedLocation.lng)}
              </span>
              {radius > 0 && (
                <span className="map-scope-radius">Bán kính cào: {formatRadius(radius)}</span>
              )}
            </div>
          </div>
        )}
        {!apiKey && (
          <div className="map-placeholder">
            <strong>VietMap chưa được cấu hình</strong>
            <span>Thêm VITE_VIETMAP_API_KEY vào file .env.local để kích hoạt bản đồ VietMap.</span>
          </div>
        )}
        {apiKey && mapState === "loading" && (
          <div className="map-placeholder">
            <strong>Đang tải bản đồ</strong>
            <span>Giao diện nhập thủ công bên cạnh vẫn có thể sử dụng.</span>
          </div>
        )}
        {apiKey && mapState === "error" && (
          <div className="map-placeholder error-state">
            <strong>Không tải được VietMap</strong>
            <span>{pickStatus || "Hãy kiểm tra API key VietMap và quyền sử dụng Web SDK."}</span>
          </div>
        )}
      </div>

      <div className="map-footer">
        <span>
          {pickStatus || "Tìm địa điểm bằng thanh tìm kiếm hoặc click trực tiếp lên bản đồ để lấy tọa độ và địa chỉ."}
        </span>
        {isExpanded && <span className="map-expanded-hint">Nhấn Esc hoặc Thu nhỏ để quay lại.</span>}
      </div>
    </section>
    </>
  );
}

function AnalysisQueue({ jobs, analyzingJobID, onViewAnalysis, onAnalyze, activeJobID }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // "all" | "ready" | "pending"

  const filtered = jobs.filter((job) => {
    const matchSearch =
      !search ||
      job.name.toLowerCase().includes(search.toLowerCase()) ||
      (job.keywords || []).some((k) => k.toLowerCase().includes(search.toLowerCase()));
    const analysisStatus = job.analysis_status || "pending";
    const matchFilter =
      filter === "all" ||
      (filter === "ready" && analysisStatus === "ok") ||
      (filter === "pending" && analysisStatus !== "ok");
    return matchSearch && matchFilter;
  });

  const readyCount = jobs.filter((j) => (j.analysis_status || "pending") === "ok").length;
  const pendingCount = jobs.length - readyCount;

  return (
    <section className="panel analysis-queue analysis-queue--full">
      <div className="aq-header">
        <div className="aq-title-row">
          <div>
            <span className="aq-title">Khu vực khảo sát đã cào</span>
            <span className="aq-subtitle">Ấn vào một khu vực để mở bảng phân tích ABSA.</span>
          </div>
          <span className="job-count">{jobs.length}</span>
        </div>

        <div className="aq-search-wrap">
          <span className="aq-search-icon">⌕</span>
          <input
            className="aq-search"
            type="text"
            placeholder="Tìm theo tên khu vực, từ khóa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="aq-clear" onClick={() => setSearch("")} aria-label="Xóa">
              ×
            </button>
          )}
        </div>

        <div className="aq-filter-row">
          <button
            type="button"
            className={`aq-filter-btn ${filter === "all" ? "aq-filter-btn--active" : ""}`}
            onClick={() => setFilter("all")}
          >
            Tất cả <em>{jobs.length}</em>
          </button>
          <button
            type="button"
            className={`aq-filter-btn ${filter === "ready" ? "aq-filter-btn--active" : ""}`}
            onClick={() => setFilter("ready")}
          >
            Đã phân tích <em>{readyCount}</em>
          </button>
          <button
            type="button"
            className={`aq-filter-btn ${filter === "pending" ? "aq-filter-btn--active" : ""}`}
            onClick={() => setFilter("pending")}
          >
            Chưa phân tích <em>{pendingCount}</em>
          </button>
        </div>
      </div>

      <div className="aq-list aq-list--grid">
        {filtered.length === 0 ? (
          <p className="aq-empty">
            {jobs.length === 0
              ? "Chưa có khu vực khảo sát nào. Hãy thu thập dữ liệu trước."
              : "Không tìm thấy khu vực phù hợp."}
          </p>
        ) : (
          filtered.map((job) => {
            const busy = analyzingJobID === job.id;
            const analysisStatus = job.analysis_status || "pending";
            const analysisReady = analysisStatus === "ok";
            const analysisWorking = analysisStatus === "working";
            const isActive = activeJobID === job.id && analysisReady;
            const disabled = job.status !== "ok" || busy || analysisWorking;
            const openItem = () => (analysisReady ? onViewAnalysis(job.id) : onAnalyze(job.id));
            return (
              <article
                key={job.id}
                className={`aq-item ${isActive ? "aq-item--active" : ""} ${
                  analysisReady ? "aq-item--ready" : ""
                } ${disabled ? "aq-item--disabled" : ""}`}
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-disabled={disabled}
                onClick={() => !disabled && openItem()}
                onKeyDown={(event) => {
                  if ((event.key === "Enter" || event.key === " ") && !disabled) {
                    event.preventDefault();
                    openItem();
                  }
                }}
              >
                <div className="aq-item-top">
                  <span className={`aq-status-dot aq-status-dot--${analysisStatus}`} aria-hidden />
                  <strong className="aq-item-name" title={job.name}>
                    {job.name}
                  </strong>
                </div>
                {job.keywords?.length > 0 && (
                  <div className="aq-item-keywords">
                    {job.keywords.slice(0, 3).map((k) => (
                      <span key={k} className="aq-keyword">{k}</span>
                    ))}
                    {job.keywords.length > 3 && (
                      <span className="aq-keyword aq-keyword--more">+{job.keywords.length - 3}</span>
                    )}
                  </div>
                )}
                {job.crawl_progress && (
                  <div className="aq-item-crawl">
                    <span>Đã cào {job.crawl_progress.places_crawled} địa điểm · {job.crawl_progress.reviews_crawled} review</span>
                  </div>
                )}
                <div className="aq-item-footer">
                  <span className={`aq-item-status aq-item-status--${analysisStatus}`}>
                    {analysisStatusText(analysisStatus)}
                  </span>
                  <span
                    className={`aq-item-cta ${
                      analysisReady ? "aq-item-cta--ready" : "aq-item-cta--run"
                    }`}
                  >
                    {busy || analysisWorking ? <span className="aq-spinner" /> : null}
                    {analysisButtonLabel(job, busy)}
                  </span>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activeScreen, setActiveScreen] = useState("analysis");
  const [activeTab, setActiveTab] = useState("full");
  const [analysisMode, setAnalysisMode] = useState("area");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisJobID, setAnalysisJobID] = useState("");
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [analyzingJobID, setAnalyzingJobID] = useState("");
  const [jobToDelete, setJobToDelete] = useState(null);

  const keywords = useMemo(
    () =>
      form.keywordsText
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
    [form.keywordsText]
  );

  const selectedLocation = useMemo(() => {
    const lat = parseCoordinate(form.lat);
    const lng = parseCoordinate(form.lon);
    if (lat === null || lng === null) return null;
    return { lat, lng };
  }, [form.lat, form.lon]);

  const filteredJobs = useMemo(
    () => jobs.filter((job) => (job.crawl_mode || "full") === activeTab),
    [activeTab, jobs]
  );

  const analysisJobs = useMemo(
    () =>
      jobs.filter((job) => {
        const crawlMode = job.crawl_mode || "full";
        return crawlMode === "full" && (job.status === "ok" || job.analysis_status);
      }),
    [jobs]
  );
  const selectedAnalysisJob = useMemo(() => jobs.find((job) => job.id === analysisJobID), [analysisJobID, jobs]);

  async function loadJobs() {
    setLoadingJobs(true);
    try {
      const data = await fetchJobs();
      setJobs(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingJobs(false);
    }
  }

  useEffect(() => {
    loadJobs();
    const timer = setInterval(loadJobs, 5000);
    return () => clearInterval(timer);
  }, []);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const handleMapPick = useCallback((selection) => {
    setForm((prev) => ({
      ...prev,
      name: selection.name ? selection.name : prev.name,
      keywordsText: selection.name ? selection.name : prev.keywordsText,
      lat: selection.lat,
      lon: selection.lon
    }));
    setError("");
    setMessage(
      selection.name
        ? `Đã điền thông tin địa điểm: ${selection.name}`
        : "Đã cập nhật tọa độ từ bản đồ."
    );
  }, []);

  async function onSubmit(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    if (!form.name.trim()) {
      setError("Vui lòng nhập tên job.");
      return;
    }

    if (keywords.length === 0) {
      setError("Vui lòng nhập ít nhất 1 từ khóa.");
      return;
    }

    setSubmitting(true);
    try {
      const commonPayload = {
        name: form.name.trim(),
        url_mode: form.urlMode,
        lang: form.lang.trim() || "vi",
        zoom: 15,
        lat: form.lat.trim(),
        lon: form.lon.trim(),
        fast_mode: false,
        radius: Number(form.radius),
        depth: 50,
        max_places: Number(form.maxPlaces),
        extra_reviews: true,
        max_time_seconds: Number(form.maxTimeSeconds),
        crawl_mode: form.crawlMode
      };

      await createJob({
        ...commonPayload,
        keywords
      });
      setMessage("Đã khởi tạo job cào dữ liệu thành công.");

      setForm((prev) => ({ ...initialForm, lang: prev.lang }));
      await loadJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteJobConfirmed(jobID) {
    setError("");
    setMessage("");
    try {
      await deleteJob(jobID);
      setMessage("Đã xóa job thành công.");
      await loadJobs();
    } catch (err) {
      setError(err.message);
    }
  }

  async function onAnalyze(jobID) {
    setError("");
    setMessage("");
    setAnalyzingJobID(jobID);
    try {
      const data = await analyzeJobCsv(jobID);
      setAnalysisResult(data || null);
      setAnalysisJobID(jobID);
      setActiveScreen("analysis");
      setMessage("Đã kích hoạt phân tích. Kết quả sẽ hiển thị sau vài giây.");
      await loadJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzingJobID("");
    }
  }

  async function onViewAnalysis(jobID) {
    setError("");
    setMessage("");
    setAnalyzingJobID(jobID);
    try {
      const data = await fetchJobAnalysis(jobID);
      if (data?.result) {
        setAnalysisResult(data.result);
        setAnalysisJobID(jobID);
        setActiveScreen("analysis");
        setAnalysisModalOpen(true);
        setMessage("Đã tải kết quả phân tích.");
      } else {
        setAnalysisResult(null);
        setAnalysisJobID(jobID);
        setActiveScreen("analysis");
        setAnalysisModalOpen(false);
        setMessage(`Trạng thái phân tích: ${analysisStatusText(data?.status?.status)}.`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzingJobID("");
    }
  }

  useEffect(() => {
    if (!analysisModalOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setAnalysisModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [analysisModalOpen]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo-area">
          <p className="eyebrow">Phân tích đánh giá thông minh</p>
          <h1>Review Intelligence</h1>
        </div>
        <div className="topbar-actions">
          <button type="button" className="ghost-button" onClick={loadJobs} disabled={loadingJobs}>
            {loadingJobs ? "Đang tải..." : "Làm mới dữ liệu"}
          </button>
        </div>
      </header>

      <nav className="screen-nav" aria-label="Menu chính">
        <button
          type="button"
          className={activeScreen === "analysis" ? "active" : ""}
          onClick={() => setActiveScreen("analysis")}
        >
          Phân tích
        </button>
        <button
          type="button"
          className={activeScreen === "crawler" ? "active" : ""}
          onClick={() => setActiveScreen("crawler")}
        >
          Thu Thập Dữ Liệu
        </button>
      </nav>

      {(message || error) && (
        <section className="notice-area" aria-live="polite">
          {message && <p className="message success">{message}</p>}
          {error && <p className="message error">{error}</p>}
        </section>
      )}

      {activeScreen === "analysis" ? (
        <main className="analysis-screen">
          <AnalysisQueue
            jobs={analysisJobs}
            analyzingJobID={analyzingJobID}
            onViewAnalysis={onViewAnalysis}
            onAnalyze={onAnalyze}
            activeJobID={analysisJobID}
          />
        </main>
      ) : (
        <>
          <main className="workspace-grid crawler-screen">
            <section className="panel form-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Thu thập dữ liệu</p>
                  <h2>Khởi tạo Job mới</h2>
                </div>
                <span className="keyword-count">{keywords.length} từ khóa</span>
              </div>

              <form onSubmit={onSubmit} className="form-grid">
                <label className="field full">
                  <span>Tên Job cào</span>
                  <input
                    value={form.name}
                    onChange={(e) => updateField("name", e.target.value)}
                    placeholder="Ví dụ: Cà phê đặc sản Hà Nội"
                  />
                </label>

                <label className="field full">
                  <span>Danh sách từ khóa (Mỗi dòng 1 từ khóa)</span>
                  <textarea
                    rows={5}
                    value={form.keywordsText}
                    onChange={(e) => updateField("keywordsText", e.target.value)}
                    placeholder={"Cà phê hồ tây\nQuán cafe đẹp hoàn kiếm"}
                  />
                </label>

                <label className="field">
                  <span>Ngôn ngữ</span>
                  <input value={form.lang} onChange={(e) => updateField("lang", e.target.value)} />
                </label>
                <label className="field">
                  <span>Bán kính tìm (m)</span>
                  <input
                    type="number"
                    value={form.radius}
                    onChange={(e) => updateField("radius", e.target.value)}
                    min={1}
                  />
                </label>
                <label className="field">
                  <span>Giới hạn địa điểm</span>
                  <input
                    type="number"
                    value={form.maxPlaces}
                    onChange={(e) => updateField("maxPlaces", e.target.value)}
                    min={0}
                    placeholder="0 = không giới hạn"
                  />
                </label>
                <label className="field">
                  <span>Thời gian chạy tối đa (s)</span>
                  <input
                    type="number"
                    value={form.maxTimeSeconds}
                    onChange={(e) => updateField("maxTimeSeconds", e.target.value)}
                    min={180}
                  />
                </label>
                <label className="field">
                  <span>Chế độ thu thập</span>
                  <select value={form.crawlMode} onChange={(e) => updateField("crawlMode", e.target.value)}>
                    <option value="full">Tải đầy đủ (Để phân tích)</option>
                    <option value="train">Chỉ tải Tiêu đề & Ngành hàng (Để huấn luyện)</option>
                  </select>
                </label>
                <label className="field">
                  <span>Vĩ độ (Latitude)</span>
                  <input value={form.lat} onChange={(e) => updateField("lat", e.target.value)} />
                </label>
                <label className="field">
                  <span>Kinh độ (Longitude)</span>
                  <input value={form.lon} onChange={(e) => updateField("lon", e.target.value)} />
                </label>

                <div className="toggles full">
                  <label>
                    <input
                      type="checkbox"
                      checked={form.urlMode}
                      onChange={(e) => updateField("urlMode", e.target.checked)}
                    />
                    <span>Chỉ dùng URL nguồn</span>
                  </label>
                </div>

                <div className="form-actions full">
                  <button type="submit" className="primary-button" disabled={submitting}>
                    {submitting ? "Đang gửi yêu cầu..." : "Bắt đầu thu thập"}
                  </button>
                </div>
              </form>
            </section>

            <PlacePicker
              apiKey={vietMapApiKey}
              onPick={handleMapPick}
              selectedLocation={selectedLocation}
              radius={Number(form.radius) || 0}
            />
          </main>

          <section className="panel jobs-panel">
            <div className="panel-heading jobs-heading">
              <div className="jobs-heading-row">
                <div>
                  <p className="eyebrow">Tiến trình</p>
                  <h2>Quản lý các Job đã khởi tạo</h2>
                </div>
                <span className="job-count">{filteredJobs.length} job hiển thị</span>
              </div>

              <div className="tabs" role="tablist" aria-label="Loại job">
                <button
                  type="button"
                  className={`tab-button ${activeTab === "full" ? "active" : ""}`}
                  onClick={() => setActiveTab("full")}
                >
                  Danh sách Job cào đầy đủ
                </button>
                <button
                  type="button"
                  className={`tab-button ${activeTab === "train" ? "active" : ""}`}
                  onClick={() => setActiveTab("train")}
                >
                  Danh sách Job cào huấn luyện
                </button>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Tên Job</th>
                    <th>Thu thập</th>
                    <th>Trạng thái phân tích</th>
                    <th>Ngày tạo</th>
                    <th>Từ khóa</th>
                    <th>Giới hạn địa điểm</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty-cell">
                        Chưa có job thu thập dữ liệu nào trong danh mục này.
                      </td>
                    </tr>
                  ) : (
                    filteredJobs.map((job) => {
                      const busy = analyzingJobID === job.id;
                      const analysisStatus = job.analysis_status || "pending";
                      const analysisReady = analysisStatus === "ok";
                      const analysisWorking = analysisStatus === "working";
                      const canAnalyze = job.status === "ok" && !busy && !analysisWorking;
                      return (
                        <tr key={job.id}>
                          <td className="job-name">{job.name}</td>
                          <td>
                            <span className={`status ${job.status}`}>{statusText(job.status)}</span>
                            {job.crawl_progress && (
                              <small className="crawl-progress">
                                Đã cào {job.crawl_progress.places_crawled} địa điểm · {job.crawl_progress.reviews_crawled} review
                              </small>
                            )}
                          </td>
                          <td>
                            <span className={`status analysis-status ${analysisStatus}`}>{analysisStatusText(analysisStatus)}</span>
                            {job.analysis_error && <small className="analysis-error">{job.analysis_error}</small>}
                          </td>
                          <td>{formatDate(job.created_at)}</td>
                          <td className="keywords-cell">{job.keywords?.join(", ") || "-"}</td>
                          <td>{job.max_places > 0 ? job.max_places : "Không giới hạn"}</td>
                          <td>
                            <div className="actions">
                              <button type="button" onClick={() => downloadJobCsv(job.id)} title="Tải xuống tập tin CSV">
                                Tải CSV
                              </button>
                              <button
                                type="button"
                                className="analysis"
                                onClick={() => (analysisReady ? onViewAnalysis(job.id) : onAnalyze(job.id))}
                                disabled={job.status !== "ok" || busy || analysisWorking}
                                title={job.status !== "ok" ? "Cần hoàn tất thu thập trước khi phân tích" : "Bắt đầu phân tích review"}
                              >
                                {analysisButtonLabel(job, busy)}
                              </button>
                              {analysisReady && (
                                <button
                                  type="button"
                                  className="re-analyze"
                                  onClick={() => onAnalyze(job.id)}
                                  disabled={!canAnalyze}
                                  title="Chạy lại mô hình phân tích cho bộ dữ liệu này"
                                >
                                  Chạy lại
                                </button>
                              )}
                              <button type="button" className="danger" onClick={() => setJobToDelete(job)} title="Xóa bỏ job này">
                                Xóa
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {analysisModalOpen && analysisResult && (
        <div
          className="analysis-modal-backdrop"
          onClick={() => setAnalysisModalOpen(false)}
        >
          <div
            className="analysis-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Dashboard phân tích ABSA"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="analysis-modal-header">
              <div>
                <p className="eyebrow">Không gian phân tích</p>
                <h2>{selectedAnalysisJob?.name || "Dashboard ABSA"}</h2>
              </div>
              <button
                type="button"
                className="analysis-modal-close"
                aria-label="Đóng"
                onClick={() => setAnalysisModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="analysis-modal-body">
              <AnalysisDashboard result={analysisResult} jobID={analysisJobID} />
            </div>
          </div>
        </div>
      )}

      {jobToDelete && (
        <div className="custom-modal-backdrop">
          <div className="custom-modal">
            <h3>Xác nhận xóa Job</h3>
            <p>
              Bạn có chắc chắn muốn xóa job <strong>{jobToDelete.name}</strong> không? Hành động này sẽ xóa vĩnh viễn dữ liệu cào được và kết quả phân tích.
            </p>
            <div className="custom-modal-actions">
              <button type="button" className="ghost-button" onClick={() => setJobToDelete(null)}>
                Hủy bỏ
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={async () => {
                  const id = jobToDelete.id;
                  setJobToDelete(null);
                  await deleteJobConfirmed(id);
                }}
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
