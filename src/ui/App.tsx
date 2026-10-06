import { useState } from "react";
import { ADDR, ORIGINS, SINCE, originLabel, type Snapshot } from "../core/stats/index.ts";
import { AreaOverTime, CumulativeVolumeChart, DataTable, HBarChart, Waffle, WeekHeatmap, useCountUp } from "./charts.tsx";
import { FigTitle, GitHubIcon, Story } from "./components.tsx";
import { MethodologyDialog, useMethodology } from "./methodology.tsx";
import { PngDialog } from "./png-dialog.tsx";
import { useSnapshot } from "./data.ts";
import { DotNumber } from "./dot-number.tsx";
import { day, int, pct, time, usd } from "./format.ts";

/** Tokenized DKNG's first trading day on Solana (SINCE in src/core/stats/shared.ts). */

/** Day-by-day values added up, as chart points. */
function runningTotal(days: { d: string; v: number }[], note: (sum: number) => string) {
  let sum = 0;
  return days.map((x) => ({ label: day(x.d), value: (sum += x.v), note: note(sum) }));
}

/** The public repository with every line of code behind this page. */
const REPO = "https://github.com/vivoidos/allinu-dkng-stats";

export function App() {
  const { data: d, error } = useSnapshot();
  if (!d) return <main className="wrap"><p className="status">{error ? `Couldn't load snapshot.json: ${String(error)}` : "Loading the numbers…"}</p></main>;
  return (
    <MethodologyDialog d={d} repo={REPO}>
      <main id="top">
        <Intro d={d} />
        <div className="wrap stories">
          {d.origins ? <FirstDkng d={d} origins={d.origins} /> : <RewardShare d={d} />}
          <VolumeShare d={d} />
          <DeepestPool d={d} />
          <AroundTheClock d={d} />
          <AheadOfOthers d={d} />
          {d.supply && <Supply d={d} supply={d.supply} />}
        </div>
        <Proof d={d} />
      </main>
      <footer>
        <div className="wrap">
          <Updated d={d} />
          <p>
            An independent community project. Most numbers are recomputed automatically every day; the code is
            on <a href={REPO} target="_blank" rel="noopener">GitHub</a>. Not affiliated with ALLINU, DraftKings, Backpack Securities or StonkFun.
            Not financial advice.
          </p>
        </div>
      </footer>
    </MethodologyDialog>
  );
}

// ---------- intro: the total, and every share as a dot ----------

/**
 * Local preview only: `?paid=1050000` shows the page as if that much had been paid (shares scale with it).
 * `import.meta.env.DEV` is false in the published build, so this never runs there.
 */
const previewScale = (actual: number) => {
  if (!import.meta.env.DEV) return 1;
  const paid = Number(new URLSearchParams(location.search).get("paid"));
  return paid > 0 ? paid / actual : 1;
};

