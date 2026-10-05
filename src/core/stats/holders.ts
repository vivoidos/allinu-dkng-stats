// Holders: every wallet holding DKNG on Solana, read straight from the chain: all Token-2022 accounts
// whose mint is DKNG. A token account stores mint at byte 0, owner at byte 32, amount at byte 64.

import { TOKEN_2022_PROGRAM, base58, fromBase64, readU64, rpc } from "../solana.ts";
import { ADDR, toDkng } from "./shared.ts";

export async function getHolders() {
  const accounts = await rpc<{ account: { data: [string, string] } }[]>("getProgramAccounts", [
    TOKEN_2022_PROGRAM,
    { encoding: "base64", dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: ADDR.DKNG } }] },
  ]);
  const balances = new Map<string, bigint>();
  for (const a of accounts) {
    const bytes = fromBase64(a.account.data[0]);
    const amount = readU64(bytes, 32);
    if (amount === 0n) continue;
    const owner = base58(bytes.subarray(0, 32));
    balances.set(owner, (balances.get(owner) ?? 0n) + amount);
  }
  // how many wallets hold how much: one DKNG is one DraftKings share
  const BUCKETS = [{ label: "under 0.01", max: 0.01 }, { label: "0.01–0.1", max: 0.1 }, { label: "0.1–1", max: 1 }, { label: "1–10", max: 10 }, { label: "10+", max: Infinity }];
  const balanceBuckets = BUCKETS.map((b) => ({ label: b.label, wallets: 0, dkng: 0 }));
  for (const raw of balances.values()) {
    const dkng = toDkng(raw);
    const i = BUCKETS.findIndex((b) => dkng < b.max);
    const bucket = balanceBuckets[i]!;
    bucket.wallets++;
    bucket.dkng += dkng;
  }
  return {
    sources: ["Solana RPC: getProgramAccounts (every Token-2022 account whose mint is DKNG)"],
    tokenAccounts: accounts.length,
    holders: balances.size,
    balanceBuckets,
    list: [...balances].map(([owner, raw]) => ({ owner, dkng: toDkng(raw) })),
  };
}
export type Holders = Awaited<ReturnType<typeof getHolders>>;
