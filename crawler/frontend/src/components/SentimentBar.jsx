function segmentPercent(value, total) {
  return total > 0 ? Math.max(0, Math.min(100, (Number(value || 0) / total) * 100)) : 0;
}

export function SentimentBar({ positive = 0, neutral = 0, negative = 0 }) {
  const total = Number(positive || 0) + Number(neutral || 0) + Number(negative || 0);
  const positivePercent = segmentPercent(positive, total);
  const neutralPercent = segmentPercent(neutral, total);
  const negativePercent = segmentPercent(negative, total);

  return (
    <div className="sentiment-summary">
      <div className="sentiment-bar" aria-label={`Tích cực ${positive}, trung lập ${neutral}, tiêu cực ${negative}`}>
        {positive > 0 && <span className="sentiment-segment positive" style={{ width: `${positivePercent}%` }} />}
        {neutral > 0 && <span className="sentiment-segment neutral" style={{ width: `${neutralPercent}%` }} />}
        {negative > 0 && <span className="sentiment-segment negative" style={{ width: `${negativePercent}%` }} />}
      </div>
      <div className="sentiment-counts">
        <span className="positive">{positive} tích cực</span>
        {neutral > 0 && <span className="neutral">{neutral} trung lập</span>}
        <span className="negative">{negative} tiêu cực</span>
      </div>
    </div>
  );
}