/** "$1.05M", or "$899K" below a million (and "$1.00M", never "$1000K", just under it). */
const headlineUsd = (v: number) => (Math.round(v / 1e3) >= 1000 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1e3)}K`);

function Intro({ d }: { d: Snapshot }) {
  const r = d.rewards;
  const k = previewScale(r.usdAtTodaysPrice);
  const paid = r.usdAtTodaysPrice * k, shares = r.dkngPaid * k;
  const shownPaid = useCountUp(paid, 1800);
  const shownShares = useCountUp(shares, 1800);
  // A payout transaction doesn't say which reward token it pays for, so a day's ALLINU payouts are that day's DKNG
  // payouts (all reward tokens) scaled so the days add up to ALLINU's total.
  const allDkng = d.reach ? d.reach.daily.reduce((a, x) => a + x.dkng, 0) : 0;
  const sameDay = d.reach && d.reach.computedAt.slice(0, 10) === r.computedAt.slice(0, 10); // else the days would spread newer payouts
  const days = d.reach && sameDay && allDkng > 0
    ? d.reach.daily.map((x) => { const dkng = (x.dkng / allDkng) * shares; return { d: x.d, dkng, usd: dkng * r.dkngPrice }; })
    : [];
  const daysLive = Math.floor((Date.parse(d.computedAt) - Date.parse(SINCE)) / 86400e3) + 1;
  return (
    <section className="intro">
      <div className="hero-ambient" style={{ backgroundImage: "url(dog-room.jpg)" }} aria-hidden="true" />
      <div className="hero-photo" style={{ backgroundImage: "url(dog.jpg)" }} aria-hidden="true" />
      <div className="wrap">
        <h1 className="headline">
          <span className="headline-line">ALLINU holders have received</span>
          <span className="sr-only"> {headlineUsd(paid)} of DraftKings stock.</span>
        </h1>
        <DotNumber text={headlineUsd(paid)} shares={shares} days={days} tail={<p className="headline-line headline-tail" aria-hidden="true">of DraftKings stock.</p>} />
        <p className="lede">Every $ALLINU transfer carries a 1% fee, which buys tokenized DraftKings stock for ALLINU holders.</p>
        <dl className="tally">
          <div><dt>of DraftKings stock paid, at today's ${r.dkngPrice.toFixed(2)} a share</dt><dd className="num">${int(shownPaid)}</dd></div>
          <div><dt>tokenized DraftKings shares, in total</dt><dd className="num">{int(shownShares)}</dd></div>
          <div><dt>payments to ALLINU holders</dt><dd className="num">{int(r.payouts * k)}</dd></div>
          <div><dt>since DKNG went live on Solana</dt><dd>{daysLive} days</dd></div>
        </dl>
        <p className="hero-note">ALLINU is a memecoin launched on StonkFun. DKNG is tokenized DraftKings stock, issued on Solana by Backpack Securities.</p>
      </div>
    </section>
  );
}

/**
 * "Updated Oct 5, 02:33 UTC · 4 hours ago", linking to the run that computed the numbers when there is one.
 * The snapshot runs daily: past 36 hours one was missed, and the dot dims to say so.
 */
function Updated({ d }: { d: Snapshot }) {
  const hours = Math.max(0, (Date.now() - Date.parse(d.computedAt)) / 3600e3);
  const whole = Math.floor(hours);
  const ago = hours < 1 ? "under an hour ago" : hours < 48 ? `${whole} hour${whole === 1 ? "" : "s"} ago` : `${Math.floor(hours / 24)} days ago`;
  const stamp = <>Updated <time dateTime={d.computedAt}>{time(d.computedAt)}</time> · {ago}</>;
  return (
    <p className={hours > 36 ? "updated stale" : "updated"}>
      <span className="updated-dot" aria-hidden="true" />
      {d.run ? <a href={d.run.log} target="_blank" rel="noopener" title="The run that computed these numbers">{stamp}</a> : stamp}
    </p>
  );
}

// ---------- the stories ----------

/** Whose hourly pool volume the run used: Birdeye when it had a key, GeckoTerminal otherwise. */
const volumeSource = (v: Snapshot["volume"]) => (v.sources.some((s) => s.includes("birdeye")) ? "Birdeye" : "GeckoTerminal");

function AroundTheClock({ d }: { d: Snapshot }) {
  const v = d.volume, through = d.routed?.shareWhileClosed;
  // launch day weighs on the closed share: the method says how much, and what the share is without it
  const launch = { share: v.launchDayTotal / v.marketTotal, closedWithout: (v.closedTotal - v.launchDayClosed) / (v.marketTotal - v.launchDayTotal) };
  return (
    <Story id="clock" label="Trading hours"
      stat={pct(through ?? v.closedShareOfAll)}
      claim={through != null ? "of DraftKings volume on Solana while Nasdaq was closed went through ALLINU." : "of DraftKings volume on Solana so far happened while Nasdaq was closed."}
      sources={through != null ? [v, d.routed!] : [v]}
      data={<DataTable caption="DKNG volume on Solana by weekday and hour, New York time" headers={["Hour (New York)", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
        rows={Array.from({ length: 24 }, (_, h) => [`${h}:00`, ...v.byHourNewYork.map((week) => `$${int(week[h] ?? 0)}`)])} />}
      method={<>
        <p>{volumeSource(v)}'s hourly volume for every DKNG pool GeckoTerminal lists on Solana{v.unlistedPools.length ? <>, plus {v.unlistedPools.join(", ")}, which it doesn't</> : null}, since Sep 11.</p>
        <ul>
          <li>Nasdaq open: 9:30–16:00 New York time, weekdays. Pre-market, after-hours, weekends and holidays count as closed. Since Sep 11, Nasdaq was closed for {pct(v.closedHoursShare)} of all hours.</li>
          <li>{pct(v.closedShareOfAll)} of all DKNG trading on Solana happened while Nasdaq was closed.</li>
          <li>Launch day weighs heavily. DKNG began trading on Friday, Sep 11, in Nasdaq's last hour of the week, so nearly all of its busy first day fell after the close. That day carried {pct(launch.share)} of all volume so far. Without it, {pct(launch.closedWithout)} traded while Nasdaq was closed.</li>
          {through != null && <li>"Through ALLINU" is the ALLINU/DKNG pool plus the legs of ALLINU trades routed through other DKNG pools (see Volume), each split into open or closed by the hour it traded. The ALLINU/DKNG pool alone: {pct(v.allinuShareWhileClosed)}. Counting each trade once instead: {pct(v.closedAllinu / (v.closedSinceAllinu - d.routed!.routedClosedUsd))}.</li>}
        </ul>
      </>}
      figure={<><FigTitle>DKNG volume on Solana by weekday and hour, New York time</FigTitle><WeekHeatmap grid={v.byHourNewYork} money={(x) => usd(x, 1)} /></>}>
      <p>Onchain, DraftKings never closes: {pct(v.closedShareOfAll)} of DKNG volume so far traded outside Nasdaq hours.</p>
    </Story>
  );
}

const versusUsdc = (ratio: number) => (ratio >= 1.1 ? "more than" : ratio >= 0.9 ? "about as much as" : `${pct(ratio)} of`);

function DeepestPool({ d }: { d: Snapshot }) {
  const p = d.pools;
  const label = (pool: (typeof p.top)[number]) => (pool.address === ADDR.ALLINU_DKNG_POOL ? "ALLINU" : `${pool.pair} (${pool.address.slice(0, 4)}…)`);
  return (
    <Story id="pool" label="Liquidity" stat={p.allinuRank ? `#${p.allinuRank}` : "–"} claim="DraftKings pool on Solana by liquidity is ALLINU/DKNG."
      sources={[p]}
      data={<DataTable caption={`The ${p.top.length} largest of ${int(p.count)} DKNG pools on Solana`} headers={["Pool", "DEX", "Liquidity"]}
        rows={p.top.map((pool) => [label(pool), pool.dex, `$${int(pool.liquidity)}`])} />}
      method={<p>GeckoTerminal's liquidity for each of the {int(p.count)} DKNG pools it lists on Solana. Liquidity is the dollar value of both tokens in a pool: ALLINU/DKNG counts its ALLINU side as a DKNG/USDC pool counts its USDC. All DKNG/USDC pools together hold {usd(p.usdcPoolsLiquidity, 0)}. Pools with no trading in the last 24 hours are left out of the ranking ({int(p.count - p.activeCount)} of them): GeckoTerminal values an untraded pool's other token at its last price, which can be far off.</p>}
      figure={<>
        <FigTitle>The largest DKNG pools on Solana, by liquidity</FigTitle>
        <HBarChart format={(x) => usd(x, 0)} labelWidth={180}
          data={p.top.map((pool) => ({ label: label(pool), value: pool.liquidity, highlight: pool.address === ADDR.ALLINU_DKNG_POOL, tip: `${pool.name} on ${pool.dex}` }))} />
      </>}>
      <p><b className="num">{usd(p.allinuLiquidity, 0)}</b> of liquidity, {versusUsdc(p.allinuLiquidity / p.usdcPoolsLiquidity)} all DKNG/USDC pools combined.</p>
    </Story>
  );
}

