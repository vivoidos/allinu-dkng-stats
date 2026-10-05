// Charts, built on Recharts. Colors are the page's CSS variables, so light and dark mode both work.

import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const AXIS = { fill: "var(--text-muted)", fontSize: 12 };
const ALLINU = "var(--series-1)";
const OTHER = "var(--series-other)";

// ---------- shared tooltip ----------

interface TipRow { name: ReactNode; value: ReactNode; color?: string }
function TipBox({ title, rows, note }: { title?: ReactNode; rows: TipRow[]; note?: ReactNode }) {
  return (
    <div className="tip">
      {title && <div className="muted">{title}</div>}
      {rows.map((r, i) => (
        <div key={i} className="tip-row">{r.color && <i style={{ background: r.color }} />}{r.name} <b>{r.value}</b></div>
      ))}
      {note && <div className="muted">{note}</div>}
    </div>
  );
}

// Recharts hands the hovered data point to the tooltip's `content`; we only need its own fields.
type TipProps = { active?: boolean; payload?: readonly { payload?: unknown }[] };
const hovered = <T,>(p: TipProps) => (p.active ? (p.payload?.[0]?.payload as T | undefined) : undefined);

// ---------- volume to date: stacked areas ----------

export interface DailyVolume { label: string; allinu: number; routed?: number; rest: number }
const ROUTED = "color-mix(in oklab, var(--series-1) 48%, var(--bg))";

/**
 * Volume summed day by day: the ALLINU pool at the bottom, then (when known) the volume ALLINU trades routed
 * through other pools, then everything else. `rest` already excludes `routed`.
 */
export function CumulativeVolumeChart({ data, money }: { data: DailyVolume[]; money: (v: number) => string }) {
  let allinu = 0, routed = 0, rest = 0;
  const running = data.map((x) => ({ label: x.label, allinu: (allinu += x.allinu), routed: (routed += x.routed ?? 0), rest: (rest += x.rest) }));
  const withRouted = data.some((x) => x.routed !== undefined);
  return (
    <div className="chart-box" style={{ height: 320 }}>
      <ResponsiveContainer>
        <AreaChart data={running} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={money} width={60} />
          <Tooltip cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 3" }} content={(p: TipProps) => {
            const d = hovered<Required<DailyVolume>>(p);
            if (!d) return null;
            const through = d.allinu + d.routed, all = through + d.rest;
            return <TipBox title={`Up to ${d.label}`} rows={[
              { name: "ALLINU pool", value: money(d.allinu), color: ALLINU },
              ...(withRouted ? [{ name: "Other pools, ALLINU trades", value: money(d.routed), color: ROUTED }] : []),
              { name: withRouted ? "Other pools, everything else" : "Every other pool", value: money(d.rest), color: OTHER },
            ]} note={`Through ALLINU ${Math.round((100 * through) / (all || 1))}%`} />;
          }} />
          <Area type="monotone" dataKey="allinu" stackId="v" stroke={ALLINU} strokeWidth={2} fill={ALLINU} fillOpacity={0.85} animationDuration={900} />
          {withRouted && <Area type="monotone" dataKey="routed" stackId="v" stroke={ROUTED} strokeWidth={2} fill={ROUTED} fillOpacity={0.9} animationDuration={900} />}
          <Area type="monotone" dataKey="rest" stackId="v" stroke={OTHER} strokeWidth={2} fill={OTHER} fillOpacity={0.35} animationDuration={900} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- horizontal bars (pools, origins) ----------

export interface HBar { label: string; value: number; highlight: boolean; tip?: ReactNode }

