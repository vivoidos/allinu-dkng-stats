// The hero number, drawn out of the shares it stands for, as a marquee of light bulbs: each bulb is a round number
// of tokenized DraftKings shares paid to ALLINU holders, lit left to right in the order they were paid, one shade
// per day. Cells the glyphs have room for beyond the last bulb stay unlit.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { day, int } from "./format.ts";

/** One day of payouts to ALLINU holders. */
export interface PayoutDay { d: string; dkng: number; usd: number }

const SWEEP_MS = 1800;
const UNITS = [1, 5, 10, 20, 50, 100, 200, 500, 1000]; // shares per dot: the smallest that keeps dots visible
const SHADES = ["#ffd98a", "#e8a94a"]; // tungsten bulbs, alternating day by day
const HOVER = "#fff6e2";
const UNLIT = "rgba(243, 233, 218, .08)";

/** One bulb with its glow, drawn once per shade and size, then stamped. */
function bulb(color: string, core: number, dpr: number) {
  const side = Math.ceil(core * 3.2 * dpr), c = document.createElement("canvas");
  c.width = c.height = side;
  const g = c.getContext("2d")!, m = side / 2, r = (core / 2) * dpr;
  const glow = g.createRadialGradient(m, m, 0, m, m, m);
  glow.addColorStop(0, `${color}99`); glow.addColorStop(0.35, `${color}33`); glow.addColorStop(1, `${color}00`);
  g.fillStyle = glow; g.fillRect(0, 0, side, side);
  g.fillStyle = color; g.beginPath(); g.arc(m, m, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255, 255, 255, .75)"; g.beginPath(); g.arc(m - r * 0.3, m - r * 0.3, r * 0.38, 0, Math.PI * 2); g.fill();
  return c;
}
const FONT = '700 100px "Space Grotesk"';

/** Width of the element, tracked as it resizes. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Waits for the display face, so the glyphs are measured in it and not in a fallback. */
function useFontReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    // until the font stylesheet is in, load() knows no such face and resolves with nothing: retry for up to 3 s
    const tryLoad = async (left: number) => {
      const faces = await document.fonts.load(FONT).catch(() => []);
      if (!live) return;
      if (faces.length || left <= 0) setReady(true);
      else setTimeout(() => tryLoad(left - 1), 150);
    };
    document.fonts.ready.then(() => tryLoad(20));
    return () => { live = false; };
  }, []);
  return ready;
}

interface Layout { height: number; pitch: number; size: number; cells: { x: number; y: number }[]; unit: number }

/**
 * Rasterises `text` to fit `width`, then finds the grid pitch at which the glyphs hold (just over) one cell per
 * dot. Cells come out column by column, left to right, so filling them in order sweeps across the number.
 */
function layOut(text: string, width: number, shares: number, minPitch: number): Layout {
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = FONT;
  const m = probe.measureText(text);
  const glyphH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  // wide screens leave the right third to the photo behind the number; never taller than 320px
  const room = width > 960 ? width * 0.64 : width;
  const scale = Math.min(room / m.width, 320 / glyphH);
  const height = Math.ceil(glyphH * scale) + 4;
  const mask = document.createElement("canvas");
  mask.width = Math.ceil(width);
  mask.height = height;
  const ctx = mask.getContext("2d", { willReadFrequently: true })!;
  ctx.font = FONT.replace("100px", `${100 * scale}px`);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, 0, 2 + m.actualBoundingBoxAscent * scale); // left-aligned, like the rest of the page
  const pixels = ctx.getImageData(0, 0, mask.width, height).data;
  const inside = (x: number, y: number) => (pixels[(Math.floor(y) * mask.width + Math.floor(x)) * 4 + 3] ?? 0) > 127;
  const cellsAt = (pitch: number) => {
    const cells: { x: number; y: number }[] = [];
    for (let x = pitch / 2; x < width; x += pitch) for (let y = pitch / 2; y < height; y += pitch) if (inside(x, y)) cells.push({ x, y });
    return cells;
  };
  // ink area → the unit; then binary-search the pitch so the cells just cover the dots
  let ink = 0;
  for (let i = 3; i < pixels.length; i += 16) if ((pixels[i] ?? 0) > 127) ink += 4;
  const unit = UNITS.find((u) => Math.sqrt(ink / (shares / u)) >= minPitch) ?? UNITS[UNITS.length - 1]!;
  const dots = Math.max(1, Math.round(shares / unit));
  let lo = 1, hi = 60, cells = cellsAt(1);
  for (let k = 0; k < 18; k++) {
    const mid = (lo + hi) / 2;
    const c = cellsAt(mid);
    if (c.length >= dots) { lo = mid; cells = c; } else hi = mid;
  }
  return { height, pitch: lo, size: lo * 0.6, cells, unit };
}

