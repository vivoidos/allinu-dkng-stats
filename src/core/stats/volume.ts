// Volume: daily DKNG trading on Solana, the ALLINU pool vs every other DKNG pool, the weekend share,
// and how much traded while Nasdaq was closed.
// ALLINU's shares count from the ALLINU pool's first trading hour (it opened hours after DKNG's first trades
// on Sep 11); the market-wide numbers (when DKNG trades, how much while Nasdaq is closed) count from Sep 11.
// Source: GeckoTerminal hourly candles for every DKNG pool (~1 call per pool, ~2 minutes).

import { getJSON, pacer } from "../http.ts";
import { ADDR, SINCE, GECKO, geckoHourlyCandles, utcDay, listIn, type Candle, type Progress } from "./shared.ts";
import { getPools, type Pool } from "./pools.ts";
import { nasdaqOpenShare, newYorkHour } from "./nasdaq.ts";

// Hourly pool volume can come from Birdeye instead (BIRDEYE_API_KEY): one call per pool, no 30-calls-a-minute wait.
// Checked against GeckoTerminal day by day (Sep 11 – Oct 2): most days agree within ~1%; Birdeye counts more on two
// launch-week days (Sep 15 +22%, Sep 16 +8%), so +4.3% on the ALLINU pool and +1.7% elsewhere in all. The shares the page
// shows barely move (pool share 28.2% → 28.8%, with routed legs 56.6% either way). Without a key, GeckoTerminal: keyless.
const BIRDEYE = "https://public-api.birdeye.so";
const birdeyePace = pacer(120);
let birdeyeKey: string | undefined;
export function useBirdeye(key: string) { birdeyeKey = key; }

async function poolCandles(pool: string, launch: number): Promise<Candle[]> {
  if (birdeyeKey) {
    const byTime = new Map<number, Candle>(); // keyed by hour: pages may share their boundary candle
    const now = Math.floor(Date.now() / 1000);
    // 900-hour windows: always under one page's cap, so nothing depends on how a capped page is cut
    for (let from = launch; from < now; from += 900 * 3600) {
      const to = Math.min(now, from + 900 * 3600);
      const r = await getJSON<{ data?: { items?: { unix_time: number; o: number; h: number; l: number; c: number; v_usd: number }[] } }>(
        `${BIRDEYE}/defi/v3/ohlcv/pair?address=${pool}&type=1H&time_from=${from}&time_to=${to}`,
        { init: { headers: { "X-API-KEY": birdeyeKey, "x-chain": "solana", accept: "application/json" } }, pace: birdeyePace, label: "Birdeye" });
      const items = listIn(r.data?.items, `Birdeye candles for ${pool}`);
      for (const x of items) byTime.set(x.unix_time, [x.unix_time, x.o, x.h, x.l, x.c, x.v_usd]);
    }
    return [...byTime.values()];
  }
  return geckoHourlyCandles(pool, launch);
}

/** DKNG markets with real volume that GeckoTerminal doesn't list (checked against Birdeye's markets, Oct 5 2026). */
const UNLISTED_POOLS = [
  { address: "dWayhjG6YnURZQqWTpB2pYmQXm67kHNrcnUAsXWwDqh", name: "DKNG / USDC (Denali)" },
];

/** The share of the hours from `from` (unix seconds) to the last finished hour that Nasdaq was closed. */
function closedHoursShare(from: number): number {
  const end = Math.floor(Date.now() / 3_600_000) * 3600;
  let closed = 0, hours = 0;
  for (let h = from; h < end; h += 3600, hours++) closed += 1 - nasdaqOpenShare(h);
  return hours ? closed / hours : 0;
}

