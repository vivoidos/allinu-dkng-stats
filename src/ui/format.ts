// Number and date formatting for the page.

export const int = (v: number) => Math.round(v).toLocaleString("en-US");

export function usd(v: number, digits = 1): string {
  if (v >= 1e6 || Math.round(v / 1e3) >= 1000) return `$${(v / 1e6).toFixed(digits)}M`; // never "$1000K"
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

export const pct = (v: number) => (v > 0 && v < 0.01 ? "<1%" : `${Math.round(v * 100)}%`);

/** "Sep 11" from "2026-09-11" or a full ISO timestamp (UTC). */
export const day = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "Oct 1, 20:57 UTC" */
export const time = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
