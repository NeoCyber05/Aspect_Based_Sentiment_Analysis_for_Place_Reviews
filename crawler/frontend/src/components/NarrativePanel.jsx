import { useState } from "react";

export function NarrativePanel({ jobID, onGenerate }) {
  const [narrative, setNarrative] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleGenerate(force = false) {
    setLoading(true);
    setError("");
    try {
      const payload = await onGenerate(jobID, { force, ollama: true });
      setNarrative(payload);
    } catch (err) {
      setError(err.message || "Không thể tạo phân tích diễn giải");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="narrative-panel">
      <div className="section-heading">
        <div>
          <h3>Phân tích diễn giải</h3>
          <span>{narrative?.source === "ollama" ? "Sinh bởi Ollama từ kết quả ABSA" : "Không thay thế số liệu ABSA"}</span>
        </div>
        <button type="button" className="ghost-button" onClick={() => handleGenerate(Boolean(narrative))} disabled={loading}>
          {loading ? "Đang tạo..." : narrative ? "Tạo lại" : "Tạo phân tích"}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {narrative ? (
        <div className="narrative-content">
          <p>{narrative.summary}</p>
          {Array.isArray(narrative.strengths) && narrative.strengths.length > 0 && (
            <div>
              <strong>Điểm mạnh</strong>
              <ul>{narrative.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {Array.isArray(narrative.issues) && narrative.issues.length > 0 && (
            <div>
              <strong>Vấn đề cần theo dõi</strong>
              <ul>{narrative.issues.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {Array.isArray(narrative.caveats) && narrative.caveats.length > 0 && (
            <p className="narrative-caveat">{narrative.caveats.join(" ")}</p>
          )}
        </div>
      ) : (
        <p className="empty-analysis">Nhấn "Tạo phân tích" để Ollama diễn giải kết quả ABSA hiện có.</p>
      )}
    </section>
  );
}
