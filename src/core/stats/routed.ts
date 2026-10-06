// Routed volume: DKNG volume that ALLINU trades push through OTHER DKNG pools.
// Buying ALLINU with SOL or USDC usually routes SOL → DKNG → ALLINU: the second leg trades in the ALLINU
// pool, the first in some other DKNG pool, where volume.ts counts it as "other pools". Here we read every
// transaction that touched the ALLINU pool and add up the DKNG that moved through other pools' vaults
// in the same transaction: the DKNG balance change of every DKNG account that is neither the ALLINU
// pool's vault nor owned by a signer (routers' pass-through accounts net to zero). Dollars at that hour's
// DKNG price. Arbitrage that passes through the ALLINU pool counts too: it is DKNG volume in trades that
// went through ALLINU.
// Needs an RPC with getTransactionsForAddress (well over a million transactions); each finished day is
// saved through `cache`, so a re-run only reads days it doesn't have.

import { mapConcurrent } from "../http.ts";
import { hasTransactionsForAddress, rpcParallelism, transactionPages, type TokenBalance, type Transaction } from "../solana.ts";
import { ADDR, allinuPoolDkngVault, toDkng, GECKO, geckoHourlyCandles, utcDay, sum } from "./shared.ts";
import { nasdaqOpenShare } from "./nasdaq.ts";
import type { Pool } from "./pools.ts";
import type { Volume } from "./volume.ts";

/** Bump when routedDkng() or what a RoutedDay holds changes: cached days from another rule are read again. */
export const ROUTED_RULE = 1;

export interface RoutedDay {
  rule: number; // ROUTED_RULE the day was read under
  day: string; // UTC date
  transactions: number;
  perHour: number[]; // transactions per UTC hour
  routed: [signature: string, time: number, dkng: number][]; // transactions that moved DKNG through other pools
}
export interface RoutedCache {
  load(day: string): RoutedDay | undefined;
  save(day: RoutedDay): void;
  loadPrices(): Record<string, number> | undefined;
  savePrices(prices: Record<string, number>): void;
}

/** DKNG moved through other pools in one transaction, in DKNG. */
function routedDkng(tx: Transaction, allinuVault: string): number {
  const keys = tx.transaction.message.accountKeys;
  const signers = new Set(keys.filter((k) => k.signer).map((k) => k.pubkey));
  const change = new Map<number, bigint>(); // account index → DKNG change
  const owner = new Map<number, string | undefined>();
  const add = (b: TokenBalance, sign: bigint) => {
    if (b.mint !== ADDR.DKNG) return;
    change.set(b.accountIndex, (change.get(b.accountIndex) ?? 0n) + sign * BigInt(b.uiTokenAmount.amount));
    owner.set(b.accountIndex, b.owner);
  };
  for (const b of tx.meta.preTokenBalances) add(b, -1n);
  for (const b of tx.meta.postTokenBalances) add(b, 1n);
  let moved = 0n;
  for (const [i, delta] of change) {
    const o = owner.get(i);
    if (keys[i]?.pubkey === allinuVault || (o && signers.has(o))) continue;
    moved += delta < 0n ? -delta : delta;
  }
  // each other pool a trade passed through shows once, as its vault's change; that is that pool's leg of the trade
  return toDkng(moved);
}

/** Hourly DKNG prices in USD back to `fromSec`, from the largest actively traded DKNG pool that isn't ALLINU's (GeckoTerminal). */
async function hourlyDkngPrice(pools: Pool[], fromSec: number): Promise<Record<string, number>> {
  // a pool that traded in the last 24 hours: an untraded pool's price can be stale
  const main = pools.find((p) => p.address !== ADDR.ALLINU_DKNG_POOL && p.volume24h > 0);
  if (!main) throw new Error("no DKNG pool to price DKNG from");
  const thisHour = Math.floor(Date.now() / 3_600_000) * 3600;
  const prices: Record<string, number> = {};
  for (const c of await geckoHourlyCandles(main.address, fromSec, `&token=${ADDR.DKNG}`)) {
    if (c[0] < thisHour) prices[String(c[0])] = c[4]; // the hour still trading has no final close
  }
  return prices;
}

