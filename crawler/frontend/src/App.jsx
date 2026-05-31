import vietmapgl from "@vietmap/vietmap-gl-js/dist/vietmap-gl";
import "@vietmap/vietmap-gl-js/dist/vietmap-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeJobCsv, createJob, deleteJob, downloadJobCsv, fetchJobAnalysis, fetchJobs, generateJobNarrative } from "./api";
import { SentimentBar } from "./components/SentimentBar";
import { NarrativePanel } from "./components/NarrativePanel";
import { aspectDisplayName } from "./utils/aspectDisplay";

const vietMapApiKey = import.meta.env.VITE_VIETMAP_API_KEY?.trim() || "";
const vietMapApiBase = "https://maps.vietmap.vn/api";
const vietMapStyleBase = "https://maps.vietmap.vn/maps/styles";

function appendVietMapApiKey(rawUrl, apiKey) {
  if (!apiKey || !rawUrl.startsWith("https://maps.vietmap.vn/")) {
    return rawUrl;
  }

  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has("apikey")) {
      url.searchParams.set("apikey", apiKey);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function vietMapStyleUrl(apiKey, style = "tm") {
  return appendVietMapApiKey(`${vietMapStyleBase}/${style}/style.json`, apiKey);
}

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

function isMapResourceError(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("failed to fetch") ||
    normalized.includes("401") ||
    normalized.includes("403") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("tile") ||
    normalized.includes("source")
  );
}

const initialForm = {
  name: "",
  keywordsText: "",
  lang: "vi",
  depth: 10,
  zoom: 15,
  radius: 10000,
  maxPlaces: 30,
  maxTimeSeconds: 600,
  fastMode: false,
  urlMode: false,
  email: false,
  extraReviews: true,
  lat: "",
  lon: "",
  crawlMode: "full"
};

