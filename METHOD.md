# Launch Ledger: method note

Launch Ledger ranks protocols that have no token by what a token might be worth, then prices the work of
farming one. Every figure below is computed by `dashboard/model.js` and printed by `node main.ts --input
input/snapshot.json`. The model block lives in `data.js` as `window.RADAR.model`; `board.json` holds the
200 published rows.
## 1. The snapshot
| Field | Value |
|---|---|
| `as_of` | 2026-11-14 |
| Protocols scanned | 758 |
| Pre-token (no cap, no CoinGecko id, no symbol) | 342 |
| Live token (`mcap_usd !== null`) | 144 |
| Watchlist slugs | 40 |
| `floor_usd` | $50,000,000 |
| Value-leg comps (dated live tokens, TVL >= $1M) | 87 |
| Odds-leg rows (all protocols, TVL >= $1M) | 624 |

Exchanges (`category === "CEX"`) and versioned pool names (`... V2`, `... 3.1`) are removed from both training sets; the value leg also needs a positive market cap and a `listed_at` date.
## 2. Board shape
| Part | Rows | Rule |
|---|---:|---|
| Watchlist | 40 | every slug in `snapshot.watchlist`, joined back to its protocol |
| Early | 160 | pre-token, not watchlisted, rankable, TVL below the $50M floor, top 160 by TVL |
| Board | 200 | both sets scored, sorted by implied value descending, ties by slug, sliced to 200 |

Rankable means pre-token, not CEX, and not a versioned pool of another protocol. Ranks 1 to 200 are assigned after the sort. The build prints `board 200 rows, 160 early, 40/40 watchlist, checkBoard 200/200`; the board spans 33 sectors and 115 chains.
## 3. The value leg
The leg predicts a live token's market cap from its TVL, then adds a shrunk sector residual. It is fit by ordinary least squares on 87 dated comps:

```
log10(mcap_usd) = 4.193979 + 0.364861 * log10(tvl_usd) + sector_effect[category]
multiple        = 10^(4.193979 - 0.635139 * log10(tvl_usd)) * 10^sector_effect
```

| Term | Coefficient | Reading |
|---|---:|---|
| Intercept | 4.193979 | at $1M TVL the base cap is about $2.4M, a 2.4x multiple |
| `log10(tvl_usd)` | 0.364861 | each 10x of TVL adds 0.365 to log cap; the multiple falls with size |
| Sector effect | median residual x n/(n+16) | shrunk toward zero, strongest for thin categories |

Sector effects are the median residual per category, multiplied by `n / (n + 16)` where `n` is the category's comp count. There is no hard clamp in the shipped model. The range runs from Liquid Staking at -0.189724 (0.65x) to Prediction Market at +0.161187 (1.45x); RWA is +0.072859 (1.19x), Dexs +0.012696 (1.03x) and Lending -0.069351 (0.85x).

| Category | Effect (log10) | Multiplier |
|---|---:|---:|
| Prediction Market | +0.161187 | 1.45x |
| Risk Curators | +0.045326 | 1.11x |
| Liquid Staking | -0.189724 | 0.65x |

Growth, age and chain count are implemented as candidate terms but are not in the published fit. Each is tested by leave-one-out and by a walk-forward split: the oldest 60 percent of comps train, the newest 35 comps test. A term is kept only when both errors are no worse than the last kept term.

| Term | Leave-one-out | Walk-forward | Kept |
|---|---:|---:|---|
| Flat control (one median multiple) | 0.650979 | 0.685314 | no |
| `log10(TVL)` | 0.489212 | 0.342914 | yes |
| `+ sector, k=16` | 0.479330 | 0.333949 | yes |
| `+ chains` | 0.463214 | 0.388053 | no |
| `+ growth` | 0.490752 | 0.321786 | no |
| `+ age` | 0.440140 | 0.449199 | no |

Errors are median absolute `log10(actual / predicted)`. The shipped value leg therefore scores **3.02x** leave-one-out and **2.16x** walk-forward (`10^0.479330` and `10^0.333949`). Chains and age improve one split but not both; growth improves the walk-forward but loses leave-one-out.
## 4. The odds leg
The odds leg estimates whether a protocol ever gets a token. It is a ridge logistic regression (ridge 4, intercept unpenalised, 40 Newton steps) on 624 protocols at or above $1M TVL. Features are standardised:

