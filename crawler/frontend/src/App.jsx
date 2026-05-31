import vietmapgl from "@vietmap/vietmap-gl-js/dist/vietmap-gl";
import "@vietmap/vietmap-gl-js/dist/vietmap-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeJobCsv, createJob, deleteJob, downloadJobCsv, fetchJobAnalysis, fetchJobs } from "./api";

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
  pending: "Chua phan tich",
  working: "Dang phan tich",
  ok: "Da phan tich",
  failed: "Loi phan tich"
};

function formatDate(isoString) {
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("vi-VN");
}

function statusText(status) {
  return statusLabels[status] || status;
}

function analysisStatusText(status) {
  return analysisStatusLabels[status] || status || "Chua phan tich";
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

function domainSummaryRows(summary) {
  const domains = summary?.domains || {};
  return Object.entries(domains).map(([domain, metrics]) => ({ domain, ...metrics }));
}

function analysisButtonLabel(job, busy) {
  if (busy) return "Dang tai...";
  switch (job.analysis_status) {
    case "ok":
      return "Xem phan tich";
    case "failed":
      return "Chay lai";
    case "working":
      return "Dang phan tich";
    default:
      return "Chay phan tich";
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
    return <p className="empty-analysis">Chưa có aspect nào được model nhận diện.</p>;
  }

  return (
    <div className="aspect-list">
      {shownRows.map((item) => {
        const scorePercent = clampPercent(item.score_percent);
        const negative = Number(item.negative_percent || 0);
        return (
          <article className="aspect-row" key={item.aspect}>
            <div className="aspect-label">
              <strong>{prettifyAspectName(item.aspect)}</strong>
              <small>{item.mentions || 0} lượt đề cập</small>
            </div>
            <div className="aspect-meter-wrap">
              <div className="aspect-meter">
                <div className="aspect-meter-track" />
                <div
                  className={`aspect-meter-fill ${negative >= 45 ? "negative" : "positive"}`}
                  style={{ width: `${scorePercent}%` }}
                />
              </div>
              <span className="aspect-score">{scoreText(item.score_5)}</span>
            </div>
          </article>
        );
      })}
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
                  <span key={item.aspect}>{prettifyAspectName(item.aspect)}: {percentText(item.negative_percent)} negative</span>
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
                      {item.rating ? `${item.rating} sao` : "Khong co rating"}
                      {item.negative_aspects?.length ? ` · ${item.negative_aspects.map(prettifyAspectName).join(", ")}` : ""}
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
        <span>Diem tong quan</span>
        <strong>{scoreText(overall.score_5)}</strong>
        <small>{overall.mentions || 0} luot aspect duoc nhan dien</small>
      </article>
      <article>
        <span>Ty le negative</span>
        <strong>{percentText(overall.negative_percent)}</strong>
        <small>{overall.negative || 0} negative mentions</small>
      </article>
      <article>
        <span>Dia diem</span>
        <strong>{result?.place_count || 0}</strong>
        <small>{result?.description_count || 0} review co noi dung</small>
      </article>
      <article>
        <span>Lech sao/noi dung</span>
        <strong>{ratingVsText.mismatch_count || 0}</strong>
        <small>{ratingVsText.total_with_rating || 0} review co rating</small>
      </article>
    </div>
  );
}

function AlertsList({ alerts }) {
  const rows = Array.isArray(alerts) ? alerts : [];
  if (rows.length === 0) {
    return <p className="empty-analysis">Chua co canh bao negative noi bat.</p>;
  }
  return (
    <div className="alert-list">
      {rows.slice(0, 6).map((item) => (
        <article key={item.aspect}>
          <strong>{prettifyAspectName(item.aspect)}</strong>
          <span>{item.negative || 0}/{item.mentions || 0} negative · {percentText(item.negative_percent)}</span>
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
            <span>{item.place_count || 0} dia diem · {item.review_count || 0} reviews</span>
            <small>confidence {Number(item.avg_confidence || 0).toFixed(2)}</small>
          </article>
        ))}
      </div>
      {lowConfidence.length > 0 && (
        <div className="low-confidence">
          <strong>Can kiem tra domain routing</strong>
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
            {item.negative_aspects?.length ? ` · negative: ${item.negative_aspects.map(prettifyAspectName).join(", ")}` : ""}
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
          <p className="eyebrow">ABSA tong hop</p>
          <h2>Ket qua phan tich review</h2>
        </div>
        <span className="job-count">Job: {jobID}</span>
      </div>

      <div className="analysis-meta">
        <span>{result.place_count || 0} dia diem</span>
        <span>{result.description_count || 0} review hop le</span>
        <span>{result.generated_at ? `Cap nhat ${formatDate(result.generated_at)}` : "Snapshot moi nhat"}</span>
      </div>

      <InsightCards result={result} />

      <div className="analysis-columns">
        <section>
          <div className="section-heading">
            <h3>Van de can uu tien</h3>
            <span>{result.alerts?.length || 0} canh bao</span>
          </div>
          <AlertsList alerts={result.alerts} />
        </section>

        <section>
          <div className="section-heading">
            <h3>Domain routing</h3>
            <span>{domainSummaryRows(result.domain_summary).length} domain</span>
          </div>
          <DomainSummary summary={result.domain_summary} />
        </section>
      </div>

      <div className="place-analysis-section">
        <div className="section-heading">
          <h3>Aspect tong hop</h3>
          <span>{visibleAspects(result.aspects).length} aspect</span>
        </div>
        <AspectRows aspects={visibleAspects(result.aspects)} />
      </div>

      <div className="place-analysis-section">
        <div className="section-heading">
          <h3>Lech giua sao va noi dung</h3>
          <span>{result.rating_vs_text?.mismatch_count || 0} review</span>
        </div>
        <RatingMismatch data={result.rating_vs_text} />
      </div>

      <div className="place-analysis-section">
        <div className="section-heading">
          <h3>Trung binh theo dia diem</h3>
          <span>{result.places?.length || 0} dia diem</span>
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
      markerRef.current = new vietmapgl.Marker({ color: "#2563eb" }).setLngLat(lngLat).addTo(mapRef.current);
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
          <h2>Chọn địa điểm</h2>
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
          placeholder="Nhập tên quán, địa chỉ hoặc địa danh"
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
        {!apiKey && (
          <div className="map-placeholder">
            <strong>VietMap chưa được cấu hình</strong>
            <span>Thêm VITE_VIETMAP_API_KEY vào .env.local để bật bản đồ.</span>
          </div>
        )}
        {apiKey && mapState === "loading" && (
          <div className="map-placeholder">
            <strong>Đang tải bản đồ</strong>
            <span>Form thủ công vẫn có thể sử dụng trong lúc chờ.</span>
          </div>
        )}
        {apiKey && mapState === "error" && (
          <div className="map-placeholder error-state">
            <strong>Không tải được VietMap</strong>
            <span>{pickStatus || "Kiểm tra API key VietMap và quyền dùng TileMap/Web SDK."}</span>
          </div>
        )}
      </div>

      <div className="map-footer">
        <span>
          {pickStatus || "Tìm địa điểm bằng ô phía trên hoặc click bản đồ để lấy tọa độ và địa chỉ gần nhất."}
        </span>
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
  const [activeTab, setActiveTab] = useState("full");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisJobID, setAnalysisJobID] = useState("");
  const [analyzingJobID, setAnalyzingJobID] = useState("");

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
        ? `Đã điền thông tin từ địa điểm: ${selection.name}`
        : "Đã cập nhật kinh độ và vĩ độ từ bản đồ."
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
        zoom: Number(form.zoom),
        lat: form.lat.trim(),
        lon: form.lon.trim(),
        fast_mode: form.fastMode,
        radius: Number(form.radius),
        depth: Number(form.depth),
        max_places: Number(form.maxPlaces),
        email: form.email,
        extra_reviews: form.extraReviews,
        max_time_seconds: Number(form.maxTimeSeconds),
        crawl_mode: form.crawlMode
      };

      if (!batchMode) {
        await createJob({
          ...commonPayload,
          keywords
        });
        setMessage("Đã tạo job thành công.");
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
        setMessage(`Batch hoàn tất: ${successCount} thành công, ${failedCount} lỗi.`);
      }

      setForm((prev) => ({ ...initialForm, lang: prev.lang }));
      await loadJobs();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(jobID) {
    setError("");
    setMessage("");
    try {
      await deleteJob(jobID);
      setMessage("Đã xóa job.");
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
      setMessage("Da chay lai phan tich ABSA tu file CSV cua job.");
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
        setMessage("Da tai snapshot phan tich ABSA.");
      } else {
        setAnalysisResult(null);
        setAnalysisJobID(jobID);
        setMessage(`Trang thai ABSA: ${analysisStatusText(data?.status?.status)}.`);
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
        <div>
          <p className="eyebrow">Crawler bản đồ</p>
          <h1>Quản lý job thu thập đánh giá địa điểm</h1>
        </div>
        <button type="button" className="ghost-button" onClick={loadJobs} disabled={loadingJobs}>
          {loadingJobs ? "Đang tải" : "Làm mới"}
        </button>
      </header>

      {(message || error) && (
        <section className="notice-area" aria-live="polite">
          {message && <p className="message success">{message}</p>}
          {error && <p className="message error">{error}</p>}
        </section>
      )}

      <main className="workspace-grid">
        <section className="panel form-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Tạo job mới</p>
              <h2>Thông tin crawl</h2>
            </div>
            <span className="keyword-count">{keywords.length} từ khóa</span>
          </div>

          <form onSubmit={onSubmit} className="form-grid">
            <label className="field full">
              <span>Tên job</span>
              <input
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="Ví dụ: Cửa hàng cà phê Hà Nội"
              />
            </label>

            <label className="field full">
              <span>Từ khóa (mỗi dòng 1 từ khóa)</span>
              <textarea
                rows={5}
                value={form.keywordsText}
                onChange={(e) => updateField("keywordsText", e.target.value)}
                placeholder={"cà phê hà nội\ntrà sữa quận 1"}
              />
            </label>

            <label className="field">
              <span>Ngôn ngữ</span>
              <input value={form.lang} onChange={(e) => updateField("lang", e.target.value)} />
            </label>
            <label className="field">
              <span>Depth</span>
              <input
                type="number"
                value={form.depth}
                onChange={(e) => updateField("depth", e.target.value)}
                min={1}
              />
            </label>
            <label className="field">
              <span>Zoom</span>
              <input
                type="number"
                value={form.zoom}
                onChange={(e) => updateField("zoom", e.target.value)}
                min={0}
                max={21}
              />
            </label>
            <label className="field">
              <span>Radius (m)</span>
              <input
                type="number"
                value={form.radius}
                onChange={(e) => updateField("radius", e.target.value)}
                min={1}
              />
            </label>
            <label className="field">
              <span>Giới hạn địa điểm cào</span>
              <input
                type="number"
                value={form.maxPlaces}
                onChange={(e) => updateField("maxPlaces", e.target.value)}
                min={0}
                placeholder="0 = không giới hạn"
              />
            </label>
            <label className="field">
              <span>Max time (giây)</span>
              <input
                type="number"
                value={form.maxTimeSeconds}
                onChange={(e) => updateField("maxTimeSeconds", e.target.value)}
                min={180}
              />
            </label>
            <label className="field">
              <span>Crawl Mode</span>
              <select value={form.crawlMode} onChange={(e) => updateField("crawlMode", e.target.value)}>
                <option value="full">Full (Tất cả)</option>
                <option value="train">Train (Chỉ Title & Category)</option>
              </select>
            </label>
            <label className="field">
              <span>Latitude</span>
              <input value={form.lat} onChange={(e) => updateField("lat", e.target.value)} />
            </label>
            <label className="field">
              <span>Longitude</span>
              <input value={form.lon} onChange={(e) => updateField("lon", e.target.value)} />
            </label>

            <div className="toggles full">
              <label>
                <input
                  type="checkbox"
                  checked={batchMode}
                  onChange={(e) => setBatchMode(e.target.checked)}
                />
                <span>Tạo nhiều job (batch)</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.fastMode}
                  onChange={(e) => updateField("fastMode", e.target.checked)}
                />
                <span>Fast mode</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.urlMode}
                  onChange={(e) => updateField("urlMode", e.target.checked)}
                />
                <span>URL mode</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.email}
                  onChange={(e) => updateField("email", e.target.checked)}
                />
                <span>Thu thập email</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.extraReviews}
                  onChange={(e) => updateField("extraReviews", e.target.checked)}
                />
                <span>Thu thập extra reviews</span>
              </label>
            </div>

            <div className="form-actions full">
              <button type="submit" className="primary-button" disabled={submitting}>
                {submitting ? "Đang tạo..." : "Tạo job"}
              </button>
            </div>
          </form>
        </section>

        <PlacePicker apiKey={vietMapApiKey} onPick={handleMapPick} selectedLocation={selectedLocation} />
      </main>

      <section className="panel jobs-panel">
        <div className="panel-heading jobs-heading">
          <div className="jobs-heading-row">
            <div>
              <p className="eyebrow">Theo dõi</p>
              <h2>Danh sách job</h2>
            </div>
            <span className="job-count">{filteredJobs.length} job</span>
          </div>

          <div className="tabs" role="tablist" aria-label="Chế độ crawl">
            <button
              type="button"
              className={`tab-button ${activeTab === "full" ? "active" : ""}`}
              onClick={() => setActiveTab("full")}
            >
              Danh sách tải full
            </button>
            <button
              type="button"
              className={`tab-button ${activeTab === "train" ? "active" : ""}`}
              onClick={() => setActiveTab("train")}
            >
              Danh sách tải train
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên job</th>
                <th>Trạng thái</th>
                <th>ABSA</th>
                <th>Thời gian tạo</th>
                <th>Từ khóa</th>
                <th>Giới hạn</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    Chưa có job nào trong danh sách này.
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
                          <button type="button" onClick={() => downloadJobCsv(job.id)}>
                            Tải CSV
                          </button>
                          <button
                            type="button"
                            className="analysis"
                            onClick={() => (analysisReady ? onViewAnalysis(job.id) : onAnalyze(job.id))}
                            disabled={job.status !== "ok" || busy || analysisWorking}
                            title={job.status !== "ok" ? "Chỉ phân tích khi job đã hoàn tất" : ""}
                          >
                            {analysisButtonLabel(job, busy)}
                          </button>
                          {analysisReady && (
                            <button
                              type="button"
                              onClick={() => onAnalyze(job.id)}
                              disabled={!canAnalyze}
                              title="Chay lai snapshot ABSA"
                            >
                              Chạy lại
                            </button>
                          )}
                          <button type="button" className="danger" onClick={() => onDelete(job.id)}>
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

      {analysisResult && <AnalysisDashboard result={analysisResult} jobID={analysisJobID} />}
    </div>
  );
}