function VolumeShare({ d }: { d: Snapshot }) {
  const v = d.volume, r = d.routed;
  const routedOn = new Map((r?.daily ?? []).map((x) => [x.d, x.usd]));
  // routed is a slow block: newer days may not have it yet, and the day it ran on is only partly read
  const routedTo = r ? (r.computedAt.slice(0, 10) === r.daily.at(-1)?.d ? r.daily.at(-2)?.d : r.daily.at(-1)?.d) ?? "" : "";
  const rows = v.daily.map((x) => {
    const routed = r && x.d <= routedTo ? Math.min(routedOn.get(x.d) ?? 0, x.rest) : undefined; // routed legs are part of the other pools' volume
    return { d: x.d, allinu: x.allinu, routed, rest: x.rest - (routed ?? 0) };
  });
  const through = (x: (typeof rows)[number]) => pct((x.allinu + (x.routed ?? 0)) / (x.allinu + (x.routed ?? 0) + x.rest || 1));
  return (
    <Story id="volume" label="Volume" stat={pct(r ? r.share : v.share)} claim={r ? "of DraftKings volume on Solana has gone through ALLINU since launch." : "of all DraftKings volume on Solana has gone through the ALLINU pool since launch."}
      sources={r ? [v, r] : [v]}
      data={<DataTable caption="DKNG volume on Solana per UTC day (the last row is today so far)" headers={r ? ["Day (UTC)", "ALLINU pool", "Routed by ALLINU trades", "Everything else", "Through ALLINU"] : ["Day (UTC)", "ALLINU pool", "Other pools", "ALLINU share"]}
        rows={rows.map((x) => r ? [day(x.d), `$${int(x.allinu)}`, x.routed === undefined ? "–" : `$${int(x.routed)}`, `$${int(x.rest)}`, x.routed === undefined ? "–" : through(x)] : [day(x.d), `$${int(x.allinu)}`, `$${int(x.rest)}`, through(x)])} />}
      method={<>
        <p>Pool volume is {volumeSource(v)}'s hourly volume for every DKNG pool GeckoTerminal lists on Solana{v.unlistedPools.length ? <>, plus {v.unlistedPools.join(", ")}, which it doesn't</> : null}, from the ALLINU pool's first trading hour ({time(v.allinuFrom)}).</p>
        <ul>
          <li>A trade routed through several DKNG pools counts once in each.</li>
          <li>Not counted: hundreds of tiny launchpad curves of other tokens paired with DKNG, about 0.5% of all DKNG volume when checked against Birdeye on Oct 5.</li>
          <li>Birdeye and GeckoTerminal differ by a few percent in total, and by over 20% on the two busiest days.</li>
        </ul>
        {r && <>
          <p>Routed volume: a trade can reach the ALLINU/DKNG pool through another DKNG pool. SOL or USDC buys DKNG there, then that DKNG buys ALLINU (or the reverse). Both legs are DKNG volume from one trade.</p>
          <ul>
            <li>All {int(r.transactions)} transactions that touched the ALLINU/DKNG pool were read. {int(r.routedTransactions)} moved DKNG through other DKNG pools; that DKNG is valued at the hour's DKNG price.</li>
            <li>Arbitrage passing through the ALLINU/DKNG pool counts.</li>
            <li>Volume counts a trade once in every pool it passes through, as DEX volume always does. Counting each trade once instead, ALLINU's share is {pct(r.allinuPoolUsd / (r.total - r.routedUsd))}.</li>
            <li>ALLINU's own SOL and USDC pools are not part of any number here.</li>
            {r.total !== v.total && <li>Measured up to {time(r.computedAt)}, against the volume up to then.</li>}
          </ul>
        </>}
      </>}
      figure={<>
        <FigTitle>DKNG volume on Solana since ALLINU launched, added up day by day</FigTitle>
        <div className="legend">
          <span><i style={{ background: "var(--series-1)" }} />ALLINU/DKNG pool</span>
          {r && <span><i style={{ background: "color-mix(in oklab, var(--series-1) 48%, var(--bg))" }} />Other pools, as part of ALLINU trades</span>}
          <span><i style={{ background: "var(--series-other)" }} />{r ? "Other pools, everything else" : "Every other DKNG pool"}</span>
        </div>
        <CumulativeVolumeChart money={(x) => usd(x, 0)} data={rows.map((x) => ({ label: day(x.d), allinu: x.allinu, routed: x.routed, rest: x.rest }))} />
      </>}>
      {r
        ? <p><b className="num">{usd(r.allinuPoolUsd)}</b> in the ALLINU pool and <b className="num">{usd(r.routedUsd)}</b> routed through other pools, of <span className="num">{usd(r.total)}</span> in total.</p>
        : <p><b className="num">{usd(v.allinu)}</b> of <span className="num">{usd(v.total)}</span> since ALLINU launched. On weekends, <b>{pct(v.weekendShare)}</b>.</p>}
    </Story>
  );
}

