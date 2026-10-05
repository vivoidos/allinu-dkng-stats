// Pools: where DKNG liquidity sits on Solana, ranked by GeckoTerminal.

import { ADDR, GECKO, gecko, listIn, sum } from "./shared.ts";

interface GeckoPool {
  attributes: { address: string; name: string; reserve_in_usd: string | null; volume_usd?: { h24?: string | null } };
  relationships: { dex: { data: { id: string } }; base_token?: { data: { id: string } }; quote_token?: { data: { id: string } } };
}
interface GeckoToken { id: string; attributes: { address: string; name: string; symbol: string } }
/** `pair`: the pool's other token, by its symbol, or by its name when its symbol is also DKNG (it happens). */
export interface Pool { address: string; name: string; pair: string; dex: string; liquidity: number; volume24h: number }

export async function getPools() {
  const pools: Pool[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await gecko<{ data?: GeckoPool[]; included?: GeckoToken[] }>(`/tokens/${ADDR.DKNG}/pools?page=${page}&include=base_token,quote_token`);
    const data = listIn(r.data, "GeckoTerminal DKNG pools");
    const tokens = new Map((r.included ?? []).map((t) => [t.id, t.attributes]));
    for (const p of data) {
      const other = [p.relationships.base_token?.data.id, p.relationships.quote_token?.data.id].map((id) => (id ? tokens.get(id) : undefined)).find((t) => t && t.address !== ADDR.DKNG);
      const pair = other ? (other.symbol.toUpperCase() === "DKNG" ? other.name : other.symbol) : p.attributes.name;
      pools.push({ address: p.attributes.address, name: p.attributes.name, pair, dex: p.relationships.dex.data.id, liquidity: Number(p.attributes.reserve_in_usd) || 0, volume24h: Number(p.attributes.volume_usd?.h24) || 0 });
    }
    if (!data.length) break; // an empty page is the end, whatever the page size
  }
  pools.sort((a, b) => b.liquidity - a.liquidity);
  // the ranking leaves out pools with no trading in the last 24 hours: GeckoTerminal values a pool's other token
  // at its last price, which in an untraded pool can be far off (one such pool showed 5x its real liquidity)
  const active = pools.filter((p) => p.volume24h > 0);
  const allinu = active.find((p) => p.address === ADDR.ALLINU_DKNG_POOL);
  const usdcPools = active.filter((p) => /\bUSDC\b/.test(p.name) && /\bDKNG\b/.test(p.name));
  return {
    sources: [`${GECKO}/tokens/${ADDR.DKNG}/pools`],
    count: pools.length,
    activeCount: active.length, // traded in the last 24 hours: the ones ranked
    top: active.slice(0, 5),
    allinuLiquidity: allinu?.liquidity ?? 0,
    allinuRank: allinu ? active.indexOf(allinu) + 1 : null,
    usdcPoolsLiquidity: sum(usdcPools.map((p) => p.liquidity)),
    all: pools,
  };
}
export type Pools = Awaited<ReturnType<typeof getPools>>;