export async function getVolume({ pools, onProgress }: { pools?: Pool[]; onProgress?: Progress } = {}) {
  const listed = pools ?? (await getPools()).all;
  // DKNG markets GeckoTerminal doesn't list, read through Birdeye when there is a key: without them the total would
  // miss trading that routed volume already counts (a routed leg can pass through any DKNG pool)
  const extra = birdeyeKey ? UNLISTED_POOLS.filter((p) => !listed.some((l) => l.address === p.address)) : [];
  const allPools = [...listed, ...extra];
  const launch = Date.parse(SINCE) / 1000;
  const series: { isAllinu: boolean; candles: Candle[] }[] = []; // each pool's hourly candles

  for (const [i, pool] of allPools.entries()) {
    onProgress?.(i + 1, allPools.length);
    series.push({ isAllinu: pool.address === ADDR.ALLINU_DKNG_POOL, candles: await poolCandles(pool.address, launch) });
  }
  if (!series.some((p) => p.isAllinu)) throw new Error("GeckoTerminal no longer lists the ALLINU/DKNG pool");

  // the ALLINU pool's first hour with any trading
  const firstHour = Math.min(...(series.find((p) => p.isAllinu)?.candles ?? []).filter((c) => c[5] > 0).map((c) => c[0]));
  const allinuFrom = Number.isFinite(firstHour) ? Math.max(firstHour, launch) : launch;
  const market = { all: 0, closed: 0, launchDay: 0, launchDayClosed: 0 }; // every DKNG pool, from Sep 11
  const launchDay = utcDay(launch);
  const t = { all: 0, allinu: 0, weekendAll: 0, weekendAllinu: 0, closedAll: 0, closedAllinu: 0 }; // from ALLINU's first hour
  const daily = new Map<string, { allinu: number; rest: number }>();
  // all DKNG volume by New York weekday (Mon = 0) and hour, to show when it trades relative to Nasdaq hours
  const byHourNewYork = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const { isAllinu, candles } of series) {
    for (const [time, , , , , volume] of candles) {
      if (time < launch) continue;
      const closed = volume * (1 - nasdaqOpenShare(time));
      market.all += volume;
      market.closed += closed;
      if (utcDay(time) === launchDay) { market.launchDay += volume; market.launchDayClosed += closed; }
      const ny = newYorkHour(time);
      byHourNewYork[ny.weekday]![ny.hour]! += volume;
      if (time < allinuFrom) continue;
      const weekend = [0, 6].includes(new Date((time + 1800) * 1000).getUTCDay());
      const day = daily.get(utcDay(time)) ?? { allinu: 0, rest: 0 };
      if (isAllinu) day.allinu += volume; else day.rest += volume;
      daily.set(utcDay(time), day);
      t.all += volume;
      t.closedAll += closed;
      if (weekend) t.weekendAll += volume;
      if (isAllinu) {
        t.allinu += volume;
        t.closedAllinu += closed;
        if (weekend) t.weekendAllinu += volume;
      }
    }
  }
  return {
    sources: [
      `${GECKO}/tokens/${ADDR.DKNG}/pools (the list of DKNG pools)`,
      birdeyeKey ? `${BIRDEYE}/defi/v3/ohlcv/pair (hourly volume of each DKNG pool, and of DKNG markets GeckoTerminal doesn't list)` : `${GECKO}/pools/{each DKNG pool}/ohlcv/hour`,
    ],
    pools: allPools.length,
    unlistedPools: extra.map((p) => p.name), // counted though GeckoTerminal doesn't list them
    allinuFrom: new Date(allinuFrom * 1000).toISOString(),
    // from the ALLINU pool's first hour
    total: t.all,
    allinu: t.allinu,
    share: t.allinu / t.all,
    weekendShare: t.weekendAllinu / t.weekendAll,
    allinuShareWhileClosed: t.closedAllinu / t.closedAll, // the ALLINU pool alone
    closedSinceAllinu: t.closedAll, // every DKNG pool while Nasdaq was closed, from the ALLINU pool's first hour
    closedAllinu: t.closedAllinu, // the ALLINU pool while Nasdaq was closed
    // every DKNG pool from Sep 11
    marketTotal: market.all,
    closedTotal: market.closed,
    // DKNG's first day: trading opened on it right after Friday's Nasdaq close, so it weighs on the closed share
    launchDayTotal: market.launchDay,
    launchDayClosed: market.launchDayClosed,
    closedHoursShare: closedHoursShare(launch),
    byHourNewYork: byHourNewYork.map((row) => row.map(Math.round)),
    closedShareOfAll: market.closed / market.all,
    daily: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d, allinu: Math.round(v.allinu), rest: Math.round(v.rest) })),
  };
}
export type Volume = Awaited<ReturnType<typeof getVolume>>;
