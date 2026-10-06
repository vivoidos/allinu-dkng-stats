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
  return {
    sources: ["Solana RPC: getProgramAccounts (every Token-2022 account whose mint is DKNG)"],
    tokenAccounts: accounts.length,
    holders: balances.size,
    list: [...balances].map(([owner, raw]) => ({ owner, dkng: toDkng(raw) })),
  };
}
export type Holders = Awaited<ReturnType<typeof getHolders>>;
