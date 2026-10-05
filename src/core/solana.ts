// A minimal Solana RPC client: just the calls and byte parsing the stats need, no libraries.

import { HttpError, getJSON, pacer, sleep, type Pacer } from "./http.ts";

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// ---------- endpoints ----------
//
// Free, keyless Solana mainnet endpoints, tested on 2026-10-02 for the calls this project makes.
// Calls rotate across them, each endpoint paced on its own, so no single one is pushed past its limit.
//
// Only the Solana Foundation endpoints keep full history for listing an address's transactions and for
// the token-account calls. The others answer a transaction listing with just the last day or two and
// no error, which would silently cut the numbers short, so they only serve calls that can't be
// truncated that way: fetching one transaction by its signature, or reading one account. Even then,
// a node without old history either says so (Pocket: "history is not available from this node", so
// the call moves to another endpoint) or answers "not found" (PublicNode), which is why a "not found"
// transaction is only believed when a full-history endpoint says so.
export interface PublicRpc {
  name: string;
  url: string;
  /** null = every method this project uses */
  methods: readonly string[] | null;
  /** starting gap between calls, ms (it widens on 429s) */
  gapMs: number;
}

const BY_SIGNATURE = ["getTransaction", "getAccountInfo"];
export const PUBLIC_RPCS: readonly PublicRpc[] = [
  { name: "Solana Foundation", url: "https://api.mainnet-beta.solana.com", methods: null, gapMs: 250 },
  { name: "Solana Foundation (api.mainnet)", url: "https://api.mainnet.solana.com", methods: null, gapMs: 250 },
  { name: "Pocket Network", url: "https://solana.api.pocket.network", methods: BY_SIGNATURE, gapMs: 250 },
  { name: "Solana Vibe Station", url: "https://public.rpc.solanavibestation.com", methods: BY_SIGNATURE, gapMs: 1000 },
  { name: "PublicNode", url: "https://solana-rpc.publicnode.com", methods: BY_SIGNATURE, gapMs: 250 },
  { name: "Tatum", url: "https://solana-mainnet.gateway.tatum.io", methods: BY_SIGNATURE, gapMs: 12_000 },
];

interface Endpoint extends PublicRpc {
  pace: Pacer;
  restUntil: number; // ms since epoch: skip this endpoint until then
  strikes: number; // consecutive failures, for the back-off
  refuses: Set<string>; // methods it answered with "not available on the free tier" or similar
  tally: { ok: number; limited: number; failed: number };
}

const toEndpoint = (r: PublicRpc): Endpoint => ({ ...r, pace: pacer(r.gapMs), restUntil: 0, strikes: 0, refuses: new Set(), tally: { ok: 0, limited: 0, failed: 0 } });
let endpoints: Endpoint[] = PUBLIC_RPCS.map(toEndpoint);
let parallelism = endpoints.length; // the public rotation: one call in flight per endpoint

/**
 * Send every call to one endpoint instead (any Solana RPC: the chain data is the same, only speed differs).
 * `gapMs` spaces the calls (20 ms ≈ 50 requests a second); `concurrent` is how many may be in flight at once.
 */
export function useRpc(url: string, gapMs = 100, concurrent = 8) {
  endpoints = [toEndpoint({ name: "Solana RPC", url, methods: null, gapMs: Math.max(0, gapMs) })];
  parallelism = Math.max(1, Math.floor(concurrent) || 1);
}

/** Per-endpoint counts of answered, rate-limited and failed calls, for the run log. */
export const rpcTally = () => endpoints.map((e) => ({ name: e.name, ...e.tally, refuses: [...e.refuses] }));

/** How many calls are worth running at once. */
export const rpcParallelism = () => parallelism;

const serves = (e: Endpoint, method: string) => (e.methods === null || e.methods.includes(method)) && !e.refuses.has(method);

/** The endpoint that can take this call soonest, preferring ones not in `avoid`. */
function choose(method: string, avoid: Set<Endpoint>): Endpoint {
  const able = endpoints.filter((e) => serves(e, method));
  if (!able.length) throw new Error(`${method}: no endpoint serves it`);
  const fresh = able.filter((e) => !avoid.has(e));
  const readyAt = (e: Endpoint) => Math.max(e.restUntil, e.pace.readyAt());
  return (fresh.length ? fresh : able).reduce((best, e) => (readyAt(e) < readyAt(best) ? e : best));
}

/** Skip this endpoint for a while (longer after each failure in a row) and space its calls further apart. */
function rest(e: Endpoint) {
  e.strikes++;
  e.restUntil = Date.now() + Math.min(60_000, 1000 * 2 ** e.strikes);
  e.pace.slowDown();
}

const RATE_LIMITED = /too many|rate limit|exceeded/i;
const NOT_ON_THIS_NODE = /history is not available|not available from this node/i; // try another endpoint, keep this one
const REFUSED = /not available|personal token|excluded|free plan|upgrade|not supported on/i;

