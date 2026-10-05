// Holder origins: for every wallet holding DKNG, find the first transaction that actually INCREASED its DKNG
// balance (not the one that merely opened its DKNG account: aggregator routes often open the account and pass
// DKNG straight through) and classify how that DKNG arrived.
//
// Airdrop check: an airdrop transaction doesn't say which reward token it pays for, so for every wallet whose
// first DKNG was an airdrop we also look at which DKNG reward tokens it holds when it is traced.
//
// A wallet's first DKNG never changes, so each traced wallet is kept through `cache`: a run traces only wallets
// it hasn't seen (and retries the ones it couldn't resolve), and reports on the wallets holding DKNG today.

import { mapConcurrent } from "../http.ts";
import { balanceChanges, getTransaction, mintsHeld, rpcParallelism, signaturesSince, tokenAccountsFor } from "../solana.ts";
import { ADDR, median, type Progress } from "./shared.ts";
import type { Holders } from "./holders.ts";
import type { Rewards } from "./rewards.ts";

const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "So11111111111111111111111111111111111111112", // wrapped SOL
]);

export const ORIGINS = ["Reward airdrop", "ALLINU trade", "Another memecoin trade", "Bought DKNG directly", "Transfer from another wallet", "Not resolved"] as const;
export type Origin = (typeof ORIGINS)[number];
export const AIRDROP_CHECK = ["Holds ALLINU only", "Holds ALLINU and another DKNG reward token", "Holds another DKNG reward token, not ALLINU", "Holds no DKNG reward token"] as const;
export type AirdropCheck = (typeof AIRDROP_CHECK)[number];

export interface TracedHolder {
  owner: string;
  dkng: number;
  origin: Origin;
  firstTx?: string;
  firstTime?: string;
  airdropCheck?: AirdropCheck;
  note?: string;
}

/** Bump when firstDkngInflow() or airdropCheck() changes: wallets traced under another rule are traced again. */
export const ORIGINS_RULE = 1;

/** A traced wallet as cached: everything about its first DKNG, and when it was traced. */
export type TracedEntry = Omit<TracedHolder, "owner" | "dkng"> & { rule: number; tracedAt: string };
export interface OriginsCache {
  load(): Record<string, TracedEntry> | undefined;
  save(entries: Record<string, TracedEntry>): void;
}

export async function getHolderOrigins({ holders, rewards, cache, onProgress }: { holders: Holders["list"]; rewards: Rewards; cache?: OriginsCache; onProgress?: Progress }) {
  const known = cache?.load() ?? {};
  const rewardMints = new Set(rewards.dkngRewardMints);
  let errors = 0, traced = 0, reused = 0, done = 0, unsaved = 0;
  const rows: TracedHolder[] = [];
  try {
    // wallets are traced in parallel; each wallet's own history is walked in order
    rows.push(...await mapConcurrent(holders, rpcParallelism(), async (h): Promise<TracedHolder> => {
      const hit = known[h.owner];
      if (hit?.rule === ORIGINS_RULE) {
        reused++;
        onProgress?.(++done, holders.length);
        const { rule: _rule, tracedAt: _at, ...entry } = hit;
        return { owner: h.owner, dkng: h.dkng, ...entry };
      }
      let row: TracedHolder;
      let failed = false;
      try {
        row = { owner: h.owner, dkng: h.dkng, ...(await firstDkngInflow(h.owner)) };
      } catch (err) {
        errors++;
        failed = true;
        row = { owner: h.owner, dkng: h.dkng, origin: "Not resolved", note: `RPC error: ${(err as Error).message}` };
      }
      if (row.origin === "Reward airdrop") {
        try {
          row.airdropCheck = await airdropCheck(h.owner, rewardMints);
        } catch (err) {
          errors++;
          failed = true;
          row.note = `airdrop check failed: ${(err as Error).message}`;
        }
      }
      traced++;
      // only a complete answer is kept: anything unresolved is traced again next run
      if (!failed && row.origin !== "Not resolved") {
        const { owner: _owner, dkng: _dkng, ...entry } = row;
        known[h.owner] = { ...entry, rule: ORIGINS_RULE, tracedAt: new Date().toISOString() };
        if (++unsaved >= 500) { cache?.save(known); unsaved = 0; }
      }
      onProgress?.(++done, holders.length);
      return row;
    }));
  } finally {
    cache?.save(known); // a run that stops halfway keeps what it traced
  }
  if (errors > Math.max(3, 0.03 * traced)) throw new Error(`holder trace: ${errors} RPC errors in ${traced} newly traced wallets (rate-limited); re-run later`);

  const n = rows.length;
  const shares = Object.fromEntries(ORIGINS.map((k) => [k, rows.filter((r) => r.origin === k).length / n])) as Record<Origin, number>;
  const checked = rows.filter((r) => r.airdropCheck);
  const count = (k: AirdropCheck) => checked.filter((r) => r.airdropCheck === k).length;
  const [allinuOnly, both, otherOnly] = AIRDROP_CHECK.map(count) as [number, number, number, number];
  const dkng = rows.map((r) => r.dkng);
  return {
    sources: ["Solana RPC: getTokenAccountsByOwner, getSignaturesForAddress and getTransaction for every wallet holding DKNG (oldest first, until its DKNG goes up); each wallet is traced once"],
    size: n,
    traced, // traced in this run; the rest were traced in earlier runs
    reused,
    errors,
    shares,
    medianDkng: median(dkng),
    underTenthOfShare: dkng.filter((x) => x < 0.1).length / n,
    atLeastOneShare: dkng.filter((x) => x >= 1).length / n,
    airdropCheck: {
      wallets: checked.length,
      shares: Object.fromEntries(AIRDROP_CHECK.map((k) => [k, count(k) / (checked.length || 1)])) as Record<AirdropCheck, number>,
      // of the airdrop-first wallets that held some DKNG reward token when traced, the share holding ALLINU
      allinuAmongHolders: (allinuOnly + both) / (allinuOnly + both + otherOnly || 1),
    },
    rows,
  };
}
export type HolderOrigins = Awaited<ReturnType<typeof getHolderOrigins>>;

