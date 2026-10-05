// What every block shares: the addresses, the GeckoTerminal client, small number and date helpers, and the
// two ways of reading an address's transactions.

import { getJSON, mapConcurrent, pacer, sleep } from "../http.ts";
import { base58, fromBase64, getTransaction, hasTransactionsForAddress, rpc, rpcParallelism, signaturesSince, transactionPages, type HistoryWindow, type Transaction } from "../solana.ts";

export const ADDR = {
  DKNG: "DKNGQFNGQmoBdXSRGKJ8tTu7uPDasw5JDcfMmWniNfow", // tokenized DraftKings, issued by Backpack Securities
  ALLINU: "4MMQY9bwkxxTtsK3W227Q5ABT6yFY8Pmn9Ze7wmAXKY8",
  ALLINU_DKNG_POOL: "5752ia7jC3ZU1c8ycytaSyi5D4nVhApSKvreGbs7pwWL", // Raydium CPMM
  FEE_SELLER: "5KXDF6QnqhBj72hDtJNkkpFaQVUfbFXNybMsp3DiK6tD", // StonkFun: swaps collected fees into the reward token
  PAYOUT_WALLET: "HuBMeYW3aDn8BH65fo8xxbP4oiexyup8udzKyccgi8Ga", // StonkFun: sends DKNG rewards (since Sep 22)
} as const;

/** Tokenized DKNG's first trading day on Solana. */
export const SINCE = "2026-09-11T00:00:00Z";

const DKNG_DECIMALS = 6;
export const toDkng = (raw: bigint) => Number(raw) / 10 ** DKNG_DECIMALS;

export const GECKO = "https://api.geckoterminal.com/api/v2/networks/solana";
const geckoPace = pacer(2200); // GeckoTerminal's free tier allows ~30 calls a minute
export const gecko = <T>(path: string) => getJSON<T>(GECKO + path, { init: { headers: { accept: "application/json" } }, pace: geckoPace });

export const utcDay = (sec: number) => new Date(sec * 1000).toISOString().slice(0, 10);
/** The list a response must carry. A missing one is an error, never an empty list: that would count as zero. */
export function listIn<T>(list: T[] | undefined, what: string): T[] {
  if (!Array.isArray(list)) throw new Error(`${what}: unexpected response (no list where one was expected)`);
  return list;
}
export const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export type Progress = (done: number, total: number) => void;

/**
 * Fetches every transaction, in parallel across the endpoints, and hands each one to `handle`. Anything a
 * busy or flaky endpoint dropped gets a second, slower pass. Whatever is still unreadable is counted,
 * never silently skipped: more than 1% fails the run.
 */
