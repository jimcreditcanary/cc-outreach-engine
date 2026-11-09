"use client";

// Revenue dashboard for a deal — reads the deal's revenue-model fields off
// HubSpot (passed in as a plain `DealRevenue`) and shows:
//   • a 3×3 grid of call-out stats (Avg ARR, CARR, contract value), and
//   • a stacked-column chart with a dropdown over three series families:
//       - ARR (Combined)  → stacked Minimums + Forecast, annual £  (Combined = min + forecast)
//       - MRR (Minimums)  → monthly £ minimums curve
//       - MRR (Forecast)  → monthly £ forecast curve
//
// The chart is hand-rolled inline SVG (the app ships no charting library). The
// combined view stacks min×12 + forecast×12 so the bar total is the Combined ARR.

import { useState } from "react";
import type { DealRevenue } from "@/lib/hubspot/repo";

const MINIMUMS = "#6366f1"; // indigo-500
const FORECAST = "#f59e0b"; // amber-500

function sym(currency: string | null): string {
  switch ((currency ?? "GBP").toUpperCase()) {
    case "GBP": return "£";
    case "USD": return "$";
    case "EUR": return "€";
    default: return `${currency} `;
  }
}

function fmtFull(n: number | null, currency: string | null): string {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${sym(currency)}${Math.round(n).toLocaleString()}`;
  }
}

function fmtCompact(n: number, currency: string | null): string {
  const s = sym(currency);
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${s}${trim(n / 1_000_000)}m`;
  if (abs >= 1_000) return `${s}${trim(n / 1_000)}k`;
  return `${s}${Math.round(n)}`;
}
function trim(n: number): string {
  // 36 → "36", 2.5 → "2.5", 1.25 → "1.3"
  return (Math.round(n * 10) / 10).toString();
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const frac = v / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 5 ? 5 : 10;
  return nice * pow;
}

type Mode = "arr" | "mrr"; // unit toggle — the chart always stacks Minimums + Forecast

const YEARS = ["Y1", "Y2", "Y3", "Y4", "Y5"];

export function RevenueDashboard({ rev, sideContent }: { rev: DealRevenue; sideContent?: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("arr");
  const cur = rev.currency;

  const stats: { label: string; value: number | null; accent?: boolean }[] = [
    { label: "Average ARR (Minimums)", value: rev.avgArr.minimums },
    { label: "Average ARR (Forecast)", value: rev.avgArr.forecast },
    { label: "Average ARR (Combined)", value: rev.avgArr.combined, accent: true },
    { label: "CARR (Minimums)", value: rev.carr.minimums },
    { label: "CARR (Forecast)", value: rev.carr.forecast },
    { label: "CARR (Combined)", value: rev.carr.combined, accent: true },
    { label: "TCV", value: rev.tcv },
    { label: "Recurring TCV", value: rev.recurringTcv },
    { label: "One-off fees", value: rev.oneoffFees },
    { label: "Year 1 revenue", value: rev.y1Revenue, accent: true },
  ];

  // The chart card renders at ~half width. When the caller passes `sideContent`
  // (the deal's line items), it sits in the other column so the row isn't half
  // empty; otherwise the chart is capped so it doesn't stretch full-width.
  const chartCard = (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          className="rounded border border-neutral-300 px-2 py-1 text-sm font-medium text-neutral-800"
          aria-label="Revenue unit"
        >
          <option value="arr">ARR · £/yr</option>
          <option value="mrr">MRR · £/mo</option>
        </select>
        <span className="text-xs text-neutral-400">
          Minimums + Forecast, by year ({mode === "arr" ? "annual" : "monthly"})
        </span>
      </div>
      <Chart rev={rev} mode={mode} />
    </div>
  );

  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Revenue</h2>

      {/* Call-out stats — 2×5 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`rounded-lg border bg-white p-3 ${s.accent ? "border-amber-200 ring-1 ring-amber-100" : "border-neutral-200"}`}
          >
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">{s.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-neutral-900">{fmtFull(s.value, cur)}</div>
          </div>
        ))}
      </div>

      {/* Chart + optional side content (line items) side by side */}
      {sideContent ? (
        <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {chartCard}
          {sideContent}
        </div>
      ) : (
        <div className="mt-4 max-w-xl">{chartCard}</div>
      )}
    </section>
  );
}

function Chart({ rev, mode }: { rev: DealRevenue; mode: Mode }) {
  const cur = rev.currency;
  const per = mode === "arr" ? "/yr" : "/mo";
  // Always a stacked Minimums + Forecast column (= Combined). The unit toggle
  // just scales the monthly curves to annual (×12) for the ARR view.
  const mult = mode === "arr" ? 12 : 1;
  const cols = YEARS.map((_, i) => {
    const min = (rev.mrrMinimums[i] ?? 0) * mult;
    const fc = (rev.mrrForecast[i] ?? 0) * mult;
    return { min, fc, total: min + fc };
  });

  const maxVal = Math.max(...cols.map((c) => c.total), 0);
  if (maxVal <= 0) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-neutral-400">
        No minimums or forecast {mode === "arr" ? "ARR" : "MRR"} modelled on this deal.
      </div>
    );
  }

  const W = 640, H = 330;
  const PAD = { l: 66, r: 18, t: 30, b: 48 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const top = niceMax(maxVal);
  const slot = plotW / YEARS.length;
  const barW = Math.min(56, slot * 0.56);
  const y = (v: number) => PAD.t + plotH * (1 - v / top);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img" className="max-w-full">
        {/* gridlines + y labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#f1f5f9" strokeWidth={1} />
            <text x={PAD.l - 8} y={y(t) + 5} textAnchor="end" className="fill-neutral-400" fontSize={15}>
              {fmtCompact(t, cur)}
            </text>
          </g>
        ))}
        {/* baseline */}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="#e2e8f0" strokeWidth={1} />

        {cols.map((c, i) => {
          const cx = PAD.l + slot * i + (slot - barW) / 2;
          const fcH = plotH * ((c.fc) / top);
          const minY = y(c.min);
          const fcY = y(c.min + c.fc);
          return (
            <g key={i}>
              {c.min > 0 && (
                <rect x={cx} y={minY} width={barW} height={Math.max(0, y(0) - minY)} fill={MINIMUMS}>
                  <title>{YEARS[i]} Minimums: {fmtFull(c.min, cur)}{per}</title>
                </rect>
              )}
              {c.fc > 0 && (
                <rect x={cx} y={fcY} width={barW} height={Math.max(0, fcH)} fill={FORECAST}>
                  <title>{YEARS[i]} Forecast: {fmtFull(c.fc, cur)}{per}</title>
                </rect>
              )}
              {/* total label */}
              {c.total > 0 && (
                <text x={cx + barW / 2} y={y(c.total) - 8} textAnchor="middle" className="fill-neutral-700 font-semibold" fontSize={16}>
                  {fmtCompact(c.total, cur)}
                </text>
              )}
              {/* x label */}
              <text x={cx + barW / 2} y={H - PAD.b + 26} textAnchor="middle" className="fill-neutral-500" fontSize={16}>
                {YEARS[i]}
              </text>
            </g>
          );
        })}
      </svg>

      {/* legend */}
      <div className="mt-2 flex items-center justify-center gap-4 text-sm text-neutral-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: MINIMUMS }} /> Minimums
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: FORECAST }} /> Forecast
        </span>
      </div>
    </>
  );
}
