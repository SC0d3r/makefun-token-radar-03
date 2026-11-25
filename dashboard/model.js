// Launch Ledger's value model: one snapshot in, 200 ranked pre-token rows out.
//   multiple = clamp(10^(intercept + slope*log10(tvl)), .02, 8); sector = clamp(10^shrunk median residual, .55, 1.8)
//   growth = clamp(1 + clamp(change - sector median, -40, 60)/100*.5, .7, 1.4); age = .85 + .15*clamp(days, 0, 1460)/1460
//   chains = 1 + min(.02*(chains - 1), .10); implied = round(tvl*multiple*sector*growth*age*chains)
//   range = implied/10^band .. implied*10^band, band from the comp residual IQR.
// Classic script: assigns globalThis.RadarModel; pure functions, no DOM, no clock, no randomness.
(function () {
'use strict';

var SIZE_MIN = 0.02, SIZE_MAX = 8, SECTOR_DECAY = 4, SECTOR_MIN = -0.26, SECTOR_MAX = 0.26;
var GROWTH_CLAMP_LO = -40, GROWTH_CLAMP_HI = 60, GROWTH_WEIGHT = 0.5, GROWTH_MIN = 0.7, GROWTH_MAX = 1.4;
var AGE_DAYS_MAX = 1460, AGE_FLOOR = 0.85, AGE_RANGE = 0.15, AGE_UNKNOWN = 0.9;
var CHAIN_STEP = 0.02, CHAIN_MAX = 0.1, BAND_FLOOR = 0.15, BAND_CEIL = 0.6, BAND_SCALE = 1.5 / 1.349;
var BOARD_SIZE = 200, EARLY_SIZE = 160;
var TICKETS = [500, 1000, 2500, 5000, 10000], TICKET_CAP = 0.01;
var ALLOCATION = 0.015, HOURS = 2.2, WINDOW_DAYS = 90, FARM_PER_HOUR = 25;
var STEP_MINUTES = [15, 15, 15, 30, 15, 12, 15, 15], STEP_TOTAL = 132;

// Chain gas in dollars for one transaction; anything else is $1.
var GAS = { Ethereum: 18, Arbitrum: 0.6, Base: 0.4, Optimism: 0.5, Polygon: 0.1, Solana: 0.02, BSC: 0.3, Avalanche: 0.4, Sui: 0.05, Aptos: 0.05 };

// DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol.
var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// Category play and the concrete action a farm step names.
var PLAYS = {
Lending: { play: 'Supply / borrow', action: 'supply USDC as collateral, borrow 30 percent against it and farm the points' },
Dexs: { play: 'Two-asset LP', action: 'add a two-asset LP position in the deepest pool' },
Yield: { play: 'Vault deposit', action: "deposit into the protocol's main yield vault" },
RWA: { play: 'Subscribe', action: 'subscribe to the tokenised asset and hold the receipt' },
'Basis Trading': { play: 'Basis trade', action: 'open the spot leg and the offsetting perpetual basis trade' },
Restaking: { play: 'Restake', action: 'restake the asset through the protocol and keep the receipt' },
'Risk Curators': { play: 'Curate', action: "deposit into one of the protocol's curated vaults" },
'Onchain Capital Allocator': { play: 'Allocate', action: "allocate into the protocol's main vault" },
CDP: { play: 'Mint', action: 'mint the stable asset against collateral and keep the position' },
Derivatives: { play: 'Hedge', action: 'post margin and open one small hedge' },
Payments: { play: 'Merchant', action: 'route one small payment through the merchant stack' },
Insurance: { play: 'Cover', action: 'buy a small cover policy and keep it active' }
};
var HOLD_PLAY = { play: 'Hold', action: "hold the protocol's main asset in a self-custody wallet" };
var MODEL_VERSION = 'size-sector-2';

/** clamp(x, lo, hi): hold x inside [lo, hi]. */
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

/** quantile(values, p): linear-interpolated p-quantile; 0 when empty. */
function quantile(values, p) {
if (!values || values.length === 0) return 0;
var sorted = values.slice().sort(function (a, b) { return a - b; });
var at = clamp(p, 0, 1) * (sorted.length - 1), lo = Math.floor(at), hi = Math.ceil(at);
return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** median(values): the 50th percentile, the model's centre. */
function median(values) { return quantile(values, 0.5); }

/** log10Usd(n) */
function log10Usd(n) { return n > 0 ? Math.log10(n) : 0; }

/** multipleOf(row) */
function multipleOf(row) { return row.tvl_usd > 0 ? row.mcap_usd / row.tvl_usd : 0; }

/** fitSizeCurve(comps): Theil-Sen median slope and intercept of log10(mcap/TVL) on log10(TVL). */
function fitSizeCurve(comps) {
var slopes = [], i, j, dx, dy;
for (i = 0; i < comps.length; i++) for (j = i + 1; j < comps.length; j++) {
dx = log10Usd(comps[i].tvl_usd) - log10Usd(comps[j].tvl_usd);
if (Math.abs(dx) > 0.05) { dy = Math.log10(multipleOf(comps[i])) - Math.log10(multipleOf(comps[j])); slopes.push(dy / dx); }
}
var slope = slopes.length > 0 ? median(slopes) : 0;
return { slope: slope, intercept: median(comps.map(function (c) { return Math.log10(multipleOf(c)) - slope * log10Usd(c.tvl_usd); })), n: comps.length };
}

/** sizeMultiple(tvl, curve): clamp(10^(intercept + slope*log10(tvl)), 0.02, 8). */
function sizeMultiple(tvl, curve) { return clamp(Math.pow(10, curve.intercept + curve.slope * log10Usd(tvl)), SIZE_MIN, SIZE_MAX); }

/** sectorEffects(comps, curve): median residual per category, shrunk n/(n+4), clamped -0.26..0.26. */
function sectorEffects(comps, curve) {
var by = {};
comps.forEach(function (c) {
var r = Math.log10(multipleOf(c)) - (curve.intercept + curve.slope * log10Usd(c.tvl_usd));
var k = c.category || 'Other'; (by[k] = by[k] || []).push(r);
});
var out = {};
Object.keys(by).sort().forEach(function (k) { var n = by[k].length; out[k] = clamp(median(by[k]) * (n / (n + SECTOR_DECAY)), SECTOR_MIN, SECTOR_MAX); });
return out;
}

/** sectorMultiple(effect) */
function sectorMultiple(effect) { return Math.pow(10, effect || 0); }

/** growthFactor(change, sectorMedian): 1 if unknown; else clamp(1 + clamp(change-median,-40,60)/100*.5, .7, 1.4). */
function growthFactor(change, sectorMedian) {
if (change === null || change === undefined) return 1;
var excess = clamp(change - (sectorMedian || 0), GROWTH_CLAMP_LO, GROWTH_CLAMP_HI);
return clamp(1 + (excess / 100) * GROWTH_WEIGHT, GROWTH_MIN, GROWTH_MAX);
}

/** ageFactor(ageDays): 0.85 + 0.15*clamp(days,0,1460)/1460; unknown age 0.9. */
function ageFactor(ageDays) {
if (ageDays === null || ageDays === undefined || !isFinite(ageDays)) return AGE_UNKNOWN;
return AGE_FLOOR + AGE_RANGE * (clamp(ageDays, 0, AGE_DAYS_MAX) / AGE_DAYS_MAX);
}

/** chainFactor(count): 1 + min(0.02*(count-1), 0.10). */
function chainFactor(count) { var n = count && count > 0 ? count : 1; return 1 + Math.min(CHAIN_STEP * (n - 1), CHAIN_MAX); }

/** ageDaysOf(listedAt, asOf) */
function ageDaysOf(listedAt, asOf) {
if (!listedAt || !asOf) return null;
var then = Date.parse(listedAt + 'T00:00:00Z'), now = Date.parse(asOf + 'T00:00:00Z');
return isFinite(then) && isFinite(now) ? Math.max(0, Math.round((now - then) / 86400000)) : null;
}

/** impliedValue(row, model): TVL * size * sector * growth * age * chains, rounded, at least 1. */
function impliedValue(row, model) {
var curve = model.curve || model, sectors = model.sector || {}, medians = model.growthMedian || {};
var value = row.tvl_usd * sizeMultiple(row.tvl_usd, curve) * sectorMultiple(sectors[row.category] || 0) *
growthFactor(row.change_7d, medians[row.category]) * ageFactor(row.age_days) * chainFactor((row.chains || []).length);
return Math.max(1, Math.round(value));
}

/** rangeOf(implied, band): round(implied/10^band) to round(implied*10^band). */
function rangeOf(implied, band) { return { low: Math.max(1, Math.round(implied / Math.pow(10, band))), high: Math.round(implied * Math.pow(10, band)) }; }

/** bandFrom(comps, curve): clamp(1.5 * IQR(residuals) / 1.349, 0.15, 0.6). */
function bandFrom(comps, curve) {
var r = comps.map(function (c) { return Math.log10(multipleOf(c)) - (curve.intercept + curve.slope * log10Usd(c.tvl_usd)); });
return Math.max(BAND_FLOOR, Math.min(BAND_CEIL, BAND_SCALE * (quantile(r, 0.75) - quantile(r, 0.25))));
}

/** isPreToken(p) */
function isPreToken(p) { return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }

/** isRankable(p): pre-token, not an exchange, not a versioned pool. */
function isRankable(p) { return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name); }

/** selectBoard(snapshot): 40 watchlist rows, then 160 early pre-token rows below the floor by TVL. */
function selectBoard(snapshot) {
var onWatch = {}, bySlug = {};
snapshot.watchlist.forEach(function (s) { onWatch[s] = true; });
snapshot.protocols.forEach(function (p) { bySlug[p.slug] = p; });
var watch = snapshot.watchlist.map(function (s) { return bySlug[s]; }).filter(Boolean);
var early = snapshot.protocols.filter(function (p) {
return !onWatch[p.slug] && isRankable(p) && p.tvl_usd < snapshot.floor_usd;
}).sort(function (a, b) {
return b.tvl_usd !== a.tvl_usd ? b.tvl_usd - a.tvl_usd : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}).slice(0, EARLY_SIZE);
return { watch: watch, early: early };
}

/** compsOf(snapshot) */
function compsOf(snapshot) {
return snapshot.protocols.filter(function (p) { return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= 1e6; });
}

/** growthMedians(comps) */
function growthMedians(comps) {
var by = {};
comps.forEach(function (c) { if (c.change_7d !== null && c.change_7d !== undefined) (by[c.category || 'Other'] = by[c.category || 'Other'] || []).push(c.change_7d); });
var out = {};
Object.keys(by).sort().forEach(function (k) { out[k] = median(by[k]); });
return out;
}

/** money(n) */
function money(n) { var r = Math.round(n * 100) / 100; return r % 1 === 0 ? String(r) : r.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }

/** shortUsd(n) */
function shortUsd(n) {
return n >= 1e9 ? '$' + (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? '$' + Math.round(n / 1e6) + 'M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Math.round(n);
}

/** ticketUsd(n) */
function ticketUsd(n) { return '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/** farmPlan(row): smallest ticket under 1% of TVL clearing $25/h, else best net; 8 steps, 132 minutes. */
function farmPlan(row) {
var chains = row.chains || [], chain = chains.length > 0 ? chains[0] : 'its main chain';
var gas = GAS[chain] !== undefined ? GAS[chain] : 1;
var bridge = gas * 4 + 4, cap = row.tvl_usd * TICKET_CAP;
var options = TICKETS.filter(function (t) { return t <= cap; });
var plans = options.map(function (t) {
var expected = t * ALLOCATION, slippage = t * 0.003, cost = bridge + slippage;
return { ticket: t, expected: expected, slippage: slippage, cost: cost, net: expected - cost, perHour: (expected - cost) / HOURS };
});
var chosen = plans.filter(function (p) { return p.net > 0 && p.perHour >= FARM_PER_HOUR; })[0] || plans[plans.length - 1] ||
{ ticket: 0, expected: 0, slippage: 0, cost: bridge, net: -bridge, perHour: -bridge / HOURS };
var ticket = chosen.ticket, expected = chosen.expected, slippage = chosen.slippage;
var cost = chosen.cost, net = chosen.net, perHour = chosen.perHour;
var verdict = perHour >= FARM_PER_HOUR && net > 0 ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
var play = PLAYS[row.category] || HOLD_PLAY;
var bridgeLeg = gas * 2 + 4, qualifyLeg = gas, exitLeg = gas;
var steps = [
'Verify the snapshot and the docs of ' + row.name + ': read the terms, the points page and the contract addresses before moving funds. Cost: $0. Time: 15 min.',
'Bridge and fund: move ' + ticketUsd(ticket) + ' of USDC to ' + chain + ' and approve only the contracts the docs name. Cost: $' + money(bridgeLeg) + '. Time: 15 min.',
'Enter the position: ' + play.action + ' on ' + row.name + ' with a ticket of ' + ticketUsd(ticket) + '. Cost: $' + money(slippage) + '. Time: 15 min.',
'Qualify: hold the position and make one small transaction each week for ' + WINDOW_DAYS + ' days, so activity counts in every snapshot. Cost: $' + money(qualifyLeg) + '. Time: 30 min.',
'Upkeep: check the position weekly, confirm the points page still credits it, and write the balance in the farm log. Cost: $0. Time: 15 min.',
'Stop rule: exit if TVL falls 20 percent below ' + shortUsd(row.tvl_usd) + ' or seven-day growth drops below -30 percent. Cost: $0. Time: 12 min.',
'Exit: unwind the position and withdraw to a stable asset on ' + chain + '. Cost: $' + money(exitLeg) + '. Time: 15 min.',
'Claim: if a token launches, claim from the protocol official page and never pay to claim. Cost: $0. Time: 15 min.'
];
return { steps: steps, ticket: ticket, gas: gas, cost: cost, hours: HOURS, timeMin: STEP_TOTAL, expected: expected, net: net, perHour: perHour, verdict: verdict, play: play.play, windowDays: WINDOW_DAYS };
}

/** nearestComps(comps, tvl, count) */
function nearestComps(comps, tvl, count) {
var x = log10Usd(tvl);
return comps.slice().sort(function (a, b) {
var da = Math.abs(log10Usd(a.tvl_usd) - x), db = Math.abs(log10Usd(b.tvl_usd) - x);
return da !== db ? da - db : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}).slice(0, count).map(function (c) {
return { slug: c.slug, name: c.name, category: c.category, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd, multiple: multipleOf(c) };
});
}

/** buildRadar(snapshot): fit the curve, sectors, medians and band; score, sort and rank 200 rows. */
function buildRadar(snapshot) {
var comps = compsOf(snapshot);
var curve = fitSizeCurve(comps), sectors = sectorEffects(comps, curve);
var medians = growthMedians(comps), band = bandFrom(comps, curve);
var model = { curve: curve, sector: sectors, growthMedian: medians, band: band };
var chosen = selectBoard(snapshot);

var rows = chosen.watch.concat(chosen.early).map(function (p) {
var effect = sectors[p.category] || 0, size = sizeMultiple(p.tvl_usd, curve), sector = sectorMultiple(effect);
var growth = growthFactor(p.change_7d, medians[p.category]), ageDays = ageDaysOf(p.listed_at, snapshot.as_of);
var chains = p.chains || [], chain = chainFactor(chains.length);
var implied = Math.max(1, Math.round(p.tvl_usd * size * sector * growth * ageFactor(ageDays) * chain));
var range = rangeOf(implied, band);
var row = {
slug: p.slug, name: p.name, rank: 0, category: p.category || 'Other', chains: chains,
tvl_usd: p.tvl_usd, change_7d: p.change_7d === undefined ? null : p.change_7d, age_days: ageDays, listed_at: p.listed_at,
sector_median: medians[p.category] || 0, sector_effect: effect, size_mult: size, sector_mult: sector,
growth_mult: growth, age_mult: ageFactor(ageDays), chain_mult: chain,
implied_value_usd: implied, implied_low: range.low, implied_high: range.high,
watchlist: snapshot.watchlist.indexOf(p.slug) >= 0
};
row.farm = farmPlan(row);
row.farm_steps = row.farm.steps;
row.comps = nearestComps(comps, p.tvl_usd, 3);
return row;
});

rows.sort(function (a, b) { return b.implied_value_usd !== a.implied_value_usd ? b.implied_value_usd - a.implied_value_usd : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; });
rows.forEach(function (row, i) { row.rank = i + 1; });
rows = rows.slice(0, BOARD_SIZE);

var recomputed = rows.filter(function (row) { return impliedValue(row, model) === row.implied_value_usd; }).length;
var covered = snapshot.watchlist.filter(function (s) { return rows.some(function (row) { return row.slug === s; }); }).length;
var live = snapshot.protocols.filter(function (p) { return p.mcap_usd !== null; }).map(function (p) {
var ageDays = ageDaysOf(p.listed_at, snapshot.as_of);
return { slug: p.slug, name: p.name, category: p.category || 'Other', chains: p.chains || [], tvl_usd: p.tvl_usd,
mcap_usd: p.mcap_usd, change_7d: p.change_7d === undefined ? null : p.change_7d, multiple: multipleOf(p),
listed_at: p.listed_at, age_days: ageDays };
}).sort(function (a, b) { return b.mcap_usd !== a.mcap_usd ? b.mcap_usd - a.mcap_usd : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; });
var multiples = live.map(function (r) { return r.multiple; });

var sectorsSeen = {}, chainsSeen = {};
rows.forEach(function (row) { sectorsSeen[row.category] = true; row.chains.forEach(function (c) { chainsSeen[c] = true; }); });

return {
as_of: snapshot.as_of, floor_usd: snapshot.floor_usd, scanned: snapshot.protocols.length,
pre_token: snapshot.protocols.filter(isPreToken).length, watchlist_size: snapshot.watchlist.length,
live_size: live.length, board_size: rows.length, early_size: chosen.early.length, model_version: MODEL_VERSION,
model: {
slope: curve.slope, intercept: curve.intercept, comps: curve.n, band: band,
median_live_multiple: median(multiples), size_min: SIZE_MIN, size_max: SIZE_MAX,
sector_min: SECTOR_MIN, sector_max: SECTOR_MAX, growth_min: GROWTH_MIN, growth_max: GROWTH_MAX,
age_min: AGE_FLOOR, age_max: AGE_FLOOR + AGE_RANGE, age_unknown: AGE_UNKNOWN, chain_max: CHAIN_MAX,
growth_cap: GROWTH_CLAMP_HI, growth_floor: GROWTH_CLAMP_LO, growth_weight: GROWTH_WEIGHT,
tickets: TICKETS, ticket_cap: TICKET_CAP, allocation: ALLOCATION, hours: HOURS, step_minutes: STEP_MINUTES, window_days: WINDOW_DAYS
},
checks: { watchlist_covered: covered, watchlist_total: snapshot.watchlist.length, rows_recomputed: recomputed, rows: rows.length },
backtest: backtest(snapshot), sectors: Object.keys(sectorsSeen).sort(), chains: Object.keys(chainsSeen).sort(),
growth_medians: medians, rows: rows, live: live
};
}

/** predictCap(comp, curve, sectors, medians) */
function predictCap(comp, curve, sectors, medians) {
return comp.tvl_usd * sizeMultiple(comp.tvl_usd, curve) * sectorMultiple(sectors[comp.category] || 0) *
growthFactor(comp.change_7d, medians[comp.category]) * ageFactor(comp.age_days === undefined ? null : comp.age_days) *
chainFactor((comp.chains || []).length);
}

/** insideRange(actual, predicted, band) */
function insideRange(actual, predicted, band) {
return actual >= predicted / Math.pow(10, band) && actual <= predicted * Math.pow(10, band);
}

/** backtest(snapshot): leave-one-out and oldest-60%/newest-40% coverage and median error. */
function backtest(snapshot) {
var base = compsOf(snapshot);
var band = bandFrom(base, fitSizeCurve(base)), medians = growthMedians(base);
var comps = base.map(function (c) {
return { slug: c.slug, name: c.name, category: c.category || 'Other', chains: c.chains || [], tvl_usd: c.tvl_usd,
mcap_usd: c.mcap_usd, change_7d: c.change_7d === undefined ? null : c.change_7d, listed_at: c.listed_at,
age_days: ageDaysOf(c.listed_at, snapshot.as_of) };
});

var looInside = 0, looErrors = [];
comps.forEach(function (c, i) {
var others = comps.filter(function (_, j) { return j !== i; });
var curve = fitSizeCurve(others), predicted = predictCap(c, curve, sectorEffects(others, curve), medians);
if (insideRange(c.mcap_usd, predicted, band)) looInside++;
looErrors.push(Math.abs(Math.log10(c.mcap_usd / predicted)));
});

var sorted = comps.slice().sort(function (a, b) {
var la = a.listed_at || '', lb = b.listed_at || '';
return la !== lb ? (la < lb ? -1 : 1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
});
var cut = Math.floor(sorted.length * 0.6), train = sorted.slice(0, cut), test = sorted.slice(cut);
var trainCurve = fitSizeCurve(train), trainSectors = sectorEffects(train, trainCurve);
var newerInside = 0, newerErrors = [];
test.forEach(function (c) {
var predicted = predictCap(c, trainCurve, trainSectors, medians);
if (insideRange(c.mcap_usd, predicted, band)) newerInside++;
newerErrors.push(Math.abs(Math.log10(c.mcap_usd / predicted)));
});

return {
loo: { n: comps.length, inside: looInside, share: comps.length > 0 ? looInside / comps.length : 0, medianError: median(looErrors) },
newer: { n: test.length, inside: newerInside, share: test.length > 0 ? newerInside / test.length : 0, medianError: median(newerErrors) },
band: band
};
}

globalThis.RadarModel = {
median: median, quantile: quantile, clamp: clamp, multipleOf: multipleOf, ageDaysOf: ageDaysOf,
fitSizeCurve: fitSizeCurve, sizeMultiple: sizeMultiple, sectorEffects: sectorEffects,
sectorMultiple: sectorMultiple, growthFactor: growthFactor, ageFactor: ageFactor, chainFactor: chainFactor,
impliedValue: impliedValue, rangeOf: rangeOf, bandFrom: bandFrom,
isPreToken: isPreToken, isRankable: isRankable,
selectBoard: selectBoard, compsOf: compsOf, growthMedians: growthMedians,
farmPlan: farmPlan, nearestComps: nearestComps, buildRadar: buildRadar, backtest: backtest
};
})();