async function forEachTransaction(what: string, signatures: string[], handle: (tx: Transaction) => void, onProgress?: Progress) {
  const reasons = new Map<string, number>();
  const read = async (signature: string) => {
    try {
      const tx = await getTransaction(signature);
      if (tx) { handle(tx); return true; }
      reasons.set("not found", (reasons.get("not found") ?? 0) + 1);
    } catch (err) {
      const reason = (err as Error).message.slice(0, 100);
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    return false;
  };
  const failed: string[] = [];
  let done = 0;
  await mapConcurrent(signatures, rpcParallelism(), async (signature) => {
    if (!(await read(signature))) failed.push(signature);
    onProgress?.(++done, signatures.length);
  });
  let unreadable = 0;
  if (failed.length) {
    await sleep(10_000);
    reasons.clear();
    await mapConcurrent(failed, 2, async (signature) => { if (!(await read(signature))) unreadable++; });
  }
  if (unreadable > Math.max(2, signatures.length * 0.01)) {
    const why = [...reasons].map(([r, n]) => `${n}× ${r}`).join("; ");
    throw new Error(`${what}: ${unreadable} of ${signatures.length} transactions unreadable after a retry (${why}); re-run later`);
  }
  return unreadable;
}

/** How the transactions were read, for each block's `source` line. */
export const historyRoute = async () =>
  (await hasTransactionsForAddress()) ? "getTransactionsForAddress (100 whole transactions per call)" : "getSignaturesForAddress → getTransaction (each)";

/**
 * Hands every successful transaction that touched any of `addresses` since `fromSec` to `handle`, once each.
 * With an RPC that answers getTransactionsForAddress, transactions arrive whole, 100 per call, the time span
 * cut into days that are read in parallel. Otherwise each signature is listed and its transaction fetched on
 * its own (forEachTransaction above). Either way `handle` sees transactions in no particular order.
 */
export async function forEachTransactionOf(what: string, addresses: string[], fromSec: number, handle: (tx: Transaction) => void, onProgress?: Progress) {
  if (!(await hasTransactionsForAddress())) {
    const signatures = new Set<string>();
    for (const address of addresses) for (const s of await signaturesSince(address, fromSec)) signatures.add(s.signature);
    return { read: signatures.size, unreadable: await forEachTransaction(what, [...signatures], handle, onProgress) };
  }
  const days: (HistoryWindow & { address: string })[] = [];
  for (const address of addresses) {
    const first = (await transactionPages(address, { fromSec, oldestFirst: true, max: 1 }).next()).value?.[0];
    if (!first) continue;
    const now = Date.now() / 1000;
    for (let t = first.blockTime; t < now; t += 86400) days.push({ address, fromSec: t, toSec: t + 86400 < now ? t + 86400 : Infinity });
  }
  const seen = new Set<string>(); // a transaction can touch more than one of the addresses
  await mapConcurrent(days, rpcParallelism(), async (day) => {
    for await (const page of transactionPages(day.address, day)) {
      for (const tx of page) {
        const signature = tx.transaction.signatures[0] ?? "";
        if (seen.has(signature)) continue;
        seen.add(signature);
        handle(tx);
        onProgress?.(seen.size, 0);
      }
    }
  });
  return { read: seen.size, unreadable: 0 };
}

export type Candle = [time: number, open: number, high: number, low: number, close: number, volume: number];

/**
 * A pool's hourly candles from GeckoTerminal back to `fromSec`, in USD. One call returns up to 1,000 (~41 days),
 * so it pages back until `fromSec` is covered. `query` adds options, e.g. `&token=<mint>` for that token's price.
 */
export async function geckoHourlyCandles(pool: string, fromSec: number, query = ""): Promise<Candle[]> {
  const byTime = new Map<number, Candle>(); // keyed by hour: pages may share their boundary candle
  for (let before = ""; ; ) {
    const r = await gecko<{ data?: { attributes?: { ohlcv_list?: Candle[] } } }>(`/pools/${pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd${query}${before}`);
    const page = listIn(r.data?.attributes?.ohlcv_list, `GeckoTerminal candles for ${pool}`);
    for (const c of page) byTime.set(c[0], c);
    const oldest = Math.min(...page.map((c) => c[0]));
    if (page.length < 1000 || oldest <= fromSec) break;
    before = `&before_timestamp=${oldest}`;
  }
  return [...byTime.values()];
}

const RAYDIUM_CPMM = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C";

/** The ALLINU pool's DKNG vault, read from the Raydium CPMM pool account (token0/1 vault at bytes 72/104, mints at 168/200). */
export async function allinuPoolDkngVault(): Promise<string> {
  const reply = await rpc<{ value: { owner: string; data: [string, string] } }>("getAccountInfo", [ADDR.ALLINU_DKNG_POOL, { encoding: "base64" }]);
  if (reply.value.owner !== RAYDIUM_CPMM) throw new Error("ALLINU/DKNG pool is no longer a Raydium CPMM pool");
  const b = fromBase64(reply.value.data[0]);
  const key = (offset: number) => base58(b.subarray(offset, offset + 32));
  if (key(200) === ADDR.DKNG) return key(104);
  if (key(168) === ADDR.DKNG) return key(72);
  throw new Error("DKNG is not one of the ALLINU pool's tokens");
}
