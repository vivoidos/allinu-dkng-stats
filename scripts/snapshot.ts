// Computes every number with src/core/stats/ and writes snapshots/snapshot.json (+ snapshots/holder-origins.csv).
//
//   node scripts/snapshot.ts                     everything except the slow blocks: origins, reach and routed
//   node scripts/snapshot.ts --only supply       one block, or several (--only volume,pools); the rest of
//                                                snapshot.json is kept
//   node scripts/snapshot.ts --skip volume       everything except the listed blocks
//   node scripts/snapshot.ts --with origins      also how every DKNG holder first got DKNG (new wallets only;
//                                                the ones traced before are kept in snapshots/cache/)
//   node scripts/snapshot.ts --with reach        also every wallet ever paid (~50,000 transactions)
//   node scripts/snapshot.ts --with routed       also the DKNG volume ALLINU trades route through other pools
//                                                (every ALLINU-pool transaction, over a million; needs an RPC with
//                                                getTransactionsForAddress; finished days are kept in snapshots/cache/)
//   SOLANA_RPC_URL=<any Solana RPC> node scripts/snapshot.ts …   same chain data from one faster endpoint
//   BIRDEYE_API_KEY=<key> node scripts/snapshot.ts …            hourly pool volume from Birdeye (same numbers, no wait)
//     (or put it in a .env file at the repo root). Without it, calls rotate across free public endpoints.
//     SOLANA_RPC_GAP_MS (default 100) spaces its calls and SOLANA_RPC_CONCURRENCY (default 8) runs that many
//     at once: for a 50 requests/second plan, SOLANA_RPC_GAP_MS=22 SOLANA_RPC_CONCURRENCY=12
//     If that endpoint answers getTransactionsForAddress (several RPC providers do), transactions are
//     read 100 per call instead of one by one.
//
// How long: on the free endpoints about an hour for the default blocks. With an RPC that serves getTransactionsForAddress
// and a Birdeye key, a few minutes; the first full holder trace and the first full routed read take ~35 and ~20 min,
// and later runs only read what is new (snapshots/cache/).
//
// Blocks: rewards, holders, pools, payoutPace, supply, volume, origins, reach, routed
// Needs Node 22.18+ (runs TypeScript directly). No install, no keys. Run it in a terminal or on a server:
// the public Solana RPC refuses requests that come from a browser.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { originsCache, routedCache } from "../src/core/cache.ts";
import { PUBLIC_RPCS, rpcTally, useRpc } from "../src/core/solana.ts";
import * as S from "../src/core/stats/index.ts";

const BLOCKS = ["rewards", "holders", "pools", "payoutPace", "supply", "volume", "origins", "reach", "routed"] as const;
type Block = (typeof BLOCKS)[number];
const SLOW: Block[] = ["origins", "reach", "routed"]; // opt in with --with
const DEFAULT: Block[] = BLOCKS.filter((b) => !SLOW.includes(b));

function flag(name: string): Block[] | null {
  const i = process.argv.indexOf(name);
  if (i < 0) return null;
  const list = (process.argv[i + 1] ?? "").split(",").filter(Boolean);
  const unknown = list.filter((b) => !(BLOCKS as readonly string[]).includes(b));
  if (unknown.length) throw new Error(`unknown block(s): ${unknown.join(", ")}; blocks are ${BLOCKS.join(", ")}`);
  return list as Block[];
}
const skip = new Set(flag("--skip") ?? []);
const run = new Set(flag("--only") ?? [...DEFAULT, ...(flag("--with") ?? [])].filter((b) => !skip.has(b)));
// Optional settings from a local .env file (never committed): SOLANA_RPC_URL and friends.
const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const { SOLANA_RPC_URL, SOLANA_RPC_GAP_MS, SOLANA_RPC_CONCURRENCY } = process.env;
if (SOLANA_RPC_URL) useRpc(SOLANA_RPC_URL, Number(SOLANA_RPC_GAP_MS) || 100, Number(SOLANA_RPC_CONCURRENCY) || 8);
if (process.env.BIRDEYE_API_KEY) S.useBirdeye(process.env.BIRDEYE_API_KEY); // hourly pool volume without GeckoTerminal's wait

// Keys never reach the log or the snapshot files. GitHub Actions masks a secret's exact value only, so a provider
// error that echoes just the key inside SOLANA_RPC_URL would show: each key-like part is masked on its own too,
// and scrubbed from everything this script prints or writes.
function secretParts(): string[] {
  const parts = new Set<string>();
  if (SOLANA_RPC_URL) {
    parts.add(SOLANA_RPC_URL);
    try {
      const url = new URL(SOLANA_RPC_URL);
      for (const value of url.searchParams.values()) if (value.length >= 8) parts.add(value);
      for (const segment of url.pathname.split("/")) if (segment.length >= 16) parts.add(segment);
      for (const credential of [url.username, url.password]) if (credential) parts.add(credential);
    } catch { /* not a parseable URL: the whole value is still covered */ }
  }
  if (process.env.BIRDEYE_API_KEY) parts.add(process.env.BIRDEYE_API_KEY);
  return [...parts].sort((a, b) => b.length - a.length); // longest first, so a part inside another is scrubbed with it
}
const secrets = secretParts();
if (process.env.GITHUB_ACTIONS) for (const part of secrets) console.log(`::add-mask::${part}`);
const redact = (text: string) => secrets.reduce((out, part) => out.split(part).join("[redacted]"), text);

