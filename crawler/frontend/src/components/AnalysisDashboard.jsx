import { useState } from "react";
import { SentimentBar } from "./SentimentBar";
import { NarrativePanel } from "./NarrativePanel";
import { aspectDisplayName } from "../utils/aspectDisplay";
import { generateJobNarrative } from "../api";

function formatDate(isoString) {
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("vi-VN");
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

// ── Sentiment Donut Ring ─────────────────────────────────────────
function SentimentRing({ positive = 0, neutral = 0, negative = 0, size = 64 }) {
  const total = positive + neutral + negative;
  if (total === 0) return <div className="dash-sentiment-ring dash-sentiment-ring--empty" style={{ width: size, height: size }} />;

  const posP = (positive / total) * 100;
  const negP = (negative / total) * 100;
  const neuP = 100 - posP - negP;
  const r = 22;
  const circ = 2 * Math.PI * r;

  const seg = (pct) => (pct / 100) * circ;

  const posLen = seg(posP);
  const neuLen = seg(neuP);
  const negLen = seg(negP);

  const posOffset = 0;
  const neuOffset = posLen;
  const negOffset = posLen + neuLen;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 54 54"
      className="dash-sentiment-ring"
      aria-label={`Tích cực ${posP.toFixed(0)}%, tiêu cực ${negP.toFixed(0)}%`}
    >
      {/* Track */}
      <circle cx="27" cy="27" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
      {/* Positive */}
      <circle
        cx="27" cy="27" r={r} fill="none"
        stroke="#22c55e" strokeWidth="7"
        strokeDasharray={`${posLen} ${circ - posLen}`}
        strokeDashoffset={circ / 4 - posOffset}
        transform="rotate(-90 27 27)"
      />
      {/* Neutral */}
      {neuLen > 0.5 && (
        <circle
          cx="27" cy="27" r={r} fill="none"
          stroke="#64748b" strokeWidth="7"
          strokeDasharray={`${neuLen} ${circ - neuLen}`}
          strokeDashoffset={circ / 4 - neuOffset}
          transform="rotate(-90 27 27)"
        />
      )}
      {/* Negative */}
      {negLen > 0.5 && (
        <circle
          cx="27" cy="27" r={r} fill="none"
          stroke="#ef4444" strokeWidth="7"
          strokeDasharray={`${negLen} ${circ - negLen}`}
          strokeDashoffset={circ / 4 - negOffset}
          transform="rotate(-90 27 27)"
        />
      )}
      <text
        x="27" y="27"
        dominantBaseline="middle" textAnchor="middle"
        fontSize="9" fontWeight="700" fill="currentColor"
        style={{ fill: "var(--dash-text-primary)" }}
      >
        {posP.toFixed(0)}%
      </text>
    </svg>
  );
}

// ── Top-level Insight Cards ──────────────────────────────────────
const INSIGHT_CONFIG = [
  {
    key: "positive",
    label: "Tích cực",
    icon: "✦",
    accent: "var(--dash-green)",
    bg: "rgba(34,197,94,0.08)",
    border: "rgba(34,197,94,0.2)",
    getValue: (r) => percentText(r?.overall?.positive_percent),
    getSub: (r) => `${r?.overall?.positive || 0} lượt tích cực`,
  },
  {
    key: "negative",
    label: "Tiêu cực",
    icon: "⚠",
    accent: "var(--dash-red)",
    bg: "rgba(239,68,68,0.08)",
    border: "rgba(239,68,68,0.2)",
    getValue: (r) => percentText(r?.overall?.negative_percent),
    getSub: (r) => `${r?.overall?.negative || 0} lượt tiêu cực`,
  },
  {
    key: "places",
    label: "Địa điểm",
    icon: "⬡",
    accent: "var(--dash-blue)",
    bg: "rgba(14,165,233,0.08)",
    border: "rgba(14,165,233,0.2)",
    getValue: (r) => r?.place_count || 0,
    getSub: (r) => `${r?.description_count || 0} review hợp lệ`,
  },
  {
    key: "mismatch",
    label: "Lệch sao/nội dung",
    icon: "◈",
    accent: "var(--dash-amber)",
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.2)",
    getValue: (r) => r?.rating_vs_text?.mismatch_count || 0,
    getSub: (r) => `${r?.rating_vs_text?.total_with_rating || 0} review có rating`,
  },
];