/** An RPC error that every endpoint would give (bad parameters, or the same error from two endpoints): don't rotate, fail. */
export class RpcCallError extends Error {}

interface RpcReply<T> {
  result?: T;
  error?: { code: number; message: string };
}

const post = (method: string, params: unknown[]) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
});

/**
 * One JSON-RPC call, rotated across the endpoints. Rate limits and outages move the call to another
 * endpoint; an endpoint that refuses a method is not asked for it again.
 * `confirmNull`: a "not found" answer is believed only from a full-history endpoint (a mirror can lag
 * the chain by a few seconds or have pruned old history, and then answers "not found").
 */
export async function rpc<T>(method: string, params: unknown[], { confirmNull = false } = {}): Promise<T> {
  const init = post(method, params);
  const asked = new Set<Endpoint>();
  const errorsSeen = new Map<string, Set<Endpoint>>(); // error message → endpoints that returned it
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt++) {
    const e = choose(method, asked);
    asked.add(e);
    const wait = e.restUntil - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const reply = await getJSON<RpcReply<T>>(e.url, { init, pace: e.pace, label: e.name, retries: 0 });
      if (reply.error) {
        const msg = reply.error.message;
        lastError = new Error(`${e.name}: ${msg}`);
        if (NOT_ON_THIS_NODE.test(msg)) { e.tally.failed++; continue; }
        if (RATE_LIMITED.test(msg)) { e.tally.limited++; rest(e); continue; }
        if (REFUSED.test(msg)) { e.refuses.add(method); continue; }
        // Bad parameters are our mistake: every endpoint would say the same. Any other error is believed only
        // once two different endpoints return it; one relay saying "invalid response from upstream" is not.
        const seenBy = errorsSeen.get(msg) ?? new Set<Endpoint>();
        seenBy.add(e);
        errorsSeen.set(msg, seenBy);
        if (reply.error.code === -32602 || seenBy.size >= 2) throw new RpcCallError(`${method}: ${msg}`);
        e.tally.failed++;
        continue;
      }
      e.strikes = 0;
      e.tally.ok++;
      // a mirror can be a few seconds behind or missing old history: only a full-history endpoint's "not found" counts
      if (!("result" in reply)) { lastError = new Error(`${e.name}: a reply with neither result nor error`); e.tally.failed++; continue; }
      if (reply.result == null && confirmNull && e.methods !== null && endpoints.some((x) => x.methods === null && serves(x, method))) continue;
      return reply.result as T;
    } catch (err) {
      if (err instanceof RpcCallError) throw err;
      lastError = err;
      if (err instanceof HttpError && [401, 402, 403].includes(err.status)) {
        // this endpoint won't serve this method (in a browser, the Foundation endpoints answer 403 to everything)
        e.tally.failed++;
        e.refuses.add(method);
      } else {
        if (err instanceof HttpError && err.status === 429) e.tally.limited++;
        else e.tally.failed++; // 5xx, timeouts, network errors
        rest(e);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${method}: no endpoint answered`);
}

// ---------- the shapes we read (only the fields we use) ----------

export interface SignatureInfo {
  signature: string;
  blockTime: number | null; // null for some very old transactions
  err: unknown;
}

export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export interface ParsedInstruction {
  programId: string;
  parsed?: {
    type: string;
    info: { mint?: string; amount?: string; tokenAmount?: { amount: string } };
  };
}

export interface Transaction {
  blockTime: number;
  meta: {
    preTokenBalances: TokenBalance[];
    postTokenBalances: TokenBalance[];
    innerInstructions?: { instructions: ParsedInstruction[] }[];
  };
  transaction: {
    signatures: string[];
    message: {
      accountKeys: { pubkey: string; signer: boolean }[];
      instructions: ParsedInstruction[];
    };
  };
}

interface TokenAccountsReply {
  value: { pubkey: string; account: { data: [string, string] } }[];
}

// ---------- calls ----------

export const getTransaction = (signature: string) =>
  rpc<Transaction | null>("getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }], { confirmNull: true });

/** Every successful transaction that touched `address` since `fromSec` (unix seconds), newest first.
 *  At most `max` signatures (the newest ones). */
export async function signaturesSince(address: string, fromSec: number, max = Infinity): Promise<SignatureInfo[]> {
  const out: SignatureInfo[] = [];
  let before: string | undefined;
  while (out.length < max) {
    const page = await rpc<SignatureInfo[]>("getSignaturesForAddress", [address, { limit: 1000, ...(before ? { before } : {}) }]);
    out.push(...page.filter((s) => !s.err && s.blockTime != null && s.blockTime >= fromSec));
    const oldest = page.at(-1);
    if (!oldest || page.length < 1000 || (oldest.blockTime != null && oldest.blockTime < fromSec)) break;
    before = oldest.signature;
  }
  return out.slice(0, max);
}

// ---------- whole transactions, 100 per call: getTransactionsForAddress ----------
//
// Several RPC providers answer getTransactionsForAddress: an address's
// transactions in full, up to 100 per call, where the standard route takes one getSignaturesForAddress page
// plus one getTransaction per signature. It isn't part of the standard Solana API and the public endpoints
// don't have it, so it is used only when the endpoint set with useRpc answers it.

let pagedHistory: Promise<boolean> | undefined;

/** Whether the RPC answers getTransactionsForAddress (asked once, with one small call). */
export function hasTransactionsForAddress(): Promise<boolean> {
  pagedHistory ??= (async () => {
    const e = endpoints[0];
    if (endpoints.length !== 1 || !e) return false;
    try {
      const reply = await getJSON<RpcReply<{ data?: unknown }>>(e.url, { init: post("getTransactionsForAddress", [TOKEN_PROGRAM, { limit: 1 }]), pace: e.pace, label: e.name });
      return Array.isArray(reply.result?.data);
    } catch {
      return false;
    }
  })();
  return pagedHistory;
}

export interface HistoryWindow {
  fromSec?: number; // unix seconds, inclusive
  toSec?: number; // unix seconds, exclusive
  oldestFirst?: boolean;
  max?: number;
}

/** Successful transactions that touched `address` within the window, in full, a page (up to 100) at a time. */
export async function* transactionPages(address: string, { fromSec = 0, toSec = Infinity, oldestFirst = false, max = Infinity }: HistoryWindow = {}): AsyncGenerator<Transaction[]> {
  // the filter takes whole seconds
  const blockTime = { ...(fromSec > 0 ? { gte: Math.ceil(fromSec) } : {}), ...(Number.isFinite(toSec) ? { lt: Math.ceil(toSec) } : {}) };
  let paginationToken: string | undefined;
  let count = 0;
  while (count < max) {
    const page = await rpc<{ data: Transaction[]; paginationToken: string | null }>("getTransactionsForAddress", [address, {
      transactionDetails: "full",
      encoding: "jsonParsed",
      maxSupportedTransactionVersion: 1,
      sortOrder: oldestFirst ? "asc" : "desc",
      limit: Math.min(100, max - count),
      filters: { status: "succeeded", ...(Object.keys(blockTime).length ? { blockTime } : {}) },
      ...(paginationToken ? { paginationToken } : {}),
    }]);
    // a filtered page can come back empty mid-history: only a missing (or repeated) token ends the walk
    if (page.data.length) yield page.data;
    count += page.data.length;
    if (!page.paginationToken || page.paginationToken === paginationToken) return;
    paginationToken = page.paginationToken;
  }
}

/** A wallet's token accounts for one mint, largest balance first. */
export async function tokenAccountsFor(owner: string, mint: string): Promise<string[]> {
  const reply = await rpc<TokenAccountsReply>("getTokenAccountsByOwner", [owner, { mint }, { encoding: "base64", dataSlice: { offset: 64, length: 8 } }]);
  return reply.value
    .map((a) => ({ pubkey: a.pubkey, amount: readU64(fromBase64(a.account.data[0]), 0) }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    .map((a) => a.pubkey);
}

/** Mints of every token the wallet holds a non-zero balance of (both token programs). */
export async function mintsHeld(owner: string): Promise<Set<string>> {
  const held = new Set<string>();
  for (const programId of [TOKEN_2022_PROGRAM, TOKEN_PROGRAM]) {
    // a token account stores its mint at bytes 0–32 and its amount at bytes 64–72: read just those
    const reply = await rpc<TokenAccountsReply>("getTokenAccountsByOwner", [owner, { programId }, { encoding: "base64", dataSlice: { offset: 0, length: 72 } }]);
    for (const a of reply.value) {
      const bytes = fromBase64(a.account.data[0]);
      if (readU64(bytes, 64) > 0n) held.add(base58(bytes.subarray(0, 32)));
    }
  }
  return held;
}

/** How each wallet's balance of `mint` changed in a transaction, in raw units (owner → change). */
export function balanceChanges(tx: Transaction, mint: string): Map<string, bigint> {
  const change = new Map<string, bigint>();
  const add = (b: TokenBalance, sign: bigint) => {
    if (b.mint !== mint || !b.owner) return;
    change.set(b.owner, (change.get(b.owner) ?? 0n) + sign * BigInt(b.uiTokenAmount.amount));
  };
  for (const b of tx.meta.preTokenBalances) add(b, -1n);
  for (const b of tx.meta.postTokenBalances) add(b, 1n);
  return change;
}

/** Every instruction in a transaction, top-level and inner (instructions called by programs). */
export const allInstructions = (tx: Transaction): ParsedInstruction[] => [
  ...tx.transaction.message.instructions,
  ...(tx.meta.innerInstructions ?? []).flatMap((x) => x.instructions),
];

// ---------- bytes ----------

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) {
    s = BASE58_ALPHABET[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
}

export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Little-endian unsigned 64-bit integer at `offset`. */
export function readU64(bytes: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = v * 256n + BigInt(bytes[offset + i] ?? 0);
  return v;
}