const started = Date.now();
const log = (msg: string) => console.log(redact(`[${Math.round((Date.now() - started) / 1000)}s] ${msg}`));
const progress = (every: number, label: string): S.Progress => (i, n) => { if (i % every === 0 || i === n) log(n ? `${label} ${i}/${n}` : `${label} ${i}`); };
const stamp = <T>(value: T): S.Stamped<T> => ({ ...value, computedAt: new Date().toISOString() });

/** Written to a temporary file first and renamed into place: a run that stops halfway never leaves a cut-off file. */
const writeAtomic = (url: URL, text: string) => {
  const tmp = new URL(`${url.href}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, url);
};
const file = new URL("../snapshots/snapshot.json", import.meta.url);
const readSnapshot = (): Partial<S.Snapshot> => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
const out: Partial<S.Snapshot> = {};
log(`blocks: ${[...run].join(", ")}`);

// A block that fails keeps its previous numbers, so one slow or broken block never loses the others.
const failed: string[] = [];
const attempt = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); } catch (e) {
    failed.push(name);
    const why = redact(e instanceof Error ? e.message : String(e));
    log(`${name} FAILED, keeping its previous numbers: ${why}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=${name} failed::${why}`);
  }
};

let rewards = readSnapshot().rewards;
if (run.has("rewards") || (run.has("origins") && !rewards)) await attempt("rewards", async () => {
  rewards = out.rewards = stamp(await S.getRewards());
  log("rewards");
});

let holders: S.Holders | undefined;
if (run.has("holders") || run.has("origins")) await attempt("holders", async () => {
  holders = await S.getHolders();
  const { list, ...count } = holders;
  out.holders = stamp(count);
  log(`holders: ${count.holders}`);
});

let pools: S.Pools | undefined;
if (run.has("pools") || run.has("volume") || run.has("routed")) await attempt("pools", async () => {
  pools = await S.getPools();
  const { all, ...summary } = pools;
  out.pools = stamp(summary);
  log(`pools: ${summary.count}`);
});

// Volume only calls GeckoTerminal and the rest only call Solana, so the two run side by side.
const geckoTerminal = async () => {
  if (run.has("volume") && pools) await attempt("volume", async () => {
    out.volume = stamp(await S.getVolume({ pools: pools!.all, onProgress: progress(10, "volume") }));
    log("volume");
  });
};
const solana = async () => {
  if (run.has("payoutPace")) await attempt("payoutPace", async () => {
    const since = new Date(Date.now() - 2 * 86400e3).toISOString();
    const pace = out.payoutPace = stamp(await S.getPayoutFlow({ since, wallets: [S.ADDR.PAYOUT_WALLET], onProgress: progress(250, "payout pace") }));
    log(`payout pace: ${Math.round(pace.paymentsPerDay)} payments a day`);
  });
  if (run.has("supply")) await attempt("supply", async () => {
    const supply = out.supply = stamp(await S.getSupply({ onProgress: progress(250, "supply") }));
    log(`supply: ${supply.supplyNow} DKNG (walk-back start ${supply.startSupply}, should be near 0)`);
  });
};
await Promise.all([geckoTerminal(), solana()]);

let traced: S.TracedHolder[] | undefined;
if (run.has("origins") && holders && rewards) await attempt("origins", async () => {
  const { rows, ...summary } = await S.getHolderOrigins({ holders: holders!.list, rewards: rewards!, cache: originsCache, onProgress: progress(1000, "origins") });
  traced = rows;
  out.origins = stamp(summary);
  log(`origins: ${summary.traced} wallets traced, ${summary.reused} from earlier runs, ${summary.errors} RPC errors`);
});

if (run.has("reach")) await attempt("reach", async () => {
  const reach = out.reach = stamp(await S.getPayoutFlow({ onProgress: progress(2000, "reach") }));
  log(`reach: ${reach.uniqueRecipients} wallets`);
});

const n = (v: number) => Math.round(v).toLocaleString("en-US");
if (run.has("routed") && pools) await attempt("routed", async () => {
  const volume = out.volume ?? readSnapshot().volume;
  if (!volume?.allinuFrom) throw new Error("routed needs the volume block: run it first (or in the same run)");
  const days = process.env.ROUTED_DAYS?.split(",").filter(Boolean); // e.g. ROUTED_DAYS=2026-09-20 for a trial
  const routed = stamp(await S.getRoutedVolume({ volume, pools: pools!.all, cache: routedCache, onlyDays: days, maxTransactions: Number(process.env.ROUTED_MAX_TRANSACTIONS) || 2_000_000,
    onDay: (day, txs, cached) => log(`routed: ${day} ${cached ? "from cache" : "read"}, ${n(txs)} transactions`) }));
  log(`routed: ${n(routed.transactions)} ALLINU-pool transactions, ${n(routed.routedUsd)} routed through other pools`);
  if (days) log("routed: a trial run covers only ROUTED_DAYS, so snapshot.json keeps its routed block");
  else out.routed = routed;
});

// Re-read right before writing, so two runs of different blocks don't overwrite each other.
// On GitHub Actions, record which run this was: its public log shows this exact code producing these numbers.
const { GITHUB_ACTIONS, GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SHA } = process.env;
const actionsRun = GITHUB_ACTIONS && GITHUB_SHA
  ? { log: `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`, repo: `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}`, commit: GITHUB_SHA }
  : null;
const solanaRpc = SOLANA_RPC_URL ? ["a private endpoint (SOLANA_RPC_URL)"] : PUBLIC_RPCS.map((r) => r.url);
const { by: _by, code: _code, ...previous } = readSnapshot() as Partial<S.Snapshot> & { by?: unknown; code?: unknown }; // dropped fields
if (previous.origins && "viaAllinu" in previous.origins) delete (previous.origins as { viaAllinu?: unknown }).viaAllinu; // an estimate older code made
const fresh = Object.keys(out).length > 0; // a run where every block failed leaves the snapshot's run and time as they were
writeAtomic(file, redact(JSON.stringify({ ...previous, ...out, ...(fresh ? { solanaRpc, run: actionsRun, computedAt: new Date().toISOString() } : {}) }, null, 1)) + "\n");
if (failed.length) log(`done, but these blocks FAILED and kept their previous numbers: ${failed.join(", ")}`);

if (traced) {
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "wallet,dkng_balance,first_dkng_inflow,first_inflow_time,first_inflow_tx,airdrop_check,note";
  const lines = traced.map((r) => [r.owner, r.dkng, r.origin, r.firstTime, r.firstTx && `https://solscan.io/tx/${r.firstTx}`, r.airdropCheck, r.note].map(cell).join(","));
  writeAtomic(new URL("../snapshots/holder-origins.csv", import.meta.url), redact([header, ...lines].join("\n")) + "\n");
}
log(`wrote snapshot.json (${Object.keys(out).join(", ")})${traced ? ` and holder-origins.csv (${traced.length} wallets)` : ""}`);
// The headline numbers, printed so the run's log shows them next to the code that produced them.
const done = { ...readSnapshot() } as Partial<S.Snapshot>;
const carried = (block: keyof S.Snapshot) => (block in out ? "" : " (carried over from an earlier run)");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const r = done.rewards, p = done.payoutPace, sup = done.supply, v = done.volume, o = done.origins;
if (r) log(`RESULT rewards: ${n(r.dkngPaid)} DKNG paid to ALLINU holders = $${n(r.usdAtTodaysPrice)} at $${r.dkngPrice.toFixed(2)}; ALLINU is ${pct(r.shareOfAllDkngPayouts)} of DKNG reward payments (${pct(r.shareOfAllDkngPaid)} by amount)${carried("rewards")}`);
if (done.holders) log(`RESULT holders: ${n(done.holders.holders)} wallets hold DKNG on Solana${carried("holders")}`);
if (done.pools) log(`RESULT pools: ALLINU/DKNG is #${done.pools.allinuRank} of ${done.pools.activeCount} DKNG pools traded in the last 24 h by liquidity ($${n(done.pools.allinuLiquidity)})${carried("pools")}`);
if (p) log(`RESULT payout pace: ~${n(p.paymentsPerDay)} payments and ${n(p.dkngPerDay)} DKNG a day over the last ${p.windowDays} days${carried("payoutPace")}`);
if (sup) log(`RESULT supply: ${n(sup.supplyNow)} DKNG on Solana; ${n(sup.mintedSinceLaunch)} minted and ${n(sup.burnedSinceLaunch)} burned since Sep 11 (walk-back check ${sup.startSupply.toFixed(6)}, should be near 0)${carried("supply")}`);
if (v) log(`RESULT volume: ALLINU pool ${pct(v.share)} of ${n(v.total)} since it opened (${v.allinuFrom}); ${pct(v.closedShareOfAll)} of all DKNG volume since Sep 11 traded while Nasdaq was closed${carried("volume")}`);
if (o) log(`RESULT origins: ${pct(o.shares["Reward airdrop"])} of the ${n(o.size)} DKNG holders first got DKNG as a reward airdrop${carried("origins")}`);
if (done.routed) log(`RESULT routed: ALLINU pool ${n(done.routed.allinuPoolUsd)} + ${n(done.routed.routedUsd)} routed through other DKNG pools = ${pct(done.routed.share)} of ${n(done.routed.total)} DKNG volume${carried("routed")}`);
if (done.reach) log(`RESULT reach: ${n(done.reach.uniqueRecipients)} wallets have received DKNG rewards${carried("reach")}`);
for (const t of rpcTally()) if (t.ok + t.limited + t.failed) log(`  ${t.name}: ${t.ok} answered, ${t.limited} rate-limited, ${t.failed} failed${t.refuses.length ? `, refused ${t.refuses.join(", ")}` : ""}`);