```
z_age  = (log1p(age_days / 365) - 0.841573) / 0.559849
z_size = (log10(tvl_usd) - 7.653372) / 0.722533
logit  = -0.304687 + 1.011324 * z_age + 1.629266 * age_missing + 0.183899 * z_size
```

| Term | Coefficient | Reading |
|---|---:|---|
| Intercept | -0.304687 | base log-odds before age and size |
| Age (z) | +1.011324 | each SD of extra tokenless time raises the odds |
| Age missing | +1.629266 | a missing listing date is treated as old |
| Size (z) | +0.183899 | larger TVL raises the odds only slightly |
| Base rate | 0.536859 | 335 of 624 rows have a token |

The leg is tested by ten-fold cross-validation and by training on the oldest 60 percent of rows with a known age and testing the newest 213. Lower Brier is better.

| Term | 10-fold Brier | Newest-40% Brier | Kept |
|---|---:|---:|---|
| Base rate | 0.250239 | 0.300793 | no |
| `+ age` | 0.207981 | 0.252863 | yes |
| `+ size` | 0.206887 | 0.252033 | yes |
| `+ growth` | 0.209273 | 0.251805 | no |

The shipped odds leg is age plus size: **Brier 0.207** in ten-fold and **0.252** walk-forward. Growth is rejected because its ten-fold Brier is worse than the kept size term even though its walk-forward score is marginally better.
## 5. Implied value and the P25-P75 band
The two legs multiply, and the result is floored at $1:

```
if_launched    = 10^(4.193979 + 0.364861 * log10(TVL) + sector_effect)
odds           = logistic(age, TVL)
implied_value  = max(1, round(if_launched * odds))
```

The published range is the value leg's own leave-one-out residual quantiles, not a normal interval:

| Quantile | Log residual | Multiplier | Coverage (LOO / newest 40%) |
|---|---:|---:|---:|
| P25 | -0.486357 | 0.326x | 49.4% / 51.4% |
| P75 | +0.448502 | 2.808x | 49.4% / 51.4% |

`implied_low = round(implied * 10^P25)` and `implied_high = round(implied * 10^P75)`. A wider P10-P90
pair is kept as `tail_low` and `tail_high` (-1.027174 and +0.892462, or 0.094x and 7.807x); it covers
79.3 percent of comps leave-one-out and 71.4 percent walk-forward. The band is empirical: a 50 percent
interval covers about half the comps out of sample, so it is honest rather than decorative.

| Row 1 | Value |
|---|---:|
| Protocol | Steakhouse Financial, Risk Curators, Base |
| TVL / time with no token | $2,753,981,495 / 543 days |
| If launched | $48,258,857 |
| Odds | 0.568584 |
| Implied value | $27,439,214 |
| P25-P75 range | $8,953,959 to $77,067,922 |
| P10-P90 tail | $2,577,497 to $214,206,982 |

Across the 144 live tokens the median cap/TVL multiple is **0.17x** (quartiles 0.03x and 1.00x). Across
the 200 board rows implied value runs from **$634,199** to **$27,439,214**.
## 6. The five-group ledger
Every one of the 758 protocols is counted once, in this precedence order: CEX, versioned name, on the
board, pre-token, live token.

| Group | Count |
|---|---:|
| `ranked` (on the board) | 200 |
| `token` (live token, not on the board) | 335 |
| `pre` (pre-token, not on the board) | 89 |
| `cex` | 56 |
| `versioned` | 78 |
| **Sum** | **758** |

`ledger_balanced` is true and `ledger_sum` equals `scanned`. `token` is larger than the 144 live tokens
with a market cap because it also holds protocols with a token but no cap, below $1M TVL, or excluded
from training.
## 7. The farm plan
Each row gets one ticket from $500, $1,000, $2,500, $5,000 or $10,000, capped at 1 percent of TVL. The
plan picks the smallest ticket that clears net > 0 and $25/hour inside the cap; if none clears, it keeps
the largest ticket under the cap. Expected value assumes a 3 percent community pool at the implied value:

