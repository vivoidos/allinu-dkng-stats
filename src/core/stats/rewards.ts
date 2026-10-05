// Rewards: how much DKNG StonkFun has paid to ALLINU holders, and ALLINU's share of ALL DKNG rewards.
// Source: StonkFun's public rewards list, which covers every reward token on the platform.

import { getJSON } from "../http.ts";
import { ADDR, GECKO, gecko, listIn, sum } from "./shared.ts";

const STONKFUN = "https://www.stonkfun.xyz/api/public/v1";

interface StonkfunLaunch {
  mint: string;
  quote: { mint: string; symbol: string };
  distributedTokens: number;
  payoutCount: number;
  lastPayoutAt: string;
}

export async function getRewards() {
  const res = await getJSON<{ data?: { launches?: StonkfunLaunch[] } }>(`${STONKFUN}/rewards`);
  const dkngRewardTokens = listIn(res.data?.launches, "StonkFun rewards").filter((x) => x.quote.mint === ADDR.DKNG);
  // a field arriving as a string would add up as text and skew every share: fail instead
  if (dkngRewardTokens.some((x) => typeof x.distributedTokens !== "number" || typeof x.payoutCount !== "number")) throw new Error("StonkFun rewards: unexpected field types");
  const allinu = dkngRewardTokens.find((x) => x.mint === ADDR.ALLINU);
  if (!allinu) throw new Error("ALLINU missing from StonkFun's rewards list");
  // valued at today's DKNG price, the way StonkFun's own panel values it
  const token = await gecko<{ data: { attributes: { price_usd: string } } }>(`/tokens/${ADDR.DKNG}`);
  const price = Number(token.data.attributes.price_usd);
  if (!(price > 0)) throw new Error("GeckoTerminal returned no DKNG price");
  return {
    sources: [`${STONKFUN}/rewards`, `${GECKO}/tokens/${ADDR.DKNG}`],
    dkngPaid: allinu.distributedTokens,
    payouts: allinu.payoutCount,
    lastPayoutAt: allinu.lastPayoutAt,
    dkngPrice: price,
    usdAtTodaysPrice: allinu.distributedTokens * price,
    shareOfAllDkngPayouts: allinu.payoutCount / sum(dkngRewardTokens.map((x) => x.payoutCount)),
    shareOfAllDkngPaid: allinu.distributedTokens / sum(dkngRewardTokens.map((x) => x.distributedTokens)),
    dkngRewardTokens: dkngRewardTokens.length,
    dkngRewardMints: dkngRewardTokens.map((x) => x.mint),
  };
}
export type Rewards = Awaited<ReturnType<typeof getRewards>>;
