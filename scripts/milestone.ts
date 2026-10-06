// Checks whether the headline amount (DKNG paid to ALLINU holders, at today's DKNG price) has crossed a milestone
// the page doesn't show yet. Run hourly by .github/workflows/milestone.yml, which starts a full snapshot run when it has.
// Computed exactly as the snapshot computes it (getRewards), so the page then shows what this saw.
//
//   node scripts/milestone.ts        prints both amounts; writes crossed=true|false to $GITHUB_OUTPUT on Actions
//
// MILESTONE_USD sets the milestone (default 1,000,000).

import { appendFileSync, readFileSync } from "node:fs";
import { getRewards } from "../src/core/stats/index.ts";

const milestone = Number(process.env.MILESTONE_USD || 1_000_000);
if (!(milestone > 0)) throw new Error(`MILESTONE_USD is not a positive number: ${process.env.MILESTONE_USD}`);

const snapshot = JSON.parse(readFileSync(new URL("../snapshots/snapshot.json", import.meta.url), "utf8"));
const shown = Number(snapshot.rewards?.usdAtTodaysPrice ?? 0);
const live = (await getRewards()).usdAtTodaysPrice;
// once the page shows the milestone this stays false; if a price dip takes the page back under, a new crossing counts again
const crossed = live >= milestone && shown < milestone;

const usd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
console.log(`milestone ${usd(milestone)}: live ${usd(live)}, page ${usd(shown)} → ${crossed ? "crossed, update the page" : "nothing to do"}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `crossed=${crossed}\n`);