| Leg | Rule | SyncSwap (#89) |
|---|---|---:|
| Expected | `ticket * implied / TVL * 0.03` | $143.61 |
| Bridge | `gas * 4 + 4` (Polygon gas $0.10) | $4.40 |
| Slippage | `ticket * 0.003` | $30.00 |
| Cost | bridge + slippage | $34.40 |
| Hours | fixed 2.2 (eight steps, 132 minutes) | 2.2 |
| Net | expected - cost | $109.21 |
| Per hour | net / 2.2 | $49.64 |

The verdict is mechanical: **FARM** when `perHour >= 25 && net > 0`, **THIN** when `net > 0`, **SKIP**
otherwise. The board splits 14 FARM, 56 THIN and 130 SKIP. Median per-hour is -$5.10; the best is $49.64
and the worst -$46.75. Tickets in use are $10,000 on 198 rows and $5,000 on 2 rows.

The eight steps are: read terms; bridge and fund; enter the play; qualify weekly for 90 days; upkeep;
stop check; exit; claim if a token launches. The play follows the category (Lending supplies and borrows
30 percent, Dexs runs a two-asset LP, RWA subscribes, CDP mints, and so on); unmapped categories hold.
Step minutes are 15, 15, 15, 30, 15, 12, 15, 15. Each step string ends with `Cost: $X. Time: Y min.`

The top of the board can still be SKIP. Steakhouse has $27.4M of implied value on $2.75B of TVL, only
1.0 percent of TVL; a $10,000 ticket earns $2.99 expected against $35.60 of cost, or -$14.82/hour. The
FARM rows sit lower, where implied value is a larger fraction of TVL: SyncSwap has $3.48M on $7.27M.
## 8. Stop rule and exit
The 90-day window assumes weekly activity so every snapshot credits the position. Step six is the stop
rule: exit if TVL falls 20 percent below the entry TVL or seven-day growth drops below -30 percent.
Step seven unwinds to a stable asset on the entry chain. The plan never pays to claim: step eight says
to claim only from the protocol's official page.
## 9. Build and test

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
node --check dashboard/model.js
node --check dashboard/app.js
```

There is no separate test runner or `package.json`. `main.ts` is the gate: `boardIssue()` refuses a board
that is not 200 rows, whose ranks are not 1 to 200 exactly once, whose implied values rise, whose steps
are outside 3 to 12 strings of 20 to 600 characters, or that misses a watchlist slug. It also refuses a
`checkBoard` mismatch. The run prints the value and odds test numbers quoted above. Two runs write
identical bytes because the model uses no clock and no randomness.
## 10. Screenshot and dossier limits
| Artefact | Limit | Actual |
|---|---:|---:|
| Screenshots | at most 4, 524,288 bytes each | 3 images: 276,397 / 193,537 / 277,822 bytes |
| Dossier text | 65,536 bytes | 65,520 bytes |
| Dashboard files | 400 files, 4,194,304 bytes | 4 files, 66,025 bytes |
| Brief's dashboard source cap | 60,000 bytes | 66,025 bytes (6,025 over) |

The dossier text sits 16 bytes under its cap, so any added prose must displace existing text. The
dashboard source is over the 60,000-byte figure named in the build brief; that is a real gap, not a
rounding artefact, and it is left unchanged here because this note does not edit code. For reference,
`board.json` is 206,664 bytes, `data.js` 623,548 bytes and `dossier.json` 1,064,165 bytes.
## 11. Files
`dashboard/model.js` holds both legs, the band, selection, farm plans, ledger and checks; `dashboard/app.js` renders the board, detail, planner and set-aside views from `window.RADAR`.
`dashboard/index.html` loads `../data.js`, then `model.js`, then `app.js`; `dashboard/app.css` is the whole visual system. `main.ts` reads the snapshot, calls the model, writes the outputs and runs the gate.
`out/board.json` is the 200 gated rows, `out/data.js` is `window.RADAR` with the model block, tests, ledger, rows and live tokens, and `out/dossier.json` carries the cover, screenshots, schema and source text the judge reads.

The model is deterministic and self-contained: no network, no external fonts, no `Date.now`, no
`Math.random`. Every number on the page is read from `data.js`; the page recomputes implied value from
the stored coefficients and checks it against the published row.
