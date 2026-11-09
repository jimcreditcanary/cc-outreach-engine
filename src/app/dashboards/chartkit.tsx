// Inline-SVG chart kit for the Dashboards tab. Server components, no charting
// dependency (the app hand-rolls SVG). Everything scales to its container via a
// viewBox + width:100%. Hover <title>s give exact values.

import type { ReactNode } from "react";

export const PALETTE = [
  "#0d9488", "#6366f1", "#f59e0b", "#ec4899", "#8b5cf6",
  "#14b8a6", "#ef4444", "#3b82f6", "#f97316", "#10b981",
];
const GRID = "#eef2f6";
const TXT = "#64748b";
const LBL = "#334155";

// ── formatters ──────────────────────────────────────────────────────────────
function trim(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}
export function gbpK(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `£${trim(n / 1_000_000)}m`;
  if (a >= 1_000) return `£${trim(n / 1_000)}k`;
  return `£${Math.round(n)}`;
}
export function gbp(n: number): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `£${Math.round(n).toLocaleString()}`;
  }
}
export function numK(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000) return `${trim(n / 1_000)}k`;
  return String(Math.round(n));
}
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * pow;
}
function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
const fmtUnit = (unit: "gbp" | "count") => (unit === "gbp" ? gbpK : numK);
const fmtFull = (unit: "gbp" | "count", v: number) => (unit === "gbp" ? gbp(v) : Math.round(v).toLocaleString());

// ── primitives ──────────────────────────────────────────────────────────────
export function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border bg-white p-3 ${accent ? "border-amber-200 ring-1 ring-amber-100" : "border-neutral-200"}`}>
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-400">{sub}</div>}
    </div>
  );
}

export function Panel({ title, hint, children, className }: { title: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-neutral-200 bg-white p-4 ${className ?? ""}`}>
      <h3 className="text-sm font-semibold text-neutral-700">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-neutral-400">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ label = "No data" }: { label?: string }) {
  return <div className="flex h-40 items-center justify-center text-sm text-neutral-400">{label}</div>;
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-neutral-500">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ── vertical columns (single or stacked series) ─────────────────────────────
export interface Series { name: string; color: string; values: number[] }

export function ColumnChart({ categories, series, unit = "gbp", emptyLabel }: { categories: string[]; series: Series[]; unit?: "gbp" | "count"; emptyLabel?: string }) {
  const fmtC = fmtUnit(unit);
  const totals = categories.map((_, i) => series.reduce((s, se) => s + (se.values[i] ?? 0), 0));
  const maxVal = Math.max(...totals, 0);
  if (maxVal <= 0) return <Empty label={emptyLabel} />;

  const W = 560, H = 300, PAD = { l: 50, r: 12, t: 22, b: 44 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b, top = niceMax(maxVal);
  const slot = plotW / categories.length, barW = Math.min(46, slot * 0.6);
  const y = (v: number) => PAD.t + plotH * (1 - v / top);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const stacked = series.length > 1;

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" className="max-w-full">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill={TXT}>{fmtC(t)}</text>
          </g>
        ))}
        {categories.map((cat, i) => {
          const cx = PAD.l + slot * i + (slot - barW) / 2;
          const total = totals[i] ?? 0;
          let acc = 0;
          return (
            <g key={i}>
              {series.map((se, si) => {
                const v = se.values[i] ?? 0;
                if (v <= 0) return null;
                const yTop = y(acc + v);
                const h = plotH * (v / top);
                acc += v;
                return (
                  <rect key={si} x={cx} y={yTop} width={barW} height={Math.max(0, h)} fill={se.color} rx={stacked ? 0 : 2}>
                    <title>{cat} · {se.name}: {fmtFull(unit, v)}</title>
                  </rect>
                );
              })}
              {total > 0 && <text x={cx + barW / 2} y={y(total) - 5} textAnchor="middle" fontSize={10} fontWeight={600} fill={LBL}>{fmtC(total)}</text>}
              <text x={cx + barW / 2} y={H - PAD.b + 16} textAnchor="middle" fontSize={11} fill={TXT}>{truncate(cat, 9)}</text>
            </g>
          );
        })}
      </svg>
      {stacked && <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />}
    </>
  );
}

// ── horizontal bars (categorical) ───────────────────────────────────────────
export function BarChart({ rows, unit = "count", emptyLabel }: { rows: { label: string; value: number; color?: string }[]; unit?: "gbp" | "count"; emptyLabel?: string }) {
  const fmtC = fmtUnit(unit);
  const maxVal = Math.max(...rows.map((r) => r.value), 0);
  if (maxVal <= 0 || rows.length === 0) return <Empty label={emptyLabel} />;

  const rowH = 30, W = 560, PADl = 168, PADr = 54, top = niceMax(maxVal);
  const H = rows.length * rowH + 12;
  const plotW = W - PADl - PADr;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" className="max-w-full">
      {rows.map((r, i) => {
        const cy = 6 + i * rowH;
        const bw = plotW * (r.value / top);
        return (
          <g key={i}>
            <text x={PADl - 8} y={cy + rowH / 2 + 3} textAnchor="end" fontSize={11} fill={LBL}>
              {truncate(r.label, 24)}
              <title>{r.label}</title>
            </text>
            <rect x={PADl} y={cy + 4} width={Math.max(2, bw)} height={rowH - 12} rx={2} fill={r.color ?? PALETTE[0]} />
            <text x={PADl + Math.max(2, bw) + 6} y={cy + rowH / 2 + 3} fontSize={10} fontWeight={600} fill={LBL}>{fmtC(r.value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── donut with legend ───────────────────────────────────────────────────────
function donutPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M ${p(rOuter, a0)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${p(rOuter, a1)}`,
    `L ${p(rInner, a1)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${p(rInner, a0)}`,
    "Z",
  ].join(" ");
}

export function Donut({ slices, centerValue, centerSub, emptyLabel }: { slices: { label: string; value: number; color: string }[]; centerValue: string; centerSub?: string; emptyLabel?: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <Empty label={emptyLabel} />;

  const size = 176, r = 70, rin = 46, cx = size / 2, cy = size / 2;
  let a = -Math.PI / 2;
  const arcs = slices.map((s, i) => {
    const frac = s.value / total;
    const a0 = a;
    const a1 = a + frac * 2 * Math.PI;
    a = a1;
    const title = <title>{s.label}: {Math.round(s.value)} ({Math.round((100 * s.value) / total)}%)</title>;
    // A full (≈100%) slice can't be drawn as one arc — render it as a stroked
    // ring circle instead, which is exact and seamless.
    if (frac >= 0.999) {
      return <circle key={i} cx={cx} cy={cy} r={(r + rin) / 2} fill="none" stroke={s.color} strokeWidth={r - rin}>{title}</circle>;
    }
    if (frac <= 0) return null;
    return <path key={i} d={donutPath(cx, cy, r, rin, a0, a1)} fill={s.color}>{title}</path>;
  });

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0">
        {arcs}
        <text x={cx} y={cy - 1} textAnchor="middle" fontSize={24} fontWeight={700} fill={LBL}>{centerValue}</text>
        {centerSub && <text x={cx} y={cy + 16} textAnchor="middle" fontSize={10} fill={TXT}>{centerSub}</text>}
      </svg>
      <ul className="min-w-[180px] flex-1 space-y-1 text-xs">
        {slices.map((s, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-neutral-600">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tabular-nums text-neutral-500">{Math.round((100 * s.value) / total)}% ({Math.round(s.value)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
