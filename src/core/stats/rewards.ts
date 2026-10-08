// Rewards: how much DKNG StonkFun has paid to ALLINU holders, and ALLINU's share of ALL DKNG rewards.
// Source: StonkFun's public rewards list, which covers every reward token on the platform.

import { getJSON, pacer } from "../http.ts";
import { ADDR, GECKO, gecko, listIn, sum } from "./shared.ts";

const STONKFUN = "https://www.stonkfun.xyz/api/public/v1";

interface StonkfunLaunch {
  mint: string;
  quoteMint: string; // the token it pays rewards in
  distributedTokens: number;
  payoutCount: number;
  lastPayoutAt: string;
}
interface StonkfunPage {
  data?: { launches?: StonkfunLaunch[]; launchesPagination?: { page: number; pageSize: number; total: number; totalPages: number } };
}

const PAGE_SIZE = 1000; // the most the API returns per page
const stonkfunPace = pacer(300);

/**
 * Every token on StonkFun's rewards list. The list comes in pages and has no filter by reward token, so all of it is
 * read. Tokens launched while it is read can shift entries onto the next page: entries are kept once each, by mint,
 * and the read is redone until it holds at least as many as the list said it had when the read began.
 */
async function allLaunches(): Promise<StonkfunLaunch[]> {
  for (let attempt = 1; ; attempt++) {
    const byMint = new Map<string, StonkfunLaunch>();
    let total = 0;
    for (let page = 1, pages = 1; page <= pages; page++) {
      const res = await getJSON<StonkfunPage>(`${STONKFUN}/rewards?page=${page}&pageSize=${PAGE_SIZE}`, { pace: stonkfunPace, label: "StonkFun rewards" });
      const info = res.data?.launchesPagination;
      if (!info || !(info.totalPages >= 1) || !(info.total >= 0)) throw new Error("StonkFun rewards: unexpected response (no page count)");
      if (page === 1) { pages = info.totalPages; total = info.total; }
      for (const x of listIn(res.data?.launches, "StonkFun rewards")) byMint.set(x.mint, x);
    }
    if (byMint.size >= total) return [...byMint.values()];
    if (attempt >= 3) throw new Error(`StonkFun rewards: read ${byMint.size} of ${total} tokens three times`);
  }
}

export async function getRewards() {
  const dkngRewardTokens = (await allLaunches()).filter((x) => x.quoteMint === ADDR.DKNG);
  // a field arriving as a string would add up as text and skew every share: fail instead
  if (dkngRewardTokens.some((x) => typeof x.distributedTokens !== "number" || typeof x.payoutCount !== "number")) throw new Error("StonkFun rewards: unexpected field types");
  if (!dkngRewardTokens.length) throw new Error("StonkFun rewards: no token pays rewards in DKNG (has the list changed shape?)");
  const allinu = dkngRewardTokens.find((x) => x.mint === ADDR.ALLINU);
  if (!allinu) throw new Error("ALLINU missing from StonkFun's rewards list");
  // valued at today's DKNG price, the way StonkFun's own panel values it
  const token = await gecko<{ data: { attributes: { price_usd: string } } }>(`/tokens/${ADDR.DKNG}`);
  const price = Number(token.data.attributes.price_usd);
  if (!(price > 0)) throw new Error("GeckoTerminal returned no DKNG price");
  // the reward tokens that paid out the most DKNG, named by their symbol (by their name when the symbol is also DKNG)
  const top = [...dkngRewardTokens].sort((a, b) => b.distributedTokens - a.distributedTokens).slice(0, 5);
  const topRewardTokens = [];
  for (const x of top) {
    let label = x.mint === ADDR.ALLINU ? "ALLINU" : `${x.mint.slice(0, 4)}…`;
    if (x.mint !== ADDR.ALLINU) {
      try {
        const t = await gecko<{ data?: { attributes?: { name?: string; symbol?: string } } }>(`/tokens/${x.mint}`);
        const { name, symbol } = t.data?.attributes ?? {};
        if (symbol) label = symbol.toUpperCase() === "DKNG" && name ? name : symbol;
      } catch { /* unnamed: shown by its address */ }
    }
    topRewardTokens.push({ mint: x.mint, label, dkngPaid: x.distributedTokens, payouts: x.payoutCount });
  }
  const allDkngPaid = sum(dkngRewardTokens.map((x) => x.distributedTokens));
  return {
    sources: [`${STONKFUN}/rewards (every page)`, `${GECKO}/tokens/${ADDR.DKNG}`, `${GECKO}/tokens/{each top reward token} (names)`],
    dkngPaid: allinu.distributedTokens,
    payouts: allinu.payoutCount,
    lastPayoutAt: allinu.lastPayoutAt,
    dkngPrice: price,
    usdAtTodaysPrice: allinu.distributedTokens * price,
    shareOfAllDkngPayouts: allinu.payoutCount / sum(dkngRewardTokens.map((x) => x.payoutCount)),
    shareOfAllDkngPaid: allinu.distributedTokens / sum(dkngRewardTokens.map((x) => x.distributedTokens)),
    dkngRewardTokens: dkngRewardTokens.length,
    dkngRewardMints: dkngRewardTokens.map((x) => x.mint),
    othersDkngPaid: allDkngPaid - allinu.distributedTokens, // every other DKNG reward token together
    topRewardTokens,
  };
}
export type Rewards = Awaited<ReturnType<typeof getRewards>>;
