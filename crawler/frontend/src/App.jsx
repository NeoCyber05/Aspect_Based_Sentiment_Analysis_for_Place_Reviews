import { useEffect, useMemo, useState } from "react";
import { createJob, deleteJob, downloadJobCsv, fetchJobs } from "./api";

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
  extraReviews: false,
  lat: "",
  lon: ""
};

function formatDate(isoString) {
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("vi-VN");
}

function statusText(status) {
  switch (status) {
    case "pending":
      return "Chờ xử lý";
    case "working":
      return "Đang chạy";
    case "ok":
      return "Hoàn tất";
    case "failed":
      return "Thất bại";
    default:
      return status;
  }
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
    <div className="page">
      <header className="hero">
        <h1>Crawler Google Maps</h1>
        <p>Giao diện tiếng Việt, chạy local không Docker.</p>
      </header>

      <section className="card">
        <h2>Tạo job mới</h2>
        <form onSubmit={onSubmit} className="form-grid">
          <label>
            Tên job
            <input
              value={form.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="Ví dụ: Cửa hàng cà phê Hà Nội"
            />
          </label>

          <label className="full">
            Từ khóa (mỗi dòng 1 từ khóa)
            <textarea
              rows={5}
              value={form.keywordsText}
              onChange={(e) => updateField("keywordsText", e.target.value)}
              placeholder={"cà phê hà nội\ntrà sữa quận 1"}
            />
          </label>

          <label>
            Ngôn ngữ
            <input value={form.lang} onChange={(e) => updateField("lang", e.target.value)} />
          </label>
          <label>
            Depth
            <input
              type="number"
              value={form.depth}
              onChange={(e) => updateField("depth", e.target.value)}
              min={1}
            />
          </label>
          <label>
            Zoom
            <input
              type="number"
              value={form.zoom}
              onChange={(e) => updateField("zoom", e.target.value)}
              min={0}
              max={21}
            />
          </label>
          <label>
            Radius (m)
            <input
              type="number"
              value={form.radius}
              onChange={(e) => updateField("radius", e.target.value)}
              min={1}
            />
          </label>
          <label>
            Max time (giây)
            <input
              type="number"
              value={form.maxTimeSeconds}
              onChange={(e) => updateField("maxTimeSeconds", e.target.value)}
              min={180}
            />
          </label>
          <label>
            Latitude
            <input value={form.lat} onChange={(e) => updateField("lat", e.target.value)} />
          </label>
          <label>
            Longitude
            <input value={form.lon} onChange={(e) => updateField("lon", e.target.value)} />
          </label>

          <div className="toggles full">
            <label>
              <input
                type="checkbox"
                checked={batchMode}
                onChange={(e) => setBatchMode(e.target.checked)}
              />
              Tạo nhiều job (batch)
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.fastMode}
                onChange={(e) => updateField("fastMode", e.target.checked)}
              />
              Fast mode
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.urlMode}
                onChange={(e) => updateField("urlMode", e.target.checked)}
              />
              URL mode
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.email}
                onChange={(e) => updateField("email", e.target.checked)}
              />
              Thu thập email
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.extraReviews}
                onChange={(e) => updateField("extraReviews", e.target.checked)}
              />
              Thu thập extra reviews
            </label>
          </div>

          <button type="submit" disabled={submitting}>
            {submitting ? "Đang tạo..." : "Tạo job"}
          </button>
        </form>
      </section>

      {(message || error) && (
        <section className="card">
          {message && <p className="message success">{message}</p>}
          {error && <p className="message error">{error}</p>}
        </section>
      )}

      <section className="card">
        <div className="section-header">
          <h2>Danh sách job</h2>
          <button type="button" onClick={loadJobs} disabled={loadingJobs}>
            {loadingJobs ? "Đang tải..." : "Làm mới"}
          </button>
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
                  <td colSpan={5}>Chưa có job nào.</td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{job.name}</td>
                    <td>
                      <span className={`status ${job.status}`}>{statusText(job.status)}</span>
                    </td>
                    <td>{formatDate(job.created_at)}</td>
                    <td>{job.keywords?.join(", ") || "-"}</td>
                    <td className="actions">
                      <button type="button" onClick={() => downloadJobCsv(job.id)}>
                        Tải CSV
                      </button>
                      <button type="button" className="danger" onClick={() => onDelete(job.id)}>
                        Xóa
                      </button>
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