function InsightCards({ result }) {
  return (
    <div className="dash-kpi-grid">
      {INSIGHT_CONFIG.map((cfg) => (
        <article
          key={cfg.key}
          className="dash-kpi-card"
          style={{ "--kpi-accent": cfg.accent, "--kpi-bg": cfg.bg, "--kpi-border": cfg.border }}
        >
          <div className="dash-kpi-icon">{cfg.icon}</div>
          <div className="dash-kpi-body">
            <span className="dash-kpi-label">{cfg.label}</span>
            <strong className="dash-kpi-value">{cfg.getValue(result)}</strong>
            <small className="dash-kpi-sub">{cfg.getSub(result)}</small>
          </div>
        </article>
      ))}
    </div>
  );
}

// ── Aspect Cards Grid ────────────────────────────────────────────
function AspectCard({ item }) {
  const total = (item.positive || 0) + (item.neutral || 0) + (item.negative || 0);
  const posP = total > 0 ? ((item.positive || 0) / total) * 100 : 0;
  const negP = total > 0 ? ((item.negative || 0) / total) * 100 : 0;

  let sentiment = "neutral";
  if (posP >= 60) sentiment = "positive";
  else if (negP >= 40) sentiment = "negative";

  return (
    <article className={`dash-aspect-card dash-aspect-card--${sentiment}`}>
      <div className="dash-aspect-card-top">
        <div>
          <strong className="dash-aspect-name">{aspectDisplayName(item)}</strong>
          <span className="dash-aspect-mentions">{item.mentions || 0} lượt đề cập</span>
        </div>
        <SentimentRing
          positive={item.positive || 0}
          neutral={item.neutral || 0}
          negative={item.negative || 0}
          size={52}
        />
      </div>
      <SentimentBar
        positive={item.positive || 0}
        neutral={item.neutral || 0}
        negative={item.negative || 0}
      />
    </article>
  );
}

function AspectGrid({ aspects }) {
  const rows = visibleAspects(aspects);
  if (rows.length === 0) {
    return <p className="dash-empty">Chưa có khía cạnh nào được nhận diện.</p>;
  }
  return (
    <div className="dash-aspect-grid">
      {rows.map((item) => (
        <AspectCard key={item.aspect} item={item} />
      ))}
    </div>
  );
}