export function HBarChart({ data, format, labelWidth = 230 }: { data: HBar[]; format: (v: number) => string; labelWidth?: number }) {
  return (
    <div className="chart-box" style={{ height: data.length * 44 + 8 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }} barCategoryGap={10}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" tick={{ ...AXIS, fill: "var(--text-secondary)", fontSize: 13 }} tickLine={false} axisLine={false} width={labelWidth} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={(p: TipProps) => {
            const d = hovered<HBar>(p);
            return d ? <TipBox rows={[{ name: d.label, value: format(d.value) }]} note={d.tip} /> : null;
          }} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} animationDuration={700}>
            {data.map((d) => <Cell key={d.label} fill={d.highlight ? ALLINU : OTHER} />)}
            <LabelList dataKey="value" position="right" formatter={(v: unknown) => format(Number(v))} style={{ fill: "var(--text-primary)", fontSize: 13, fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- area over time (supply, payouts) ----------

export interface Point { label: string; value: number; note?: string }

export function AreaOverTime({ data, format, name, height = 300 }: { data: Point[]; format: (v: number) => string; name: string; height?: number }) {
  const fillId = `fill-${name.replace(/[^a-z0-9]+/gi, "-")}`; // an SVG id: no spaces
  return (
    <div className="chart-box" style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ALLINU} stopOpacity={0.45} />
              <stop offset="100%" stopColor={ALLINU} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={format} width={56} />
          <Tooltip cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 3" }} content={(p: TipProps) => {
            const d = hovered<Point>(p);
            return d ? <TipBox title={d.label} rows={[{ name, value: format(d.value), color: ALLINU }]} note={d.note} /> : null;
          }} />
          <Area type="monotone" dataKey="value" stroke={ALLINU} strokeWidth={2} fill={`url(#${fillId})`} animationDuration={900} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- 100 squares, split into parts ----------

export interface WafflePart { count: number; label: string; tone: "allinu" | "allinu-soft" | "other" }
const TONE = { allinu: ALLINU, "allinu-soft": "color-mix(in oklab, var(--series-1) 42%, var(--bg))", other: OTHER };

/** 100 squares filled part by part, in order: "79 of every 100 holders…". */
export function Waffle({ parts }: { parts: WafflePart[] }) {
  const squares = parts.flatMap((p) => Array.from({ length: p.count }, () => p.tone));
  return (
    <div className="waffle-wrap">
      <div className="waffle" role="img" aria-label={parts.map((p) => `${p.count} of 100: ${p.label}`).join("; ")}>
        {squares.map((tone, i) => <i key={i} style={{ background: TONE[tone] }} />)}
      </div>
      <div className="legend">
        {parts.map((p) => <span key={p.label}><i style={{ background: TONE[p.tone] }} /><b className="num">{p.count}</b>&nbsp;{p.label}</span>)}
      </div>
    </div>
  );
}

/**
 * A week × hour heatmap of volume in New York time, with Nasdaq's regular session (Mon–Fri 9:30–16:00)
 * boxed. Plain CSS grid: Recharts has no heatmap. Colour follows log(volume): one launch-day hour is 100× a
 * normal one, and a linear scale would leave every other hour dark.
 */
export function WeekHeatmap({ grid, money }: { grid: number[][]; money: (v: number) => string }) {
  const logs = grid.flat().map(Math.log1p);
  const lo = Math.min(...logs), hi = Math.max(...logs, lo + 1);
  const shade = (v: number) => Math.round(6 + 94 * ((Math.log1p(v) - lo) / (hi - lo)) ** 1.3); // quietest hour → busiest hour
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const session = (d: number, h: number) => (d > 4 || h < 9 || h > 15 ? "Nasdaq closed" : h === 9 ? "Nasdaq opens at 9:30" : "Nasdaq open");
  return (
    <div className="heatmap" onMouseLeave={() => setHover(null)}>
      <div className="heatmap-grid" aria-hidden="true">
        {days.map((day, d) => (
          <Fragment key={day}>
            <span className="heatmap-day" style={{ gridRow: d + 1, gridColumn: 1 }}>{day}</span>
            {grid[d]?.map((v, h) => (
              <span key={h} className="heatmap-cell" onMouseEnter={() => setHover({ d, h })} onClick={() => setHover({ d, h })}
                style={{ gridRow: d + 1, gridColumn: h + 2, background: `color-mix(in oklab, var(--series-1) ${shade(v)}%, var(--surface-2))` }} />
            ))}
          </Fragment>
        ))}
        {/* hours 9–15 sit in grid columns 11–17 */}
        <span className="heatmap-session" style={{ gridRow: "1 / 6", gridColumn: "11 / 18" }} aria-hidden="true"><em>Nasdaq open</em></span>
        {Array.from({ length: 24 }, (_, h) => h % 6 === 0 && <span key={h} className="heatmap-hour" style={{ gridRow: 8, gridColumn: h + 2 }}>{h}:00</span>)}
      </div>
      <div className="heatmap-note">
        {hover
          ? <>{days[hover.d]} {hover.h}:00–{hover.h + 1}:00 New York time: <b>{money(grid[hover.d]?.[hover.h] ?? 0)}</b>, {session(hover.d, hover.h)}</>
          : <>Brighter means more DKNG traded (log scale). Hover or tap an hour for the amount.</>}
      </div>
    </div>
  );
}

// ---------- numbers that count up on first show ----------

export function useCountUp(target: number, ms = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setValue(target); return; }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      // clamped below too: a frame's timestamp can be earlier than `start`, and t < 0 would ease to a negative number
      const t = Math.max(0, Math.min(1, (now - start) / ms));
      setValue(target * (1 - (1 - t) ** 3)); // ease-out
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return value;
}

// ---------- data table: the numbers behind a chart, shown in the methodology dialog ----------

export function DataTable({ caption, headers, rows }: { caption?: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="table-scroll">
      <table>
        {caption && <caption>{caption}</caption>}
        <thead><tr>{headers.map((h, i) => <th key={h} scope="col" className={i ? "r" : undefined}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[0])}>{r.map((c, i) => i ? <td key={i} className="r num">{c}</td> : <th key={i} scope="row">{c}</th>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
