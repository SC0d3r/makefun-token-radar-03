# Build brief: Launch Ledger

## What we are building

A make.fun token-radar-01 entry. `main.ts` at the repository root reads the sealed snapshot at `/input/snapshot.json` (or `--input`), ranks pre-token protocols by an implied value, writes `board.json` and `data.js` to `/output`, copies `dashboard/` and `screenshots/`, and writes `dossier.json` with `buildDossier` from `vendor/makefun-board.ts`.

The dashboard is a static page with no network. The judge reads three screenshots and the source text of `dashboard/` only, so the value model must be implemented and explained in `dashboard/model.js` and `dashboard/app.js`, not hidden in `main.ts`.

The starter in this repository is a working but ordinary entry. Replace its model, page and farm plans. Keep the gate shape: `main.ts` at the root, `dashboard/index.html`, at least one `.css` and one `.js` under `dashboard/`, `screenshots/`, `vendor/makefun-board.ts`, `LICENSE`.

## Files to write

- `dashboard/model.js` - a classic script (IIFE) that assigns `globalThis.RadarModel`. Pure functions, no DOM. It must also load in Node when imported for its side effect.
- `dashboard/app.js` - a classic script. Reads `window.RADAR` (written to `../data.js`) and `window.RadarModel`, renders the page.
- `dashboard/index.html` - shell. Loads `../data.js`, then `model.js`, then `app.js`, in that order.
- `dashboard/app.css` - the whole visual system.
- `main.ts` - imports `./dashboard/model.js` for its side effect, reads `globalThis.RadarModel`, writes the outputs.
- Delete `lib/model.ts` after `main.ts` stops importing it.

## The snapshot

Fields: `as_of`, `floor_usd`, `protocols` (758 objects: `slug`, `name`, `category`, `chains`, `tvl_usd`, `change_7d`, `mcap_usd`, `listed_at`, `gecko_id`, `symbol`), `watchlist` (40 slugs).

- Pre-token: `mcap_usd === null && gecko_id === null && symbol === null` (342 protocols).
- Live token: `mcap_usd !== null` (144 protocols).
- The board must hold 40 watchlist rows plus 160 early rows, 200 in all.
- Early pool: pre-token protocols not on the watchlist. Candidate score is `tvl_usd` times a penalty of 0.25 when the category is CEX, Chain, Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or Stablecoin Wrapper, when the name begins with Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex or Gemini, or when the name carries the word wrapped, staked or staking in any case. Take the top 160 by candidate score. This keeps 200 rows while pushing non-candidates down the ranking.
- Every board row: `slug`, `name`, `rank`, `implied_value_usd`, `farm_steps` (8 strings, each 20 to 600 characters).

## The model

Write these functions in `dashboard/model.js` with a short comment on each:

- `median(values)`, `quantile(values, p)`, `clamp(x, lo, hi)`.
- `fitSizeCurve(comps)` - Theil-Sen on `log10(tvl_usd)` against `log10(mcap_usd / tvl_usd)`: for every pair of comps with a log-TVL gap above 0.05, take the slope, then use the median slope and the median intercept. Return `{ slope, intercept, n }`. The predicted multiple is clamped to 0.02 to 8.
- `sectorEffects(comps, curve)` - each comp's residual is `log10(multiple) - (intercept + slope * log10(tvl))`. For each category, take the median residual and shrink it by `n / (n + 4)`, then clamp the effect to -0.26 to 0.26 (0.55x to 1.8x). Return a map.
- `growthFactor(change_7d, sectorMedian)` - 1 when null. Otherwise `excess = change_7d - sectorMedian`, then `clamp(1 + clamp(excess, -40, 60) / 100 * 0.5, 0.7, 1.4)`.
- `ageFactor(ageDays)` - `0.85 + 0.15 * clamp(ageDays, 0, 1460) / 1460`; unknown age uses 0.9.
- `chainFactor(count)` - `1 + min(0.02 * (count - 1), 0.10)`.
- `impliedValue(row, model)` - `tvl_usd * sizeMult * sectorMult * growthMult * ageMult * chainMult`, rounded, at least 1.
- `rangeOf(implied, band)` - `{ low: round(implied / 10^band), high: round(implied * 10^band) }`. The band comes from the comp residuals' interquartile range: `max(0.15, min(0.6, 1.5 * iqr / 1.349))`.
- `buildRadar(snapshot)` - comps are live protocols with `tvl_usd >= 1e6` and a positive multiple. Compute the curve, the sector effects, the median seven-day growth per category, and the band. Score every pre-token protocol, sort by implied value descending, assign ranks 1 to 200, and keep on each row the TVL, seven-day change, age in days, category, chains, each multiplier, the implied low and high, and the farm verdict.
- `backtest(snapshot)` - leave-one-out over the comps: for each comp, fit the curve and sector effects on the other comps, predict its market cap, and count how often the actual cap falls inside the range. Then sort the comps by `listed_at`, fit on the oldest 60 percent, test the newest 40 percent. Return `{ loo: { n, inside, share, medianError }, newer: { n, inside, share, medianError }, band }`, with `medianError` the median absolute `log10(actual / predicted)`.
- `farmPlan(row)` - returns `{ steps, ticket, gas, cost, hours, expected, net, perHour, verdict, play, windowDays }`.

Farm plan rules:

- The play follows the category: Lending (supply collateral, borrow 30 percent, farm points), Dexs (two-asset LP), Yield (vault deposit), RWA (subscribe), Basis Trading (basis trade), Restaking (restake), Risk Curators (curate), Onchain Capital Allocator (allocate), CDP (mint), Derivatives (hedge), Payments (merchant), Insurance (cover), anything else (hold).
- Chain gas in dollars: Ethereum 18, Arbitrum 0.6, Base 0.4, Optimism 0.5, Polygon 0.1, Solana 0.02, BSC 0.3, Avalanche 0.4, Sui 0.05, Aptos 0.05, anything else 1.
- Ticket: 2500, or 500 when the row's TVL is below 5 million.
- Expected value at launch: `implied_value_usd * 0.015` (a 1.5 percent community allocation at the implied value).
- Cost: `gas * 4 + 4` bridge plus `ticket * 0.003` slippage.
- Hours: 2.2. Net: expected minus cost. `perHour`: net divided by hours.
- Verdict: FARM when `perHour >= 25 && net > 0`; THIN when `net > 0`; SKIP otherwise.
- `windowDays`: 90.
- The eight steps are: verify the snapshot and the protocol's own docs; bridge and fund; enter the position; qualify (hold and transact weekly); upkeep (weekly check); stop rule (exit if TVL drops 20 percent or seven-day growth is below -30); exit (unwind); claim (if a token launches). Each step string ends with `Cost: $X. Time: Y min.` and names the concrete action for the play.

## The page

Visual system:

- Palette: bone `#f4efe4`, ink `#15181b`, muted `#6f6a60`, rule `#d8d0bf`, vermilion `#cf4b28`, forest `#2f6b4f`, sand `#e8dfcc`.
- Type: Georgia, Times New Roman, serif for display; system-ui for UI; ui-monospace, SFMono-Regular, Menlo for numbers.
- Max width 1400px, 24px gutters, 8px rhythm. One-pixel rules, no rounded cards, no shadows, no gradients.
- Top bar: 56px ink background, bone text. Wordmark "LAUNCH LEDGER" in Georgia 20px, letter-spacing 0.08em, with a 10px vermilion square. Nav: Board, Detail, Planner, Set aside. Right: "DefiLlama 2026-11-14" in mono 11px, outlined pills "watchlist 40/40" and "checkBoard 200/200".
- Hero: two columns. Left: h1 "What a token would be worth" in Georgia 42px, and a sub-line "758 protocols scanned, 342 pre-token, 40 on the watchlist, 144 live tokens set aside". Right: four KPI tiles: "Watchlist covered 40/40", "Pre-token ranked 200", "Median live multiple 0.17x", "Blind test 62% in range" (use the real backtest number).
- Main grid: `1fr 400px`, gap 28px. Left: filter bar and table. Right: sidebar.
- Filter bar: search input, selects for Sector, Chain and Growth, a "Farms only" checkbox, a Clear button, and a count "200 of 200 rows".
- Table: sticky header; columns #, Protocol, TVL, 7d, No token, Size curve, Implied value, Farm. Row height 34px. Protocol name bold 13px with a gray sub-line "Category, chain1, chain2". TVL right-aligned mono. Seven-day change green or red. Age "1.7 y" or "86 d". Size curve "3.2x". Implied value bold mono with a range sub-line "$2.2M to $103M" and a thin bar. Farm verdict chip FARM (forest), THIN (sand and ink), SKIP (muted), with "$32/h".
- Sidebar: three stacked panels separated by rules. (1) "Value ladder": the top ten rows as horizontal bars on a log scale with name and implied value. (2) "How implied value is built": the formula in mono, `implied = TVL x sizeCurve(TVL) x sector x growth x age x chains`, and six factor chips. (3) "Blind tests": two coverage bars for the leave-one-out and the newer-half tests, the median error, and the line "checkBoard(): 200/200 rows recomputed = board.json".
- Detail page at `#/p/<slug>`: top bar, back link, h1 name, sub-line "Rank N of 200, Category, chains, TVL $X, no token on record for Y days". Right: the implied value at 40px mono and its range. Two columns. Left: a factor waterfall with seven rows (TVL, Size curve, Sector, 7d growth, Time with no token, Chains, Implied value), each with a label, a short sub-line, a bar and a value. Then "Nearest comps": a dot strip on a log axis with the implied range band, and a table of three comps. Right: the farm plan as a vertical timeline of eight steps with name, day offset, cost and time; a cost table with a total; four KPI tiles (expected at launch, cost, net, net per hour); and a risk note.
- Planner at `#/planner`: h1 "Campaign planner". Controls: capital range 5000 to 50000, hours range 1 to 10. Summary tiles: capital deployed, cost, expected, net, net per hour. Table of the top ten farms by net per hour with rank, protocol, play, ticket, cost, hours, expected, net and per hour, plus a totals row.
- Set aside at `#/aside`: a table of live tokens with name, TVL, market cap, multiple and category, and a short note that they are separated from the ranking.

Interaction:

- Clicking a column header sorts by TVL, seven-day change, age, size curve, implied value or net per hour, toggling direction.
- Filters update the count and the table; search matches name, slug, category and chain.
- A row opens its detail; back returns to the board.
- No external fonts, no network, no `http://` or `https://` in attributes, CSS or JavaScript imports.

## Acceptance checks

- `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json` writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`.
- `board.json` has 200 rows, ranks 1 to 200 once each, implied values non-increasing, all 40 watchlist slugs present, and every `farm_steps` array holds 3 to 12 strings of 20 to 600 characters.
- The page renders from `file://` with no console errors, and every number on it comes from `data.js`.
- The `dashboard/` source totals under 60000 bytes.
- Two runs write identical bytes: no `Date.now`, no `Math.random`.

## Steps, in order

1. Write `dashboard/model.js`. Run `node --check dashboard/model.js`. Report the functions and the byte count.
2. Write `main.ts`. Run it on `input/snapshot.json`. Fix errors. Report the row count, the watchlist coverage, the top three rows and the backtest numbers.
3. Write `dashboard/index.html`, `dashboard/app.css` and `dashboard/app.js`. Run the program again. Report the dashboard byte count.
4. Run `node --check` on the dashboard scripts. If a headless browser is available, open `out/dashboard/index.html` and report console errors. Fix them.
5. Stop and report the final state: files, bytes, board checks, backtest numbers and anything unfinished.

Do not invent data. If a number cannot be computed, say so.