// ── Alerts Panel ─────────────────────────────────────────────────
function AlertsPanel({ alerts }) {
  const rows = Array.isArray(alerts) ? alerts : [];
  if (rows.length === 0) {
    return <p className="dash-empty">Chưa có cảnh báo tiêu cực nổi bật.</p>;
  }

  return (
    <div className="dash-alerts-list">
      {rows.slice(0, 8).map((item, i) => {
        const negPct = Number(item.negative_percent || 0);
        const severity = negPct >= 70 ? "high" : negPct >= 45 ? "medium" : "low";
        return (
          <article key={item.aspect} className={`dash-alert-item dash-alert-item--${severity}`}>
            <div className="dash-alert-rank">#{i + 1}</div>
            <div className="dash-alert-body">
              <strong>{aspectDisplayName(item)}</strong>
              <span>{item.negative || 0} / {item.mentions || 0} tiêu cực</span>
            </div>
            <div className="dash-alert-pct">
              <span className="dash-alert-pct-val">{percentText(item.negative_percent)}</span>
              <div className="dash-alert-bar">
                <div className="dash-alert-bar-fill" style={{ width: `${Math.min(100, negPct)}%` }} />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ── Domain Summary ───────────────────────────────────────────────
function DomainSummary({ summary }) {
  const rows = domainSummaryRows(summary);
  const lowConfidence = Array.isArray(summary?.low_confidence) ? summary.low_confidence : [];
  if (rows.length === 0) return <p className="dash-empty">Chưa có thông tin ngành hàng.</p>;

  return (
    <div className="dash-domain-section">
      <div className="dash-domain-grid">
        {rows.map((item) => (
          <article key={item.domain} className="dash-domain-card">
            <div className="dash-domain-name">{item.domain}</div>
            <div className="dash-domain-stats">
              <span><strong>{item.place_count || 0}</strong> địa điểm</span>
              <span><strong>{item.review_count || 0}</strong> reviews</span>
            </div>
            <div className="dash-domain-confidence">
              <div className="dash-domain-conf-bar">
                <div
                  className="dash-domain-conf-fill"
                  style={{ width: `${Math.min(100, Number(item.avg_confidence || 0) * 100)}%` }}
                />
              </div>
              <span>Confidence {Number(item.avg_confidence || 0).toFixed(2)}</span>
            </div>
          </article>
        ))}
      </div>
      {lowConfidence.length > 0 && (
        <details className="dash-low-confidence">
          <summary>⚠ {lowConfidence.length} địa điểm cần kiểm tra domain routing</summary>
          <div className="dash-low-conf-list">
            {lowConfidence.slice(0, 8).map((item) => (
              <span key={`${item.input_id}-${item.domain}`}>
                {item.title || item.input_id}: <em>{item.domain}</em> ({Number(item.confidence || 0).toFixed(2)})
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Rating vs Text Mismatch ──────────────────────────────────────
function RatingMismatch({ data }) {
  const examples = Array.isArray(data?.examples) ? data.examples : [];
  if (examples.length === 0) {
    return <p className="dash-empty">Không có review lệch sao đáng kể.</p>;
  }

  return (
    <div className="dash-mismatch-list">
      {examples.slice(0, 5).map((item, index) => (
        <blockquote key={`${item.input_id}-${index}`} className="dash-mismatch-quote">
          <p>{item.text}</p>
          <footer>
            <span className="dash-mismatch-place">{item.title || item.input_id}</span>
            <span className="dash-mismatch-rating">⭐ {item.rating} sao</span>
            {item.negative_aspects?.length > 0 && (
              <span className="dash-mismatch-aspects">
                Tiêu cực: {item.negative_aspects.map(aspectDisplayName).join(", ")}
              </span>
            )}
          </footer>
        </blockquote>
      ))}
    </div>
  );
}

// ── Place Analysis Cards ─────────────────────────────────────────
function PlaceCard({ place, index }) {
  const [expanded, setExpanded] = useState(false);
  const aspects = visibleAspects(place.aspects);
  const overall = place.overall || {};
  const score = Number(overall.score_5 || 0);
  const scoreColor = score >= 4 ? "#22c55e" : score >= 3 ? "#f59e0b" : "#ef4444";

  return (
    <article className="dash-place-card">
      <button
        type="button"
        className="dash-place-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="dash-place-header-left">
          <span className="dash-place-rank">#{index + 1}</span>
          <div>
            <strong className="dash-place-name">{place.title || `Địa điểm ${index + 1}`}</strong>
            <span className="dash-place-meta">
              {place.description_count || 0} review có nội dung
              {place.domain?.domain ? ` · ${place.domain.domain}` : ""}
            </span>
          </div>
        </div>
        <div className="dash-place-header-right">
          <span className="dash-place-score" style={{ color: scoreColor }}>
            {scoreText(overall.score_5)}
          </span>
          <span className="dash-place-expand-icon">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="dash-place-body">
          {Array.isArray(place.top_negative_aspects) && place.top_negative_aspects.length > 0 && (
            <div className="dash-place-negatives">
              <span className="dash-place-section-label">Điểm tiêu cực nổi bật</span>
              <div className="dash-place-neg-chips">
                {place.top_negative_aspects.slice(0, 4).map((item) => (
                  <span key={item.aspect} className="dash-neg-chip">
                    {aspectDisplayName(item)}: {percentText(item.negative_percent)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {aspects.length > 0 && (
            <div className="dash-place-aspects">
              <span className="dash-place-section-label">Khía cạnh ({aspects.length})</span>
              <div className="dash-place-aspect-list">
                {aspects.slice(0, 6).map((item) => (
                  <div key={item.aspect} className="dash-place-aspect-row">
                    <span className="dash-place-aspect-name">{aspectDisplayName(item)}</span>
                    <SentimentBar
                      positive={item.positive || 0}
                      neutral={item.neutral || 0}
                      negative={item.negative || 0}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          {Array.isArray(place.evidence) && place.evidence.length > 0 && (
            <div className="dash-place-evidence">
              <span className="dash-place-section-label">Review dẫn chứng</span>
              {place.evidence.slice(0, 2).map((item, evidenceIndex) => (
                <blockquote key={`${place.input_id || index}-${evidenceIndex}`} className="dash-evidence-quote">
                  <p>{item.text}</p>
                  <footer>
                    {item.rating ? `⭐ ${item.rating} sao` : "Không có rating"}
                    {item.negative_aspects?.length ? ` · tiêu cực: ${item.negative_aspects.map(aspectDisplayName).join(", ")}` : ""}
                  </footer>
                </blockquote>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function PlaceAnalysisList({ places }) {
  const rows = Array.isArray(places) ? places : [];
  if (rows.length === 0) return <p className="dash-empty">Không có dữ liệu địa điểm.</p>;
  return (
    <div className="dash-place-list">
      {rows.map((place, index) => (
        <PlaceCard key={place.input_id || `${place.title}-${index}`} place={place} index={index} />
      ))}
    </div>
  );
}

// ── Tab Definitions ──────────────────────────────────────────────
const TABS = [
  { id: "overview", label: "Tổng quan", icon: "◉" },
  { id: "aspects", label: "Khía cạnh", icon: "◈" },
  { id: "alerts", label: "Cảnh báo", icon: "⚠" },
  { id: "places", label: "Địa điểm", icon: "⬡" },
  { id: "domain", label: "Ngành hàng", icon: "▣" },
  { id: "mismatch", label: "Lệch sao", icon: "◆" },
];

// ── Main Dashboard ───────────────────────────────────────────────
export function AnalysisDashboard({ result, jobID }) {
  const [activeTab, setActiveTab] = useState("overview");

  const placesCount = result?.places?.length || 0;
  const aspectsCount = visibleAspects(result?.aspects).length;
  const alertsCount = result?.alerts?.length || 0;
  const domainsCount = domainSummaryRows(result?.domain_summary).length;
  const mismatchCount = result?.rating_vs_text?.mismatch_count || 0;

  const tabCounts = {
    aspects: aspectsCount,
    alerts: alertsCount,
    places: placesCount,
    domain: domainsCount,
    mismatch: mismatchCount,
  };

  return (
    <section className="dash-root">
      {/* Dashboard Header */}
      <div className="dash-header">
        <div className="dash-header-left">
          <div className="dash-header-badge">AI</div>
          <div>
            <h2 className="dash-title">Kết quả phân tích review</h2>
            <div className="dash-meta-pills">
              <span>{result.place_count || 0} địa điểm</span>
              <span>{result.description_count || 0} review hợp lệ</span>
              <span>{result.generated_at ? `Cập nhật ${formatDate(result.generated_at)}` : "Snapshot mới nhất"}</span>
              <span className="dash-meta-jobid">Job #{jobID}</span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Metric Strip */}
      <InsightCards result={result} />

      {/* Tab + Content Layout */}
      <div className="dash-layout">
        {/* Left tab navigation */}
        <nav className="dash-tab-nav" aria-label="Phần phân tích">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`dash-tab-btn ${activeTab === tab.id ? "dash-tab-btn--active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="dash-tab-icon">{tab.icon}</span>
              <span className="dash-tab-label">{tab.label}</span>
              {tabCounts[tab.id] > 0 && (
                <span className="dash-tab-count">{tabCounts[tab.id]}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Right content panel */}
        <div className="dash-content">
          {activeTab === "overview" && (
            <div className="dash-section">
              <div className="dash-section-header">
                <h3>Tổng quan cảm xúc</h3>
                <span>Phân tích diễn giải từ Ollama</span>
              </div>
              <NarrativePanel jobID={jobID} onGenerate={generateJobNarrative} />

              <div className="dash-section-header" style={{ marginTop: "28px" }}>
                <h3>Top khía cạnh nổi bật</h3>
                <button
                  type="button"
                  className="dash-view-all-btn"
                  onClick={() => setActiveTab("aspects")}
                >
                  Xem tất cả {aspectsCount} →
                </button>
              </div>
              <AspectGrid aspects={visibleAspects(result?.aspects).slice(0, 6)} />
            </div>
          )}

          {activeTab === "aspects" && (
            <div className="dash-section">
              <div className="dash-section-header">
                <h3>Tất cả khía cạnh (Aspects)</h3>
                <span>{aspectsCount} khía cạnh được nhận diện</span>
              </div>
              <AspectGrid aspects={result?.aspects} />
            </div>
          )}

          {activeTab === "alerts" && (
            <div className="dash-section">
              <div className="dash-section-header">
                <h3>Vấn đề cần ưu tiên</h3>
                <span>{alertsCount} cảnh báo tiêu cực</span>
              </div>
              <AlertsPanel alerts={result?.alerts} />
            </div>
          )}

          {activeTab === "places" && (
            <div className="dash-section">
              <div className="dash-section-header">
                <h3>Phân tích theo địa điểm</h3>
                <span>{placesCount} địa điểm · Click để xem chi tiết</span>
              </div>
              <PlaceAnalysisList places={result?.places} />
            </div>
          )}

          {activeTab === "domain" && (
            <div className="dash-section">
              <div className="dash-section-header">
                <h3>Ngành hàng (Domain Routing)</h3>
                <span>{domainsCount} ngành hàng được phát hiện</span>
              </div>
              <DomainSummary summary={result?.domain_summary} />
            </div>
          )}

          {activeTab === "mismatch" && (
            <div className="dash-section">
              <div className="dash-section-header">
                <h3>Lệch giữa rating và nội dung</h3>
                <span>{mismatchCount} review có dấu hiệu lệch</span>
              </div>
              <RatingMismatch data={result?.rating_vs_text} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
