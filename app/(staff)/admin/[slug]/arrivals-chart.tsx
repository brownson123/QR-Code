'use client';

import { useState } from 'react';
import styles from './admin.module.css';

export interface ArrivalBucket {
  bucketUtc: string;
  label: string; // already in the event timezone (§13, I-8)
  arrivals: number;
}

const W = 720;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 36 };

// Whole-number ticks (these are head counts): a 1/2/5 × 10^k step giving at most ~4 intervals.
function niceScale(peak: number): { max: number; ticks: number[] } {
  const rough = Math.max(1, peak / 4);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const max = Math.max(step, Math.ceil(peak / step) * step);
  return { max, ticks: Array.from({ length: max / step + 1 }, (_, i) => i * step) };
}

// Rounded 4px top, square at the baseline (dataviz mark spec).
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Door arrivals per 15-minute bucket. One series, so no legend: the heading names it.
export function ArrivalsChart({ buckets }: { buckets: ArrivalBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (buckets.length === 0) return <p className={styles.muted}>No door check-ins yet.</p>;

  const { max, ticks } = niceScale(Math.max(...buckets.map((b) => b.arrivals)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / buckets.length;
  const barW = Math.min(24, Math.max(2, slot - 2)); // ≤ 24px, ≥ 2px surface gap
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));
  const hovered = hover === null ? undefined : buckets[hover];

  return (
    <div className={styles.chart}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Door arrivals per 15 minutes, ${buckets.length} buckets, peak ${Math.max(...buckets.map((b) => b.arrivals))}`}>
        {ticks.map((t) => {
          const y = PAD.top + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line className={styles.chartGrid} x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} />
              <text className={styles.chartAxis} x={PAD.left - 6} y={y + 4} textAnchor="end">
                {t.toLocaleString('en-US')}
              </text>
            </g>
          );
        })}
        {buckets.map((b, i) => {
          const h = (b.arrivals / max) * plotH;
          const cx = PAD.left + slot * i + slot / 2;
          return (
            <g key={b.bucketUtc}>
              <rect
                className={styles.chartHit}
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={plotH}
                tabIndex={0}
                aria-label={`${b.label}: ${b.arrivals} arrivals`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {h > 0 && <path className={styles.chartBar} d={barPath(cx - barW / 2, PAD.top + plotH - h, barW, h)} pointerEvents="none" />}
              {i % labelEvery === 0 && (
                <text className={styles.chartAxis} x={cx} y={H - 8} textAnchor="middle">
                  {b.label.replace(/\s\S+$/, '')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && hover !== null && (
        <div
          className={styles.tooltip}
          style={{ left: `${((PAD.left + slot * hover + slot / 2) / W) * 100}%`, top: 12 }}
          role="status"
        >
          {hovered.label} · {hovered.arrivals}
        </div>
      )}
      <details className={styles.chartTable}>
        <summary>Show as table</summary>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Starting</th>
              <th className={styles.num}>Arrivals</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.bucketUtc}>
                <td>{b.label}</td>
                <td className={styles.num}>{b.arrivals}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
