// ============================================================
// Sparkline nhỏ dùng chung cho các bảng "Sức khoẻ đo lường" — vẽ xu hướng
// theo ngày (perDay) bằng SVG thuần, không kéo thêm thư viện chart.
// ============================================================
"use client";

const WIDTH = 64;
const HEIGHT = 20;

export function Sparkline({
  values,
  className,
  stroke = "#94a3b8", // slate-400 mặc định — trung tính, không gán ý nghĩa tốt/xấu
}: {
  values: number[];
  className?: string;
  stroke?: string;
}) {
  if (!values.length) {
    return (
      <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" className={className}>
        <line x1={0} y1={HEIGHT - 1} x2={WIDTH} y2={HEIGHT - 1} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="2,2" />
      </svg>
    );
  }
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? WIDTH / (values.length - 1) : WIDTH;
  const points = values
    .map((v, i) => {
      const x = Math.round(i * step * 10) / 10;
      const y = Math.round((HEIGHT - 2 - ((v - min) / range) * (HEIGHT - 4)) * 10) / 10;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" className={className}>
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
