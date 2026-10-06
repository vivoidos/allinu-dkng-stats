# AGENTS.md

Guide for AI coding agents (and humans) working in this repository.

## What this is

An independent, unofficial community stats page about **$ALLINU**, a Solana memecoin launched on StonkFun and paired with
**tokenized DraftKings stock ($DKNG)** issued by Backpack Securities. Every ALLINU transfer pays a
1% fee; StonkFun sells it for DKNG and pays that DKNG out to ALLINU holders. The page shows how much
has been paid, ALLINU's share of all DKNG rewards, DKNG holders, supply, liquidity and trading on Solana.

Every number is computed by the code in this repo from public sources, and nothing else:

- the Solana chain, through free public RPC endpoints
- StonkFun's public API: `https://www.stonkfun.xyz/api/public/v1`
- GeckoTerminal's public API: `https://api.geckoterminal.com/api/v2`
- Birdeye, optionally, for hourly pool volume (`BIRDEYE_API_KEY`)

## Layout

```
src/core/            the data code: dependency-free, runs on bare Node
  stats/            every number, one file per block (rewards, holders, pools, payouts, supply, volume, origins,
                    routed), each naming its source; shared.ts holds what several blocks use, index.ts the
                    Snapshot type and the exports; nasdaq.ts holds Nasdaq's trading calendar
  solana.ts         minimal Solana RPC client: endpoint rotation, response types, base58 / u64 parsing
  http.ts           fetching: per-source pacing, 429 back-off, retries, a small parallel map
  cache.ts          saves what slow blocks read (snapshots/cache/, one file per day, written atomically)
src/ui/             the page: React + TanStack Query, built with Vite; it only reads snapshot.json
scripts/snapshot.ts CLI: runs the blocks, writes snapshots/snapshot.json (+ holder-origins.csv), prints RESULT lines
snapshots/          the output: snapshot.json (the numbers the page shows, with when and by which code they
                    were computed) and holder-origins.csv, served at the site root; cache/ (not committed)
                    keeps what the slow blocks read from the chain
public/             static images (favicon, hero photos, social preview)
.github/workflows/snapshot.yml   computes the snapshot on GitHub Actions, checks the page builds, commits it
```

## Commands

```sh
node scripts/snapshot.ts                   # compute every default block (Node 22.18+, no install, no keys)
node scripts/snapshot.ts --only supply     # one or more blocks; the rest of snapshot.json is kept
node scripts/snapshot.ts --with origins,reach,routed   # also the slow blocks (the daily run does this)
SOLANA_RPC_URL=<any Solana RPC> node scripts/snapshot.ts   # one faster endpoint instead of the public rotation (or .env)
                                                           # with getTransactionsForAddress: minutes once the cache is warm

pnpm install       # page dependencies (pinned; pnpm-workspace.yaml refuses versions under 7 days old)
pnpm dev           # local page at http://localhost:5173
pnpm typecheck     # strict TypeScript over everything
pnpm build         # typecheck + build the page into dist/
```

Blocks: `rewards`, `holders`, `pools`, `supply`, `volume`, `origins`, `reach`, `routed`.

`routed` reads every ALLINU-pool transaction (over a million) to find the DKNG volume ALLINU trades push through
other pools. It needs an RPC with `getTransactionsForAddress` and saves each finished UTC day in `snapshots/cache/` (not
committed), so later runs only read new days. `ROUTED_DAYS=2026-09-20` limits a run to chosen days;
`ROUTED_MAX_TRANSACTIONS` caps how many it reads (default 2,000,000). A trial run with `ROUTED_DAYS` leaves the
snapshot's routed block alone. Each cached day carries `ROUTED_RULE` (in `src/core/stats/routed.ts`): bump it whenever
`routedDkng()` changes, or old days are reused under the old rule. A day is cached only once it is an hour old.

How sound the rule is (checked 2026-10-03): in a DKNG-weighted sample of 1,800 cached routed transactions,
99.7% of the counted DKNG sat in accounts whose owner swapped another token the opposite way in the same
transaction while the ALLINU vault moved, i.e. real other-pool legs (mostly Raydium CLMM and Meteora DLMM
pools); ~0.3% didn't, about 0.1 point of the share.

A block that throws keeps its previous numbers and the run carries on; the log ends with the failed blocks, and on
GitHub Actions each failure is also flagged as a warning in the run summary. RESULT lines mark numbers carried over
from an earlier run.

## Rules

- **`snapshot.json` is written only by `scripts/snapshot.ts`.** Never edit a number by hand, and never put a
  number on the page that doesn't come from the snapshot.
- **The data code stays dependency-free.** Everything in `src/core/` and
  `scripts/snapshot.ts` must run on bare Node with no `npm install`. Node runs them by stripping the types, so
  use erasable TypeScript only (no `enum`, `namespace`, or constructor parameter properties) and import
  local files with their `.ts` extension.
- **No keys in the repo.** Every default block works keyless. A private RPC goes in `SOLANA_RPC_URL` (a local `.env`, or an
  Actions secret on CI); it must never be written to the snapshot or printed in logs or errors.
- **Never trade correctness for speed.** Unreadable transactions are retried, counted and reported; more
  than 1% (and more than 2) fails the block instead of quietly producing a smaller number.
- Keep copy factual and plain. State what a number measures and its caveats; no hype.

## Things that will bite you

- **Only the Solana Foundation endpoints have full history.** Other free endpoints answer
  `getSignaturesForAddress` with just the last day or two, *without an error*. `solana.ts` therefore
  sends history and token-account calls only to the Foundation endpoints, and uses the others just for
  single-transaction lookups. A "not found" transaction is only believed from a full-history endpoint.
- **`getTransactionsForAddress` is not standard Solana RPC.** Several RPC providers answer it
  with whole transactions, 100 per call; `solana.ts` asks once whether the `SOLANA_RPC_URL` endpoint does and
  otherwise reads transaction by transaction. Both routes must give the same numbers. Holder origins always reads
  one by one: it needs a wallet's first one or two transactions, and a page costs more than that on metered plans.
- **The public Solana endpoint returns 403 to browsers** (any request with an `Origin` header). That is why
  the page reads a snapshot instead of querying the chain.
- **GeckoTerminal's free tier allows about 30 calls a minute.** The volume block takes ~10 minutes for that
  reason, and runs alongside the Solana blocks.
- Some numbers are scoped deliberately: payouts and reach cover *all* DKNG reward tokens on StonkFun
  (a payout transaction doesn't say which token it is for); holder origins reports the share that got its first DKNG as a StonkFun airdrop and does not attribute airdrops to ALLINU (ALLINU's share of payments is shown beside it, from StonkFun's list); volume
  counts a trade routed through several pools once in each pool. Each says so in its section of the page's "Data & methodology" dialog.

## Adding a number

1. Add a file in `src/core/stats/` with one exported function, naming its source in a header comment and in a
   `sources` list; helpers several blocks need go in `shared.ts`. Export it from `index.ts`.
2. Add it as a block in `scripts/snapshot.ts` (and a `RESULT` log line) and to the `Snapshot` type.
3. Show it in `src/ui/App.tsx` as a `Story`, reading only from the snapshot: its `method`, `data` and `sources` fill its section of the methodology dialog.
4. `pnpm typecheck`, then `node scripts/snapshot.ts --only <block>` and check the page with `pnpm dev`.
