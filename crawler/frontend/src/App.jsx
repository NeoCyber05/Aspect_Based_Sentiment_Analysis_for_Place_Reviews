import vietmapgl from "@vietmap/vietmap-gl-js/dist/vietmap-gl";
import "@vietmap/vietmap-gl-js/dist/vietmap-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createJob, deleteJob, downloadJobCsv, fetchJobs } from "./api";

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
  maxTimeSeconds: 600,
  fastMode: false,
  urlMode: false,
  email: false,
  extraReviews: true,
  lat: "",
  lon: ""
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

function formatDate(isoString) {
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("vi-VN");
}

function statusText(status) {
  return statusLabels[status] || status;
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
        email: form.email,
        extra_reviews: form.extraReviews,
        max_time_seconds: Number(form.maxTimeSeconds)
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
              <span>Max time (giây)</span>
              <input
                type="number"
                value={form.maxTimeSeconds}
                onChange={(e) => updateField("maxTimeSeconds", e.target.value)}
                min={180}
              />
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
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Theo dõi</p>
            <h2>Danh sách job</h2>
          </div>
          <span className="job-count">{jobs.length} job</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên job</th>
                <th>Trạng thái</th>
                <th>Thời gian tạo</th>
                <th>Từ khóa</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-cell">
                    Chưa có job nào.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="job-name">{job.name}</td>
                    <td>
                      <span className={`status ${job.status}`}>{statusText(job.status)}</span>
                    </td>
                    <td>{formatDate(job.created_at)}</td>
                    <td className="keywords-cell">{job.keywords?.join(", ") || "-"}</td>
                    <td>
                      <div className="actions">
                        <button type="button" onClick={() => downloadJobCsv(job.id)}>
                          Tải CSV
                        </button>
                        <button type="button" className="danger" onClick={() => onDelete(job.id)}>
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
