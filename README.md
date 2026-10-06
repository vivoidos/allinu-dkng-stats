# ALLINU / DKNG stats

An independent, unofficial community page with onchain stats for **$ALLINU**, a Solana memecoin, and **$DKNG**, tokenized DraftKings stock issued by Backpack Securities, which ALLINU holders receive as rewards.

**Live page: https://allinu-dkng-stats.pages.dev**

> Not affiliated with ALLINU, DraftKings, Backpack, StonkFun or anyone else named here. Not financial advice.
> The numbers are computed automatically and may be wrong. See the [disclaimer](#disclaimer).

## What it shows

- DKNG rewards paid out to ALLINU holders, and ALLINU's share of all DKNG rewards on StonkFun
- How every DKNG holder first got their DKNG
- DKNG trading volume on Solana: the ALLINU pool, other pools, and trades routed through ALLINU
- DKNG liquidity by pool, and when DKNG trades relative to Nasdaq's hours
- DKNG supply on Solana: minted, burned and outstanding

Each number on the page comes with a short note on how it is measured and what it leaves out.

## How it works

```
GitHub Actions, daily at 00:00 UTC
  └─ node scripts/snapshot.ts      reads public sources, recomputes the daily blocks
       └─ snapshots/snapshot.json  committed to this repo
            └─ the page is rebuilt from it and redeployed
```

Holder origins, wallets reached and routed volume read hundreds of thousands to millions of transactions, so the
Monday run recomputes them too (`--with origins,reach,routed`); every block in `snapshot.json` records when it was computed.

The page is static: its only data is `snapshot.json` (fonts load from Google Fonts). Each run's public log shows this code
fetching every source and printing the headline numbers (`RESULT …` lines), and the page links to the run that
produced what it shows.

Sources, all public:

- Solana mainnet RPC (free public endpoints by default; any RPC via `SOLANA_RPC_URL`)
- StonkFun public API: `https://www.stonkfun.xyz/api/public/v1`
- GeckoTerminal public API: `https://api.geckoterminal.com/api/v2`
- Birdeye, optionally, for hourly pool volume (`BIRDEYE_API_KEY`)

## Run it yourself

The data code needs only Node 22.18+ (it runs TypeScript directly): no install, no keys.

```sh
node scripts/snapshot.ts                  # every number except the three slow blocks below (about an hour on the free endpoints)
node scripts/snapshot.ts --only supply    # one block (rewards, holders, pools, supply, volume, origins, reach, routed)
node scripts/snapshot.ts --with origins   # also how every holder first got DKNG (traces new wallets only; the rest are cached)
node scripts/snapshot.ts --with reach     # also every wallet ever paid (~50,000 transactions, hours on the free endpoints)
node scripts/snapshot.ts --with routed    # also ALLINU-routed volume in other pools (needs an RPC with
                                          # getTransactionsForAddress; finished days are kept in snapshots/cache/)
```

Put `SOLANA_RPC_URL` (and optionally `BIRDEYE_API_KEY`) in a `.env` file for a faster run; it is never committed.
Run it from a terminal or a server: the public Solana endpoint refuses requests from browsers.

The page:

```sh
pnpm install     # pinned versions; pnpm-workspace.yaml refuses any version under 7 days old
pnpm dev         # local preview
pnpm build       # type-check, then build to dist/
```

## Layout

| Path | What it is |
|---|---|
| `src/core/stats/` | Every calculation, one file per block, each naming its source; `shared.ts` holds the common helpers |
| `src/core/solana.ts`, `http.ts`, `cache.ts` | A minimal Solana RPC client, rate-limited and retrying fetching, and a local cache. No libraries |
| `scripts/snapshot.ts` | Runs the calculations and writes `snapshots/` |
| `snapshots/snapshot.json` | The latest numbers, with each block's sources and when it was computed |
| `snapshots/holder-origins.csv` | How every wallet holding DKNG first got it, one row per wallet |
| `src/ui/` | The page (React, built with Vite) |
| `.github/workflows/snapshot.yml` | The daily run |

## Disclaimer

This is an independent, unofficial community project that displays public onchain data.

- **No affiliation.** It is not affiliated with, endorsed by or sponsored by the ALLINU token or its creators,
  DraftKings Inc., Backpack Securities, StonkFun, Raydium, GeckoTerminal, Birdeye or any other project or company
  named here. Names and trademarks belong to their owners and are used only to identify the assets and data sources.
- **Not advice.** Nothing here is financial, investment, legal or tax advice, or a recommendation or offer to buy,
  sell or hold any token or security. Memecoins and tokenized stocks are highly risky; you can lose all of your money.
  Do your own research.
- **No warranty.** The data and code are provided "as is", without warranty of any kind. Numbers are computed
  automatically from third-party sources that can be wrong, delayed or incomplete, and some rely on estimates and
  sampling. They can be out of date or simply wrong. Don't rely on them for any decision.
- **No liability.** The maintainers accept no liability for any loss or damage arising from the use of this page,
  its data or its code.

## License

The code is released under the [MIT License](LICENSE).