/** The DKNG paid out each day as a running total. */
function PayoutsToDate({ d, reach }: { d: Snapshot; reach: NonNullable<Snapshot["reach"]> }) {
  return <>
    <FigTitle>DKNG StonkFun has paid out since Sep 11, for every token that pays in DKNG, added up day by day</FigTitle>
    <AreaOverTime name="DKNG paid" format={int} height={240} data={runningTotal(reach.daily.map((x) => ({ d: x.d, v: x.dkng })), (sum) => `≈ $${int(sum * d.rewards.dkngPrice)} at today's price`)} />
  </>;
}

/** Its table, for the methodology dialog. */
const payoutsTable = (reach: NonNullable<Snapshot["reach"]>) => (
  <DataTable caption="DKNG reward payments per UTC day, every token that pays in DKNG" headers={["Day (UTC)", "DKNG paid", "Payments"]}
    rows={reach.daily.map((x) => [day(x.d), int(x.dkng), int(x.payments)])} />
);

/** ALLINU against every other token StonkFun pays DKNG rewards for, from StonkFun's own list. */
function AheadOfOthers({ d }: { d: Snapshot }) {
  const r = d.rewards;
  // two tokens can share a ticker (casinu, CASINU): those get their address too
  const top = r.topRewardTokens.map((t, _, all) => ({ ...t, label: all.filter((o) => o.label.toLowerCase() === t.label.toLowerCase()).length > 1 ? `${t.label} (${t.mint.slice(0, 4)}…)` : t.label }));
  const times = Math.floor(r.dkngPaid / r.othersDkngPaid); // rounded down, so it never overstates
  return (
    <Story id="lead" label="Rewards" stat={`${times}×`} claim="as much DKNG paid out for ALLINU as for every other DKNG-paired StonkFun token combined."
      sources={[r]}
      data={<DataTable caption="The StonkFun tokens that paid out the most DKNG in rewards" headers={["Token", "DKNG paid out", "Payments"]}
        rows={top.map((t) => [t.label, int(t.dkngPaid), int(t.payouts)])} />}
      method={<ul>
        <li>Each StonkFun token is paired with an asset and pays its holders rewards in that asset; {int(r.dkngRewardTokens)} are paired with DKNG. From StonkFun's public rewards list: the DKNG each of those has paid out, as StonkFun reports it.</li>
        <li>{times}× is ALLINU's {int(r.dkngPaid)} DKNG divided by the {int(r.othersDkngPaid)} DKNG of every other token that pays in DKNG, together, rounded down.</li>
        <li>Tokens are named by their symbol, or by their name when the symbol is also DKNG.</li>
      </ul>}
      figure={<>
        <FigTitle>DKNG paid out by StonkFun tokens that pay rewards in DKNG</FigTitle>
        <HBarChart format={int} labelWidth={180}
          data={top.map((t) => ({ label: t.label, value: t.dkngPaid, highlight: t.mint === ADDR.ALLINU, tip: `${int(t.dkngPaid)} DKNG in ${int(t.payouts)} payments` }))} />
      </>}>
      <p><b className="num">{int(r.dkngPaid)}</b> DKNG, against <span className="num">{int(r.othersDkngPaid)}</span> from the other {int(r.dkngRewardTokens - 1)}.</p>
    </Story>
  );
}