async function airdropCheck(owner: string, rewardMints: Set<string>): Promise<AirdropCheck> {
  const held = [...(await mintsHeld(owner))].filter((m) => rewardMints.has(m));
  const allinu = held.includes(ADDR.ALLINU);
  const other = held.some((m) => m !== ADDR.ALLINU);
  return allinu ? (other ? AIRDROP_CHECK[1] : AIRDROP_CHECK[0]) : other ? AIRDROP_CHECK[2] : AIRDROP_CHECK[3];
}

async function firstDkngInflow(owner: string): Promise<Pick<TracedHolder, "origin" | "firstTx" | "firstTime" | "note">> {
  const [account] = await tokenAccountsFor(owner, ADDR.DKNG);
  if (!account) return { origin: "Not resolved", note: "DKNG account closed since the holder scan" };
  // Transaction by transaction even when getTransactionsForAddress is available: the first DKNG increase is
  // almost always in a wallet's first one or two transactions, and fetching just those costs less than a page.
  const signatures = await signaturesSince(account, 0, 5000);
  if (signatures.length >= 5000) return { origin: "Not resolved", note: "history longer than 5,000 transactions" };

  // oldest first
  for (const s of signatures.reverse().slice(0, 8)) {
    const tx = await getTransaction(s.signature);
    if (!tx) continue;
    const change = balanceChanges(tx, ADDR.DKNG);
    if ((change.get(owner) ?? 0n) <= 0n) continue; // the account was opened or emptied, not filled: keep walking

    const signedByOwner = tx.transaction.message.accountKeys.some((k) => k.signer && k.pubkey === owner);
    const senders = [...change].filter(([, d]) => d < 0n).map(([o]) => o);
    const recipients = [...change].filter(([, d]) => d > 0n).length;
    const mints = new Set(tx.meta.postTokenBalances.map((b) => b.mint));
    const fromStonkfun = senders.includes(ADDR.FEE_SELLER) || senders.includes(ADDR.PAYOUT_WALLET);
    const origin: Origin =
      fromStonkfun || (!signedByOwner && recipients >= 6) ? "Reward airdrop"
      : !signedByOwner ? "Transfer from another wallet"
      : mints.has(ADDR.ALLINU) ? "ALLINU trade"
      : [...mints].some((m) => m !== ADDR.DKNG && !STABLES.has(m)) ? "Another memecoin trade"
      : "Bought DKNG directly";
    return { origin, firstTx: s.signature, firstTime: new Date(tx.blockTime * 1000).toISOString() };
  }
  return { origin: "Not resolved", note: "no DKNG increase in the first 8 transactions" };
}
