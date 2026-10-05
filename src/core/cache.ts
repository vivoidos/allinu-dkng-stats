// Saves what the slow blocks read from the chain, so a re-run never fetches the same day twice.
// Files live in snapshots/cache/ (not committed). Each is written to a temporary file first and then renamed into place,
// so a run that stops halfway never leaves a half-written file behind.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { OriginsCache, TracedEntry } from "./stats/origins.ts";
import type { RoutedCache, RoutedDay } from "./stats/routed.ts";

const root = new URL("../../snapshots/cache/", import.meta.url);

function write(url: URL, value: unknown) {
  mkdirSync(new URL(".", url), { recursive: true });
  const tmp = new URL(`${url.href}.tmp`);
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, url);
}

/** A cached file, or undefined when it is missing or unreadable: then the data is read from the chain again. */
function read<T>(url: URL): T | undefined {
  if (!existsSync(url)) return undefined;
  try {
    return JSON.parse(readFileSync(url, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export const routedCache: RoutedCache = {
  load: (day) => read<RoutedDay>(new URL(`routed/${day}.json`, root)),
  save: (day) => write(new URL(`routed/${day.day}.json`, root), day),
  loadPrices: () => read<Record<string, number>>(new URL("dkng-hourly-prices.json", root)),
  savePrices: (prices) => write(new URL("dkng-hourly-prices.json", root), prices),
};

export const originsCache: OriginsCache = {
  load: () => read<Record<string, TracedEntry>>(new URL("origins.json", root)),
  save: (entries) => write(new URL("origins.json", root), entries),
};