/** `tail` sits between the number and its caption: the rest of the headline sentence. */
export function DotNumber({ text, shares, days, tail }: { text: string; shares: number; days: PayoutDay[]; tail?: ReactNode }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const fontReady = useFontReady();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(0); // 0…1, the left-to-right sweep on first paint
  const narrow = width > 0 && width < 640;

  const layout = useMemo(() => (fontReady && width > 0 ? layOut(text, width, shares, narrow ? 4.6 : 7) : null), [fontReady, width, text, shares, narrow]);
  const dots = layout ? Math.round(shares / layout.unit) : 0;
  // the dot each day starts at: days fill the dots in order, each as many as its shares
  const dayStarts = useMemo(() => {
    let acc = 0;
    return days.map((x) => { const start = Math.round(acc / (layout?.unit ?? 1)); acc += x.dkng; return start; });
  }, [days, layout]);
  const dayOf = (i: number) => { let k = 0; while (k + 1 < dayStarts.length && (dayStarts[k + 1] ?? Infinity) <= i) k++; return k; };

  useEffect(() => {
    if (!layout) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setRevealed(1); return; }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / SWEEP_MS)); // a frame can be stamped before `start`
      setRevealed(1 - (1 - t) ** 3);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [layout]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !layout) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(width * dpr);
    el.height = Math.round(layout.height * dpr);
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, layout.height);
    const edge = width * revealed; // the sweep lights bulbs left of this line
    const s = layout.size, glow = s * 3.2;
    const lit = [...SHADES, HOVER].map((col) => bulb(col, s, dpr));
    let k = 0;
    ctx.fillStyle = UNLIT;
    layout.cells.forEach((c) => { // every socket, lit or not
      ctx.beginPath(); ctx.arc(c.x, c.y, s / 2, 0, Math.PI * 2); ctx.fill();
    });
    layout.cells.forEach((c, i) => {
      if (c.x > edge || i >= dots) return;
      while (k + 1 < dayStarts.length && (dayStarts[k + 1] ?? Infinity) <= i) k++;
      const sprite = days.length === 0 ? lit[0]! : k === hover ? lit[2]! : lit[k % 2]!;
      ctx.drawImage(sprite, c.x - glow / 2, c.y - glow / 2, glow, glow);
    });
  }, [layout, width, revealed, hover, dots, days, dayStarts]);

  const onPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!layout || !days.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best = -1, bestD = (layout.pitch * 1.5) ** 2;
    layout.cells.forEach((c, i) => { const dd = (c.x - x) ** 2 + (c.y - y) ** 2; if (i < dots && dd < bestD) { bestD = dd; best = i; } });
    setHover(best >= 0 ? dayOf(best) : null);
  };

  const h = hover === null ? undefined : days[hover];
  return (
    <figure className="dot-number">
      <div ref={box} className="dot-number-box" style={{ height: layout?.height ?? 200 }}>
        <canvas ref={canvas} aria-hidden="true" style={{ width: "100%", height: layout?.height ?? 200 }} onPointerMove={onPoint} onPointerDown={onPoint} onPointerLeave={() => setHover(null)} />
      </div>
      {tail}
      <figcaption className="dot-note">
        {h
          ? <><b>{day(h.d)}</b>: ≈{int(h.dkng)} shares paid, worth ≈${int(h.usd)} at today's price.</>
          : null}
      </figcaption>
    </figure>
  );
}
