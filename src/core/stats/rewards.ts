// Rewards: how much DKNG StonkFun has paid to ALLINU holders, and ALLINU's share of ALL DKNG rewards.
// Source: StonkFun's public rewards list, which covers every reward token on the platform.

import { getJSON, pacer } from "../http.ts";
import { ADDR, GECKO, gecko, listIn, sum } from "./shared.ts";

const STONKFUN = "https://www.stonkfun.xyz/api/public/v1";

interface StonkfunLaunch {
  mint: string;
  quoteMint?: string; // the token it pays rewards in (newer replies)
  quote?: { mint?: string }; // the same, as older replies gave it
  distributedTokens: number;
  payoutCount: number;
  lastPayoutAt: string;
}
interface StonkfunPage {
  data?: { launches?: StonkfunLaunch[]; launchesPagination?: { total?: number | null } };
}

const PAGE_SIZE = 1000; // the most the API returns per page
const MAX_PAGES = 500; // a safety stop: the list held about 54 pages in October 2026
const stonkfunPace = pacer(300);
const quoteOf = (x: StonkfunLaunch) => x.quoteMint ?? x.quote?.mint;

/**
 * Every token on StonkFun's rewards list. The list comes in pages and has no filter by reward token, so all of it is
 * read, page by page until a short one (the API has sent its total at times and null at others). Its order holds
 * still between reads, but tokens launched mid-read could shift entries across a page edge: a token met twice means
 * that happened, so the read is redone; so is one that ends up short of a total the API did send.
 */
async function allLaunches(): Promise<StonkfunLaunch[]> {
  for (let attempt = 1; ; attempt++) {
    const byMint = new Map<string, StonkfunLaunch>();
    let total: number | undefined, shifted = false;
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new Error(`StonkFun rewards: more than ${MAX_PAGES} pages`);
      const res = await getJSON<StonkfunPage>(`${STONKFUN}/rewards?page=${page}&pageSize=${PAGE_SIZE}`, { pace: stonkfunPace, label: "StonkFun rewards" });
      const launches = listIn(res.data?.launches, "StonkFun rewards");
      const t = res.data?.launchesPagination?.total;
      if (page === 1 && typeof t === "number" && t >= 0) total = t;
      for (const x of launches) { if (byMint.has(x.mint)) shifted = true; byMint.set(x.mint, x); }
      if (launches.length < PAGE_SIZE) break;
    }
    const complete = !shifted && (total === undefined || byMint.size >= total);
    if (complete) return [...byMint.values()];
    if (attempt >= 3) throw new Error(`StonkFun rewards: the list kept changing while read (${byMint.size} tokens${total === undefined ? "" : ` of ${total}`})`);
  }
}

export async function getRewards() {
  const dkngRewardTokens = (await allLaunches()).filter((x) => quoteOf(x) === ADDR.DKNG);
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
