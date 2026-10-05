// ALLINU / DKNG: every number on the page is computed in this folder, one file per block.
// `node scripts/snapshot.ts` runs them and writes snapshots/snapshot.json, which the page displays.
//
// Sources, all public:
//   • Solana mainnet RPCs (listed in ../solana.ts; calls rotate across them)
//   • GeckoTerminal public API   https://api.geckoterminal.com/api/v2
//   • StonkFun public API        https://www.stonkfun.xyz/api/public/v1
//   • Birdeye, optionally, for hourly pool volume (useBirdeye)

import type { Holders } from "./holders.ts";
import type { HolderOrigins } from "./origins.ts";
import type { PayoutFlow } from "./payouts.ts";
import type { Pool, Pools } from "./pools.ts";
import type { Rewards } from "./rewards.ts";
import type { RoutedVolume } from "./routed.ts";
import type { Supply } from "./supply.ts";
import type { Volume } from "./volume.ts";

export { ADDR, SINCE, type Progress } from "./shared.ts";
export * from "./rewards.ts";
export * from "./holders.ts";
export * from "./pools.ts";
export * from "./payouts.ts";
export * from "./supply.ts";
export * from "./nasdaq.ts";
export * from "./volume.ts";
export * from "./origins.ts";
export * from "./routed.ts";

// What scripts/snapshot.ts writes to snapshots/snapshot.json (each block stamped with when it was computed).
/** A block, with when it was computed. Snapshots written before `sources` lists have one `source` string instead. */
export type Stamped<T> = T & { computedAt: string; source?: string };
export interface SnapshotRun {
  log: string; // the run's public log
  repo: string;
  commit: string; // the exact code that ran
}
export interface Snapshot {
  computedAt: string;
  solanaRpc: string[]; // the Solana endpoints the run used
  run: SnapshotRun | null; // the GitHub Actions run that computed it (null for a run on someone's own machine)
  rewards: Stamped<Rewards>;
  holders: Stamped<Omit<Holders, "list">>;
  pools: Stamped<Omit<Pools, "all">> & { all?: Pool[] };
  payoutPace?: Stamped<PayoutFlow>; // absent until a run has computed them
  supply?: Stamped<Supply>;
  volume: Stamped<Volume>;
  origins?: Stamped<Omit<HolderOrigins, "rows">>; // optional blocks: scripts/snapshot.ts --with origins,reach
  reach?: Stamped<PayoutFlow>;
  routed?: Stamped<RoutedVolume>;
}