export async function getRoutedVolume({ volume, pools, cache, maxTransactions = 2_000_000, onlyDays, onDay }: {
  volume: Volume;
  pools: Pool[];
  cache: RoutedCache;
  onlyDays?: string[]; // read just these UTC days (a trial run); the totals then cover only them
  maxTransactions?: number; // stop before reading more than this (each 100 cost ~10 RPC credits on metered plans)
  onDay?: (day: string, transactions: number, fromCache: boolean) => void;
}) {
  if (!(await hasTransactionsForAddress())) throw new Error("routed volume needs an RPC with getTransactionsForAddress (set SOLANA_RPC_URL)");
  const vault = await allinuPoolDkngVault();
  const from = Date.parse(volume.allinuFrom) / 1000;
  const today = utcDay(Date.now() / 1000);
  let read = 0;
  const days: RoutedDay[] = [];
  for (let t = Math.floor(from / 86400) * 86400; t < Date.now() / 1000; t += 86400) {
    const day = utcDay(t);
    if (onlyDays && !onlyDays.includes(day)) continue;
    const settled = Date.now() / 1000 > t + 86400 + 3600; // an hour past midnight: the indexer has every transaction
    const cached = day < today ? cache.load(day) : undefined; // today is still going: always read it
    if (cached?.rule === ROUTED_RULE) { days.push(cached); onDay?.(day, cached.transactions, true); continue; }
    const perHour = new Array<number>(24).fill(0);
    const routed: RoutedDay["routed"] = [];
    const seen = new Set<string>();
    // a day's 24 hours are read in parallel: launch days hold hundreds of thousands of transactions
    await mapConcurrent([...Array(24).keys()], rpcParallelism(), async (h) => {
      const fromSec = Math.max(from, t + h * 3600), toSec = t + (h + 1) * 3600;
      if (fromSec >= toSec || fromSec > Date.now() / 1000) return; // an hour that hasn't started yet: nothing to read
      for await (const page of transactionPages(ADDR.ALLINU_DKNG_POOL, { fromSec, toSec, oldestFirst: true })) {
        for (const tx of page) {
          const signature = tx.transaction.signatures[0] ?? "";
          if (seen.has(signature)) continue; // a transaction exactly on an hour's edge is read once
          seen.add(signature);
          perHour[h]!++;
          const dkng = routedDkng(tx, vault);
          if (dkng > 0) routed.push([signature, tx.blockTime, Number(dkng.toFixed(6))]);
        }
        read += page.length;
        if (read > maxTransactions) throw new Error(`routed volume: stopped after ${read} transactions (limit ${maxTransactions}); finished days are saved`);
      }
    });
    const result: RoutedDay = { rule: ROUTED_RULE, day, transactions: sum(perHour), perHour, routed: routed.sort((a, b) => a[1] - b[1]) };
    if (settled) cache.save(result);
    days.push(result);
    onDay?.(day, result.transactions, false);
  }

  const prices = cache.loadPrices() ?? {};
  const lastHour = Math.floor(Date.now() / 3_600_000) * 3600;
  if (!prices[String(lastHour - 3600)] || !prices[String(Math.floor(from / 3600) * 3600)]) {
    Object.assign(prices, await hourlyDkngPrice(pools, from));
    cache.savePrices(prices);
  }
  const priceAt = (time: number) => {
    // the candle for the hour the trade fell in, or the nearest earlier one
    for (let h = Math.floor(time / 3600) * 3600; h > time - 86400 * 3; h -= 3600) { const p = prices[String(h)]; if (p) return p; }
    throw new Error(`no DKNG price near ${new Date(time * 1000).toISOString()}`);
  };
  let routedUsd = 0, routedTxs = 0;
  let routedClosedUsd = 0; // while Nasdaq was closed, split by hour exactly as the volume block splits pool volume
  const daily = days.map((d) => {
    let usd = 0;
    for (const [, time, dkng] of d.routed) {
      const value = dkng * priceAt(time);
      usd += value;
      routedClosedUsd += value * (1 - nasdaqOpenShare(Math.floor(time / 3600) * 3600));
      routedTxs++;
    }
    routedUsd += usd;
    return { d: d.day, usd: Math.round(usd) };
  });
  return {
    sources: [
      `Solana RPC: getTransactionsForAddress (the ALLINU/DKNG pool), DKNG balance changes outside its vault ${vault}`,
      `${GECKO}/pools/{the largest other DKNG pool}/ohlcv/hour (hourly DKNG price)`,
    ],
    from: volume.allinuFrom,
    transactions: sum(days.map((d) => d.transactions)),
    routedTransactions: routedTxs,
    routedUsd,
    allinuPoolUsd: volume.allinu,
    total: volume.total,
    share: (volume.allinu + routedUsd) / volume.total, // ALLINU pool + its routed legs, of all DKNG volume
    routedClosedUsd,
    // the same, counting only the hours Nasdaq was closed (null with a volume block from before it had closed totals)
    shareWhileClosed: volume.closedSinceAllinu ? (volume.closedAllinu + routedClosedUsd) / volume.closedSinceAllinu : null,
    daily, // routed dollars per UTC day
  };
}
export type RoutedVolume = Awaited<ReturnType<typeof getRoutedVolume>>;