/**
 * How DraftKings holders on Solana got their first DKNG: nearly all as a StonkFun reward airdrop. An airdrop
 * doesn't say which reward token it pays for, so the story shows ALLINU's share of all reward payments beside
 * it, a direct count, rather than an estimate of how many holders got their first DKNG through ALLINU.
 */
function FirstDkng({ d, origins: o }: { d: Snapshot; origins: NonNullable<Snapshot["origins"]> }) {
  const r = d.rewards, reach = d.reach;
  const airdrop = o.shares["Reward airdrop"];
  const trade = o.shares["ALLINU trade"] + o.shares["Another memecoin trade"] + o.shares["Bought DKNG directly"];
  const airdropSquares = Math.round(airdrop * 100), tradeSquares = Math.round(trade * 100);
  const chainPaid = reach ? reach.daily.reduce((a, x) => a + x.dkng, 0) : 0, listPaid = r.dkngPaid / r.shareOfAllDkngPaid;
  return (
    <Story id="holders" label="Holders" stat={pct(airdrop)} claim="of DKNG holders on Solana got their first DKNG as a StonkFun reward payout."
      sources={[o, r, ...(reach ? [reach] : [])]}
      data={<>
        <DataTable caption={`How the ${int(o.size)} wallets holding DKNG first got it`} headers={["First DKNG came from", "Wallets", "Share"]}
          rows={ORIGINS.map((k) => [originLabel(k), int(o.shares[k] * o.size), pct(o.shares[k])])} />
        {reach && payoutsTable(reach)}
      </>}
      method={<>
        <p>Every one of the {int(o.size)} wallets holding DKNG when the trace ran ({time(o.computedAt)}), traced to the transaction that first raised its DKNG balance. A wallet's first DKNG never changes, so each wallet is traced once; later runs trace only new wallets.</p>
        <ul>
          <li>Airdrop rule: the first DKNG came from StonkFun's fee seller or payout wallet, or in a transfer the wallet didn't sign that paid six or more wallets at once.</li>
          <li>An airdrop doesn't say which reward token it pays for. The page does not attribute airdrop-first holders to ALLINU.</li>
          <li>Shown beside it instead, a direct count from StonkFun's public rewards list: {pct(r.shareOfAllDkngPayouts)} of all DKNG reward payments are for ALLINU, and {pct(r.shareOfAllDkngPaid)} of the DKNG paid.</li>
          <li>Of the airdrop-first wallets that held any DKNG reward token when traced, {pct(o.airdropCheck.allinuAmongHolders)} held ALLINU.</li>
          <li>Most hold small amounts: the median wallet holds {o.medianDkng.toFixed(2)} DKNG, and {pct(o.atLeastOneShare)} hold a full share or more.</li>
        </ul>
        {reach && <>
          <p>Wallets reached: the {int(reach.uniqueRecipients)} wallets are every wallet StonkFun has paid DKNG to, for any of the {int(r.dkngRewardTokens)} tokens that pay rewards in DKNG.</p>
          <ul>
            <li>Counted from the chain, those payouts total {int(chainPaid)} DKNG. StonkFun's list, which covers the tokens paying DKNG today, totals {int(listPaid)}: {pct(Math.abs(chainPaid - listPaid) / listPaid)} apart.</li>
            <li>In every payout checked, what StonkFun sent equals what holders received.</li>
          </ul>
        </>}
        <p>The per-day amounts in the headline are estimates. A payout doesn't say which token it is for, so each day's DKNG payouts (every token that pays in DKNG) are scaled to add up to ALLINU's total.</p>
        <p><a href="holder-origins.csv">Download the list</a>: one row per wallet, with the transaction that first gave it DKNG.</p>
      </>}
      figure={<>
        <FigTitle>Every 100 DKNG holders on Solana, by how they first got DKNG</FigTitle>
        <Waffle parts={[
          { count: airdropSquares, label: "a StonkFun reward payout", tone: "allinu" },
          { count: tradeSquares, label: "a trade", tone: "other" },
          { count: Math.max(0, 100 - airdropSquares - tradeSquares), label: "a transfer, or not resolved", tone: "allinu-soft" },
        ]} />
        {reach && <PayoutsToDate d={d} reach={reach} />}
      </>}>
      {reach
        ? <p>StonkFun has sent DKNG rewards to <b className="num">{int(reach.uniqueRecipients)}</b> wallets; <b>{pct(r.shareOfAllDkngPayouts)}</b> of the payments are for ALLINU.</p>
        : <p><b>{pct(r.shareOfAllDkngPayouts)}</b> of StonkFun's DKNG reward payments are for ALLINU.</p>}
    </Story>
  );
}

/** Without the traced holders, the rewards story stands alone. */
function RewardShare({ d }: { d: Snapshot }) {
  const r = d.rewards, reach = d.reach;
  return (
    <Story id="rewards" label="Rewards" stat={pct(r.shareOfAllDkngPayouts)} claim="of the DraftKings-stock rewards StonkFun pays come from ALLINU."
      sources={[r, ...(reach ? [reach] : [])]}
      data={reach && payoutsTable(reach)}
      method={<>
        <p>From StonkFun's public rewards list, which covers every token that pays rewards in DKNG. By DKNG amount, ALLINU's share is {pct(r.shareOfAllDkngPaid)}.</p>
        <p>The per-day amounts in the headline are estimates. A payout doesn't say which token it is for, so each day's DKNG payouts (every token that pays in DKNG) are scaled to add up to ALLINU's total.</p>
      </>}
      figure={<>
        <FigTitle>Every 100 DKNG reward payments</FigTitle>
        <Waffle parts={[
          { count: Math.round(r.shareOfAllDkngPayouts * 100), label: "paid for ALLINU", tone: "allinu" },
          { count: 100 - Math.round(r.shareOfAllDkngPayouts * 100), label: `paid for the other ${int(r.dkngRewardTokens - 1)} tokens that pay in DKNG`, tone: "other" },
        ]} />
        {reach && <PayoutsToDate d={d} reach={reach} />}
      </>}>
      <p>Out of {int(r.dkngRewardTokens)} tokens StonkFun pays DKNG rewards for.</p>
    </Story>
  );
}

/** Names a DKNG holding: the ALLINU pool by its vault, another pool when its vault's owner is a listed pool. */
const holdingName = (d: Snapshot, s: NonNullable<Snapshot["supply"]>) => (h: { account: string; owner: string | null }) => {
  if (h.account === s.allinuPoolVault) return "ALLINU";
  const pool = d.pools.top.find((p) => p.address === h.owner);
  if (pool) return `${pool.pair} (${pool.address.slice(0, 4)}…)`;
  return `holder (${(h.owner ?? h.account).slice(0, 4)}…)`;
};

function Supply({ d, supply: s }: { d: Snapshot; supply: NonNullable<Snapshot["supply"]> }) {
  const holdingLabel = holdingName(d, s);
  return (
    <Story id="supply" label="Supply" stat={pct(s.allinuPoolDkng / s.supplyNow)} claim="of all tokenized DraftKings on Solana sits in the ALLINU/DKNG pool."
      sources={[s]}
      data={<>
        <DataTable caption="The largest DKNG holdings on Solana (pools named by their pair)" headers={["Holding", "DKNG", "Of all DKNG"]}
          rows={s.largestHoldings.map((h) => [holdingLabel(h), int(h.dkng), pct(h.dkng / s.supplyNow)])} />
        <DataTable caption="DKNG mints and burns per UTC day" headers={["Day (UTC)", "Minted", "Burned", "Supply, end of day"]} rows={s.daily.map((x) => [day(x.d), int(x.minted), int(x.burned), int(x.supply)])} />
      </>}
      method={<>
        <p>A pool's DKNG sits in its vault account. The ALLINU/DKNG pool's vault held {int(s.allinuPoolDkng)} of the {int(s.supplyNow)} DKNG on Solana, read in the same run as the supply.</p>
        <ul>
          <li>The largest holdings are Solana's largest DKNG token accounts. A holding is named as a pool when its vault's owner is a pool GeckoTerminal lists.</li>
          <li>Per <a href="https://support.backpack.exchange/backpack-securities/tokenized-securities" target="_blank" rel="noopener">Backpack</a>, eligible users can redeem each token 1:1 for the underlying share. Tokens are minted when shares come onchain and burned when they leave.</li>
          <li>Since Sep 11: {int(s.mintedSinceLaunch)} minted, {int(s.burnedSinceLaunch)} burned, counted from every mint and burn in the mint authority's transactions.</li>
          <li>Check: walking back from today's supply through those mints and burns lands at {s.startSupply.toFixed(1)} DKNG before the first mint, not exactly 0, because holders can burn their own tokens without the issuer.</li>
        </ul>
      </>}
      figure={<>
        <FigTitle>The largest DKNG holdings on Solana, in DKNG</FigTitle>
        <HBarChart format={int} labelWidth={150}
          data={s.largestHoldings.slice(0, 5).map((h) => ({ label: holdingLabel(h), value: h.dkng, highlight: h.account === s.allinuPoolVault, tip: `${int(h.dkng)} DKNG, ${pct(h.dkng / s.supplyNow)} of all DKNG on Solana` }))} />
      </>}>
      <p>{s.allinuHoldingRank === 1 ? "The largest single holding, ahead of every other pool." : <><b className="num">{int(s.allinuPoolDkng)}</b> of <span className="num">{int(s.supplyNow)}</span> DKNG{s.allinuHoldingRank ? `, the #${s.allinuHoldingRank} DKNG holding on Solana` : ""}.</>}</p>
    </Story>
  );
}

// ---------- check every number ----------

function Proof({ d }: { d: Snapshot }) {
  const { open } = useMethodology();
  const [pngOpen, setPngOpen] = useState(false);
  const date = new Date(d.computedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const addresses: (readonly [string, string, "token" | "account"])[] = [
    ["DKNG, tokenized DraftKings", ADDR.DKNG, "token"],
    ["ALLINU", ADDR.ALLINU, "token"],
    ["ALLINU/DKNG pool", ADDR.ALLINU_DKNG_POOL, "account"],
    ["StonkFun fee collector and seller", ADDR.FEE_SELLER, "account"],
    ["StonkFun payout wallet (all reward assets)", ADDR.PAYOUT_WALLET, "account"],
    ...(d.supply ? [["DKNG mint authority", d.supply.mintAuthority, "account"] as const] : []),
  ];
  return (
    <section className="proof no-capture" id="proof" aria-labelledby="proof-h">
      <div className="wrap proof-grid">
        <div>
          <h2 id="proof-h">Open data, open code.</h2>
          <p>Every number on this page comes from public onchain data and public APIs, computed by open-source code you can read, run and verify yourself.</p>
          <div className="proof-actions">
            <a className="button" href={REPO} target="_blank" rel="noopener"><GitHubIcon /> View the code</a>
            <button type="button" className="button ghost" onClick={() => open()}>How it's measured</button>
            <button type="button" className="button ghost" onClick={() => setPngOpen(true)} aria-label="Download the page as a PNG image" title="Download the page as a PNG image">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
              PNG
            </button>
          </div>
          <PngDialog open={pngOpen} onClose={() => setPngOpen(false)} fileName={`allinu-dkng-stats-${d.computedAt.slice(0, 10)}.png`}
            caption={`Data as of ${date} · Independent community page · Computed from public data by open-source code anyone can verify · Not financial advice`} />
        </div>
        <dl className="addr">
          {addresses.map(([name, a, kind]) => (
            <div key={a}><dt>{name}</dt><dd className="mono"><a href={`https://solscan.io/${kind}/${a}`} target="_blank" rel="noopener" title={a}>{a}</a></dd></div>
          ))}
        </dl>
      </div>
    </section>
  );
}