const defaultMapCenter = {
  lat: 10.776889,
  lng: 106.700806
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

function AspectRows({ aspects, limit }) {
  const rows = Array.isArray(aspects) ? aspects : [];
  const shownRows = typeof limit === "number" ? rows.slice(0, limit) : rows;

  if (shownRows.length === 0) {
    return <p className="empty-analysis">Chưa có khía cạnh (aspect) nào được nhận diện.</p>;
  }

  return (
    <div className="aspect-list">
      {shownRows.map((item) => (
        <article className="aspect-row" key={item.aspect}>
          <div className="aspect-label">
            <strong>{aspectDisplayName(item)}</strong>
            <small>{item.mentions || 0} lượt đề cập</small>
          </div>
          <SentimentBar
            positive={item.positive || 0}
            neutral={item.neutral || 0}
            negative={item.negative || 0}
          />
        </article>
      ))}
    </div>
  );
}

function PlaceAnalysis({ places }) {
  const rows = Array.isArray(places) ? places : [];
  if (rows.length === 0) return null;

  return (
    <div className="place-analysis-list">
      {rows.map((place, index) => {
        const aspects = visibleAspects(place.aspects);
        const overall = place.overall || {};
        return (
          <article className="place-analysis" key={place.input_id || `${place.title}-${index}`}>
            <div className="place-analysis-heading">
              <div>
                <strong>{place.title || `Địa điểm ${index + 1}`}</strong>
                <span>
                  {place.description_count || 0} review có nội dung
                  {place.domain?.domain ? ` · ${place.domain.domain}` : ""}
                </span>
              </div>
              <span className="place-score">{scoreText(overall.score_5)}</span>
            </div>
            {Array.isArray(place.top_negative_aspects) && place.top_negative_aspects.length > 0 && (
              <div className="mini-insight-list">
                {place.top_negative_aspects.slice(0, 3).map((item) => (
                  <span key={item.aspect}>{aspectDisplayName(item)}: {percentText(item.negative_percent)} tiêu cực</span>
                ))}
              </div>
            )}
            <AspectRows aspects={aspects} limit={5} />
            {Array.isArray(place.evidence) && place.evidence.length > 0 && (
              <div className="evidence-list compact">
                {place.evidence.slice(0, 2).map((item, evidenceIndex) => (
                  <blockquote key={`${place.input_id || index}-${evidenceIndex}`}>
                    <p>{item.text}</p>
                    <footer>
                      {item.rating ? `${item.rating} sao` : "Không có rating"}
{item.negative_aspects?.length ? ` · tiêu cực: ${item.negative_aspects.map(aspectDisplayName).join(", ")}` : ""}
                    </footer>
                  </blockquote>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function InsightCards({ result }) {
  const overall = result?.overall || {};
  const ratingVsText = result?.rating_vs_text || {};
  return (
    <div className="insight-grid">
      <article>
        <span>Tổng quan cảm xúc</span>
        <strong>{percentText(overall.positive_percent)}</strong>
        <small>{overall.positive || 0} tích cực · {overall.negative || 0} tiêu cực</small>
      </article>
      <article>
        <span>Tỷ lệ tiêu cực</span>
        <strong>{percentText(overall.negative_percent)}</strong>
        <small>{overall.negative || 0} lượt đề cập tiêu cực</small>
      </article>
      <article>
        <span>Địa điểm</span>
        <strong>{result?.place_count || 0}</strong>
        <small>{result?.description_count || 0} review có nội dung</small>
      </article>
      <article>
        <span>Lệch sao / nội dung</span>
        <strong>{ratingVsText.mismatch_count || 0}</strong>
        <small>{ratingVsText.total_with_rating || 0} review có rating</small>
      </article>
    </div>
  );
}

function AlertsList({ alerts }) {
  const rows = Array.isArray(alerts) ? alerts : [];
  if (rows.length === 0) {
    return <p className="empty-analysis">Chưa có cảnh báo tiêu cực nổi bật.</p>;
  }
  return (
    <div className="alert-list">
      {rows.slice(0, 6).map((item) => (
        <article key={item.aspect}>
          <strong>{aspectDisplayName(item)}</strong>
          <span>{item.negative || 0}/{item.mentions || 0} tiêu cực · {percentText(item.negative_percent)}</span>
        </article>
      ))}
    </div>
  );
}

function DomainSummary({ summary }) {
  const rows = domainSummaryRows(summary);
  const lowConfidence = Array.isArray(summary?.low_confidence) ? summary.low_confidence : [];
  if (rows.length === 0) return null;
  return (
    <div className="domain-summary">
      <div className="domain-grid">
        {rows.map((item) => (
          <article key={item.domain}>
            <strong>{item.domain}</strong>
            <span>{item.place_count || 0} địa điểm · {item.review_count || 0} reviews</span>
            <small>Độ tin cậy {Number(item.avg_confidence || 0).toFixed(2)}</small>
          </article>
        ))}
      </div>
      {lowConfidence.length > 0 && (
        <div className="low-confidence">
          <strong>Cần kiểm tra domain routing</strong>
          {lowConfidence.slice(0, 5).map((item) => (
            <span key={`${item.input_id}-${item.domain}`}>
              {item.title || item.input_id}: {item.domain} ({Number(item.confidence || 0).toFixed(2)})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RatingMismatch({ data }) {
  const examples = Array.isArray(data?.examples) ? data.examples : [];
  if (examples.length === 0) return null;
  return (
    <div className="evidence-list">
      {examples.slice(0, 4).map((item, index) => (
        <blockquote key={`${item.input_id}-${index}`}>
          <p>{item.text}</p>
          <footer>
            {item.title || item.input_id} · {item.rating} sao
            {item.negative_aspects?.length ? ` · tiêu cực: ${item.negative_aspects.map(aspectDisplayName).join(", ")}` : ""}
          </footer>
        </blockquote>
      ))}
    </div>
  );
}

function AnalysisDashboard({ result, jobID }) {
  return (
    <section className="panel analysis-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">ABSA tổng hợp</p>
          <h2>Kết quả phân tích review</h2>
        </div>
        <span className="job-count">Job ID: {jobID}</span>
      </div>

      <div className="analysis-meta">
        <span>{result.place_count || 0} địa điểm</span>
        <span>{result.description_count || 0} review hợp lệ</span>
        <span>{result.generated_at ? `Cập nhật ${formatDate(result.generated_at)}` : "Snapshot mới nhất"}</span>
      </div>

      <InsightCards result={result} />

      <NarrativePanel jobID={jobID} onGenerate={generateJobNarrative} />

      <div className="analysis-columns">
        <section>
          <div className="section-heading">
            <h3>Vấn đề cần ưu tiên</h3>
            <span>{result.alerts?.length || 0} cảnh báo</span>
          </div>
          <AlertsList alerts={result.alerts} />
        </section>

        <section>
          <div className="section-heading">
            <h3>Phân tích ngành hàng (Domain Routing)</h3>
            <span>{domainSummaryRows(result.domain_summary).length} ngành hàng</span>
          </div>
          <DomainSummary summary={result.domain_summary} />
        </section>
      </div>

      <div className="place-analysis-section">
        <div className="section-heading">
          <h3>Khía cạnh tổng hợp (Aspects)</h3>
          <span>{visibleAspects(result.aspects).length} khía cạnh</span>
        </div>
        <AspectRows aspects={visibleAspects(result.aspects)} />
      </div>

      <div className="place-analysis-section">
        <div className="section-heading">
          <h3>Lệch giữa rating và nội dung</h3>
          <span>{result.rating_vs_text?.mismatch_count || 0} review</span>
        </div>
        <RatingMismatch data={result.rating_vs_text} />
      </div>

      <div className="place-analysis-section">
        <div className="section-heading">
          <h3>Trung bình theo địa điểm</h3>
          <span>{result.places?.length || 0} địa điểm</span>
        </div>
        <PlaceAnalysis places={result.places} />
      </div>
    </section>
  );
}

function PlacePicker({ apiKey, onPick, selectedLocation }) {
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

  useEffect(() => {
    if (!apiKey) {
      setMapState("missing-key");
      return undefined;
    }

    if (!mapElementRef.current) return undefined;

    let cancelled = false;
    let ready = false;
    let usingFallbackStyle = false;
    let lastMapError = "";
    let tileFallbackTimer = null;
    setMapState("loading");
    setPickStatus("");

    const start = selectedLocation || defaultMapCenter;
    const map = new vietmapgl.Map({
      container: mapElementRef.current,
      style: vietMapStyleUrl(apiKey),
      center: [start.lng, start.lat],
      zoom: selectedLocation ? 16 : 12,
      attributionControl: true,
      vietmapLogo: true,
      transformRequest: (url) => ({
        url: appendVietMapApiKey(url, apiKey)
      })
    });

    mapRef.current = map;
    map.addControl(new vietmapgl.NavigationControl(), "top-right");

    const readyTimer = window.setTimeout(() => {
      if (cancelled || ready) return;
      setMapState("error");
      setPickStatus(lastMapError || "Không tải được style bản đồ VietMap.");
    }, 15000);

    const clearTileFallbackTimer = () => {
      if (!tileFallbackTimer) return;
      window.clearTimeout(tileFallbackTimer);
      tileFallbackTimer = null;
    };

    const switchToFallbackStyle = () => {
      if (cancelled || usingFallbackStyle || !mapRef.current) return;

      usingFallbackStyle = true;
      ready = true;
      clearTileFallbackTimer();
      window.clearTimeout(readyTimer);
      setMapState("ready");
      setPickStatus("Đang hiển thị nền bản đồ dự phòng vì tile VietMap chưa tải được.");
      mapRef.current.setStyle(rasterFallbackStyle());
      window.requestAnimationFrame(() => mapRef.current?.resize());
    };

    const markReady = () => {
      if (cancelled || ready) return;
      ready = true;
      window.clearTimeout(readyTimer);
      setMapState("ready");
      window.requestAnimationFrame(() => map.resize());
      if (selectedLocation) {
        placeMarker(selectedLocation.lat, selectedLocation.lng);
      }

      tileFallbackTimer = window.setTimeout(() => {
        if (cancelled || usingFallbackStyle) return;
        if (typeof map.areTilesLoaded === "function" && !map.areTilesLoaded()) {
          switchToFallbackStyle();
        }
      }, 3500);
    };

    const handleError = (event) => {
      if (cancelled) return;
      lastMapError = event?.error?.message || "Một tài nguyên bản đồ chưa tải được.";
      if (isMapResourceError(lastMapError)) {
        switchToFallbackStyle();
      } else if (!usingFallbackStyle) {
        setPickStatus(`Một số tài nguyên bản đồ chưa tải được: ${lastMapError}`);
      }
    };

    const handleIdle = () => {
      if (cancelled || usingFallbackStyle) return;
      if (typeof map.areTilesLoaded === "function" && map.areTilesLoaded()) {
        clearTileFallbackTimer();
      }
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
    map.on("idle", handleIdle);
    map.on("click", handleClick);

    return () => {
      cancelled = true;
      window.clearTimeout(readyTimer);
      clearTileFallbackTimer();
      markerRef.current?.remove();
      markerRef.current = null;
      map.off("styledata", markReady);
      map.off("load", markReady);
      map.off("error", handleError);
      map.off("idle", handleIdle);
      map.off("click", handleClick);
      map.remove();
      mapRef.current = null;
    };
  }, [apiKey, placeMarker]);

  useEffect(() => {
    if (!selectedLocation) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    placeMarker(selectedLocation.lat, selectedLocation.lng);
  }, [placeMarker, selectedLocation]);

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
    <section className="panel map-panel" aria-label="Chọn địa điểm trên bản đồ">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">VietMap</p>
          <h2>Chọn địa điểm trên bản đồ</h2>
        </div>
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
      </div>
    </section>
  );
}

function SummaryMetrics({ jobs, completedJobs, analysisReadyJobs, workingJobs }) {
  const failedJobs = jobs.filter((job) => job.status === "failed").length;
  const pendingAnalysis = completedJobs.filter((job) => (job.analysis_status || "pending") !== "ok").length;

  return (
    <section className="metric-strip" aria-label="Tổng quan dữ liệu và phân tích">
      <article>
        <span>Số job đã cào</span>
        <strong>{jobs.length}</strong>
        <small>{workingJobs.length} đang xử lý</small>
      </article>
      <article>
        <span>Crawl thành công</span>
        <strong>{completedJobs.length}</strong>
        <small>{failedJobs} cào thất bại</small>
      </article>
      <article>
        <span>Đã chạy ABSA</span>
        <strong>{analysisReadyJobs.length}</strong>
        <small>{pendingAnalysis} job chờ phân tích</small>
      </article>
      <article>
        <span>Luồng thông minh</span>
        <strong>Thu thập → ABSA</strong>
        <small>Mô hình cảm xúc khía cạnh</small>
      </article>
    </section>
  );
}

function AnalysisQueue({ jobs, analyzingJobID, onViewAnalysis, onAnalyze }) {
  return (
    <section className="panel analysis-queue">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Bộ lưu trữ ABSA</p>
          <h2>Danh sách các Job đã hoàn tất dữ liệu cào</h2>
        </div>
        <span className="job-count">{jobs.length} job đã sẵn sàng</span>
      </div>

      <div className="analysis-job-grid">
        {jobs.length === 0 ? (
          <p className="empty-analysis">Chưa có dữ liệu nào sẵn sàng. Vui lòng chuyển sang tab Thu Thập Dữ Liệu để tạo job mới.</p>
        ) : (
          jobs.map((job) => {
            const busy = analyzingJobID === job.id;
            const analysisStatus = job.analysis_status || "pending";
            const analysisReady = analysisStatus === "ok";
            const analysisWorking = analysisStatus === "working";
            return (
              <article className="analysis-job-card" key={job.id}>
                <div className="analysis-job-card-header">
                  <strong>{job.name}</strong>
                  <span>Từ khóa: {job.keywords?.join(", ") || "-"}</span>
                </div>
                <div className="analysis-job-meta">
                  <span className={`status ${job.status}`}>{statusText(job.status)}</span>
                  <span className={`status analysis-status ${analysisStatus}`}>{analysisStatusText(analysisStatus)}</span>
                </div>
                <button
                  type="button"
                  className={`ghost-button ${analysisReady ? "success-action" : "pending-action"}`}
                  onClick={() => (analysisReady ? onViewAnalysis(job.id) : onAnalyze(job.id))}
                  disabled={job.status !== "ok" || busy || analysisWorking}
                >
                  {analysisButtonLabel(job, busy)}
                </button>
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
  const [batchMode, setBatchMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activeScreen, setActiveScreen] = useState("analysis");
  const [activeTab, setActiveTab] = useState("full");
  const [analysisMode, setAnalysisMode] = useState("area");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisJobID, setAnalysisJobID] = useState("");
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

  const completedJobs = useMemo(() => jobs.filter((job) => job.status === "ok"), [jobs]);
  const workingJobs = useMemo(() => jobs.filter((job) => job.status === "working" || job.status === "pending"), [jobs]);
  const analysisReadyJobs = useMemo(
    () => jobs.filter((job) => (job.analysis_status || "pending") === "ok"),
    [jobs]
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

  async function onSubmit(event, overrides = {}) {
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
        zoom: Number(form.zoom),
        lat: form.lat.trim(),
        lon: form.lon.trim(),
        fast_mode: overrides.fastMode ?? form.fastMode,
        radius: Number(overrides.radius ?? form.radius),
        depth: Number(form.depth),
        max_places: Number(overrides.maxPlaces ?? form.maxPlaces),
        email: form.email,
        extra_reviews: form.extraReviews,
        max_time_seconds: Number(form.maxTimeSeconds),
        crawl_mode: overrides.crawlMode ?? form.crawlMode
      };

      const submitBatchMode = overrides.batchMode ?? batchMode;

      if (!submitBatchMode) {
        await createJob({
          ...commonPayload,
          keywords
        });
        setMessage("Đã khởi tạo job cào dữ liệu thành công.");
      } else {
        const settled = await Promise.allSettled(
          keywords.map((keyword) =>
            createJob({
              ...commonPayload,
              name: `${commonPayload.name} - ${keyword}`,
              keywords: [keyword]
            })
          )
        );
        const successCount = settled.filter((item) => item.status === "fulfilled").length;
        const failedCount = settled.length - successCount;
        setMessage(`Đã hoàn tất gửi loạt: ${successCount} thành công, ${failedCount} thất bại.`);
      }

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
      setMessage("Đã kích hoạt mô hình ABSA phân tích file CSV thành công.");
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
        setMessage("Đã tải dữ liệu snapshot phân tích ABSA.");
      } else {
        setAnalysisResult(null);
        setAnalysisJobID(jobID);
        setActiveScreen("analysis");
        setMessage(`Trạng thái ABSA: ${analysisStatusText(data?.status?.status)}.`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzingJobID("");
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-logo-area">
          <p className="eyebrow">Trí Tuệ Nhân Tạo Phân Tích Review</p>
          <h1>ABSA Review Intelligence</h1>
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
          Phân Tích & Insights
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
        <>
          <SummaryMetrics
            jobs={jobs}
            completedJobs={completedJobs}
            analysisReadyJobs={analysisReadyJobs}
            workingJobs={workingJobs}
          />

          <AnalysisQueue
            jobs={analysisJobs}
            analyzingJobID={analyzingJobID}
            onViewAnalysis={onViewAnalysis}
            onAnalyze={onAnalyze}
          />

          {analysisResult ? (
            <AnalysisDashboard result={analysisResult} jobID={analysisJobID} />
          ) : (
            <section className="panel empty-analysis-workspace">
              <div className="empty-analysis-icon-title">
                <p className="eyebrow">Không gian phân tích</p>
                <h2>Chọn một Snapshot ABSA ở trên để mở Dashboard</h2>
              </div>
              <span className="empty-analysis-description">
                {selectedAnalysisJob
                  ? `${selectedAnalysisJob.name}: ${analysisStatusText(selectedAnalysisJob.analysis_status)}`
                  : "Bảng dữ liệu sẽ tự động tổng hợp phân tích điểm số khía cạnh (aspect score), điểm đau khách hàng (pain points), xếp hạng địa điểm (places ranking) và trích xuất các câu review bằng chứng thực tế từ tệp dữ liệu đã thu thập."}
              </span>
            </section>
          )}
        </>
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
                  <span>Độ sâu cào (Depth)</span>
                  <input
                    type="number"
                    value={form.depth}
                    onChange={(e) => updateField("depth", e.target.value)}
                    min={1}
                  />
                </label>
                <label className="field">
                  <span>Độ thu phóng (Zoom)</span>
                  <input
                    type="number"
                    value={form.zoom}
                    onChange={(e) => updateField("zoom", e.target.value)}
                    min={0}
                    max={21}
                  />
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
                    <option value="full">Tải đầy đủ (Để chạy ABSA)</option>
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
                      checked={batchMode}
                      onChange={(e) => setBatchMode(e.target.checked)}
                    />
                    <span>Chạy chế độ hàng loạt (Batch)</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={form.fastMode}
                      onChange={(e) => updateField("fastMode", e.target.checked)}
                    />
                    <span>Chế độ cào nhanh (Fast)</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={form.urlMode}
                      onChange={(e) => updateField("urlMode", e.target.checked)}
                    />
                    <span>Chỉ dùng URL nguồn</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={form.email}
                      onChange={(e) => updateField("email", e.target.checked)}
                    />
                    <span>Tìm kiếm email</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={form.extraReviews}
                      onChange={(e) => updateField("extraReviews", e.target.checked)}
                    />
                    <span>Thu thập thêm review</span>
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
                    <th>Trạng thái ABSA</th>
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
                                title={job.status !== "ok" ? "Chỉ chạy ABSA khi job cào thành công" : "Bắt đầu chạy phân tích ABSA"}
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
