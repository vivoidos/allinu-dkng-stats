// Supply: how many tokenized DraftKings shares exist on Solana, day by day.
// Backpack Securities issues DKNG; per Backpack, each token converts 1:1 into a DraftKings share
// entitlement and back. Tokens are minted when shares come onchain and burned when they go back.
// We read every transaction of DKNG's mint authority (named in the DKNG mint account), sum each DKNG
// mint and burn in it, and walk back from today's supply. Check: the walk must land near 0 before the
// first mint. It lands slightly below 0 (−13.7 DKNG on 2026-10-03, 0.04% of supply) because any holder
// can burn their own tokens, which wallets do when they "burn dust and close" an account, and those
// burns never touch the issuer's wallets. (The issuer's permanent delegate, which can burn from any
// account, was checked: its DKNG burns all appear in the mint authority's transactions too.)

import { allInstructions, rpc } from "../solana.ts";
import { ADDR, SINCE, allinuPoolDkngVault, toDkng, utcDay, forEachTransactionOf, historyRoute, type Progress } from "./shared.ts";

interface MintAccount { mintAuthority: string; supply: string; decimals: number }

export async function getSupply({ onProgress }: { onProgress?: Progress } = {}) {
  const mint = await rpc<{ value: { data: { parsed: { info: MintAccount & { extensions?: { extension: string; state?: { multiplier?: string; newMultiplier?: string } }[] } } } } }>("getAccountInfo", [ADDR.DKNG, { encoding: "jsonParsed" }]);
  const { mintAuthority, supply, extensions } = mint.value.data.parsed.info;
  // DKNG's mint can rescale every balance (Token-2022 scaled UI amount, e.g. after a stock split). Every number here
  // reads 1 raw DKNG unit as 1/1e6 share; if the multiplier ever leaves 1, stop rather than publish wrong counts.
  const scaled = extensions?.find((e) => e.extension === "scaledUiAmountConfig")?.state;
  if (scaled && [scaled.multiplier, scaled.newMultiplier].some((m) => m != null && Number(m) !== 1)) throw new Error(`DKNG's balance multiplier is ${scaled.multiplier}, not 1: the share counts need updating`);
  const events: { t: number; raw: bigint }[] = []; // + minted, − burned
  const { read, unreadable } = await forEachTransactionOf("supply", [mintAuthority], 0, (tx) => {
    for (const ix of allInstructions(tx)) {
      const p = ix.parsed;
      if (p?.info.mint !== ADDR.DKNG) continue;
      const raw = BigInt(p.info.tokenAmount?.amount ?? p.info.amount ?? 0);
      if (p.type.startsWith("mintTo")) events.push({ t: tx.blockTime, raw });
      else if (p.type.startsWith("burn")) events.push({ t: tx.blockTime, raw: -raw });
    }
  }, onProgress);
  events.sort((a, b) => a.t - b.t);

  const supplyNow = BigInt(supply);
  let running = supplyNow - events.reduce((a, e) => a + e.raw, 0n); // supply before the first event: should be 0
  const startSupply = running;
  const daily = new Map<string, { minted: bigint; burned: bigint; supply: bigint }>();
  for (const e of events) {
    const d = daily.get(utcDay(e.t)) ?? { minted: 0n, burned: 0n, supply: 0n };
    if (e.raw > 0n) d.minted += e.raw; else d.burned -= e.raw;
    running += e.raw;
    d.supply = running;
    daily.set(utcDay(e.t), d);
  }
  const launch = Date.parse(SINCE) / 1000;
  const sinceLaunch = events.filter((e) => e.t >= launch);
  // how much of it sits in the ALLINU/DKNG pool right now: the pool vault's balance
  const vault = await allinuPoolDkngVault();
  const vaultBalance = await rpc<{ value: { amount: string } }>("getTokenAccountBalance", [vault]);
  const allinuPoolDkng = toDkng(BigInt(vaultBalance.value.amount));
  // the largest DKNG holdings (token accounts) and who owns each: a pool's DKNG sits in its vault account
  const largest = await rpc<{ value: { address: string; amount: string }[] }>("getTokenLargestAccounts", [ADDR.DKNG]);
  const owners = await rpc<{ value: ({ data: { parsed: { info: { owner: string } } } } | null)[] }>("getMultipleAccounts", [largest.value.map((a) => a.address), { encoding: "jsonParsed" }]);
  const largestHoldings = largest.value.map((a, i) => ({ account: a.address, owner: owners.value[i]?.data.parsed.info.owner ?? null, dkng: toDkng(BigInt(a.amount)) }));
  const rank = largestHoldings.findIndex((h) => h.account === vault) + 1;
  return {
    sources: ["Solana RPC: getAccountInfo (the DKNG mint)", `Solana RPC: ${await historyRoute()}, for the mint authority ${mintAuthority}`, `Solana RPC: getTokenAccountBalance (the ALLINU/DKNG pool's DKNG vault ${vault})`, "Solana RPC: getTokenLargestAccounts (DKNG) and getMultipleAccounts (who owns each)"],
    mintAuthority,
    transactionsRead: read,
    unreadable,
    supplyNow: toDkng(supplyNow),
    allinuPoolVault: vault,
    allinuPoolDkng, // DKNG in the ALLINU/DKNG pool's vault, read in the same run as the supply
    allinuHoldingRank: rank || null, // the vault's place among the largest DKNG holdings (null: not in the top 20)
    largestHoldings: largestHoldings.slice(0, 8),
    startSupply: toDkng(startSupply),
    firstMintAt: events[0] ? new Date(events[0].t * 1000).toISOString() : null,
    mintedSinceLaunch: toDkng(sinceLaunch.filter((e) => e.raw > 0n).reduce((a, e) => a + e.raw, 0n)),
    burnedSinceLaunch: toDkng(-sinceLaunch.filter((e) => e.raw < 0n).reduce((a, e) => a + e.raw, 0n)),
    daily: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d, minted: toDkng(v.minted), burned: toDkng(v.burned), supply: toDkng(v.supply) })),
  };
}
export type Supply = Awaited<ReturnType<typeof getSupply>>;
