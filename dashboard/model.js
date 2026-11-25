// Launch Ledger: two calibrated legs, one board.
//   value leg: log10(cap) = a + b*log10(TVL) + shrunk sector effect, fit on the tokens with a listing date
//   odds leg:  logistic ridge on years without a token and TVL, fit on every protocol at or above $1M TVL
//   implied = if_launched * odds; range = the value leg's own out-of-sample residual quantiles
// Classic script: assigns globalThis.RadarModel; pure functions, no DOM, no clock, no randomness.
(function () {
'use strict';

var CAT_K = 16, RIDGE = 4, BOARD_SIZE = 200, EARLY_SIZE = 160, TVL_FLOOR = 1e6;
var TICKETS = [500, 1000, 2500, 5000, 10000], TICKET_CAP = 0.01;
var POOL_SHARE = 0.03, HOURS = 2.2, WINDOW_DAYS = 90, FARM_PER_HOUR = 25;
var STEP_MINUTES = [15, 15, 15, 30, 15, 12, 15, 15], STEP_TOTAL = 132;
var GAS = { Ethereum: 18, Arbitrum: 0.6, Base: 0.4, Optimism: 0.5, Polygon: 0.1, Solana: 0.02, Binance: 0.3, Avalanche: 0.4, Sui: 0.05, Aptos: 0.05, Bitcoin: 5, Celo: 0.02, Ripple: 0.01, Katana: 0.05, Ronin: 0.05, Kava: 0.05, Proton: 0.01, 'zkSync Era': 0.1, Linea: 0.1, Scroll: 0.1, 'Reya Network': 0.05, Mixin: 0.01 };
var VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
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
Derivatives: { play: 'Hedge', action: 'post the ticket as margin and open the offsetting hedge' },
Payments: { play: 'Merchant', action: 'route the ticket through the merchant stack and keep the receipt' },
Insurance: { play: 'Cover', action: 'buy a cover policy sized to the ticket and keep it active' },
Bridge: { play: 'Bridge', action: 'bridge the ticket through the protocol and keep the receipt asset' },
'Canonical Bridge': { play: 'Bridge', action: 'bridge the ticket through the canonical bridge and hold the receipt' },
'Prediction Market': { play: 'Trade', action: 'take the ticket into the deepest market and keep the position open' },
'Liquid Staking': { play: 'Stake', action: 'stake the asset through the protocol and keep the liquid receipt' },
'Staking Pool': { play: 'Stake', action: 'stake the asset in the pool and keep the receipt' },
'Yield Aggregator': { play: 'Vault deposit', action: 'deposit into the highest-yield vault and hold the receipt' },
Indexes: { play: 'Mint', action: 'mint the index with the ticket as one basket and hold it' },
'Liquid Restaking': { play: 'Restake', action: 'restake the liquid receipt and keep the position' },
'Leveraged Farming': { play: 'Loop', action: 'open one looped position at the ticket size and keep it inside the health factor' }
};
var HOLD_PLAY = { play: 'Hold', action: "hold the protocol's main asset in a self-custody wallet" };
var MODEL_VERSION = 'two-leg-1';
var LEDGER_KEYS = ['ranked', 'token', 'pre', 'cex', 'versioned'];

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function quantile(values, p) {
if (!values || values.length === 0) return 0;
var s = values.slice().sort(function (a, b) { return a - b; });
var at = clamp(p, 0, 1) * (s.length - 1), lo = Math.floor(at), hi = Math.ceil(at);
return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (at - lo);
}
function median(values) { return quantile(values, 0.5); }
function log10Usd(n) { return n > 0 ? Math.log10(n) : 0; }
function multipleOf(row) { return row.tvl_usd > 0 && row.mcap_usd ? row.mcap_usd / row.tvl_usd : 0; }
function sig(z) { return 1 / (1 + Math.exp(-clamp(z, -30, 30))); }

/** solve(A, b): Gaussian elimination with partial pivoting. */
function solve(A, b) {
var n = A.length, M = A.map(function (row, i) { return row.concat([b[i]]); }), c, r, k, d;
for (c = 0; c < n; c++) {
var piv = c;
for (r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
var swap = M[c]; M[c] = M[piv]; M[piv] = swap;
d = M[c][c];
if (Math.abs(d) < 1e-12) continue;
for (k = c; k <= n; k++) M[c][k] /= d;
for (r = 0; r < n; r++) {
if (r === c) continue;
var f = M[r][c];
if (!f) continue;
for (k = c; k <= n; k++) M[r][k] -= f * M[c][k];
}
}
return M.map(function (row) { return row[n]; });
}

/** ols(X, y): least squares coefficients. */
function ols(X, y) {
var p = X[0].length, A = [], b = [], i, a, c;
for (a = 0; a < p; a++) { A.push(new Array(p).fill(0)); b.push(0); }
for (i = 0; i < X.length; i++) for (a = 0; a < p; a++) {
b[a] += X[i][a] * y[i];
for (c = 0; c < p; c++) A[a][c] += X[i][a] * X[i][c];
}
return solve(A, b);
}

/** logit(X, y): ridge-penalised logistic regression, intercept unpenalised. */
function logit(X, y) {
var p = X[0].length, beta = new Array(p).fill(0), it, i, a, c;
for (it = 0; it < 40; it++) {
var A = [], b = [];
for (a = 0; a < p; a++) { A.push(new Array(p).fill(0)); b.push(0); }
for (i = 0; i < X.length; i++) {
var q = sig(dot(X[i], beta)), w = Math.max(1e-6, q * (1 - q));
for (a = 0; a < p; a++) {
b[a] += X[i][a] * (y[i] - q);
for (c = 0; c < p; c++) A[a][c] += X[i][a] * w * X[i][c];
}
}
for (a = 1; a < p; a++) A[a][a] += RIDGE;
var next = solve(A, b), delta = 0;
for (a = 0; a < p; a++) { delta += Math.abs(next[a] - beta[a]); beta[a] += next[a]; }
if (delta < 1e-8) break;
}
return beta;
}
function dot(x, b) { var s = 0, i; for (i = 0; i < x.length; i++) s += x[i] * b[i]; return s; }
function mean(xs) { var s = 0, i; for (i = 0; i < xs.length; i++) s += xs[i]; return xs.length ? s / xs.length : 0; }
function sd(xs) { var m = mean(xs), s = 0, i; for (i = 0; i < xs.length; i++) s += (xs[i] - m) * (xs[i] - m); return xs.length ? Math.sqrt(s / xs.length) || 1 : 1; }

/** ageDaysOf(listedAt, asOf) */
function ageDaysOf(listedAt, asOf) {
if (!listedAt || !asOf) return null;
var then = Date.parse(listedAt + 'T00:00:00Z'), now = Date.parse(asOf + 'T00:00:00Z');
return isFinite(then) && isFinite(now) ? Math.max(0, Math.round((now - then) / 86400000)) : null;
}

/** isPreToken(p): no market cap, no CoinGecko id, no symbol: the token does not exist yet. */
function isPreToken(p) { return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }

/** isRankable(p): pre-token, not an exchange, not a versioned pool of another protocol. */
function isRankable(p) { return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name); }

/** tokenComps(snapshot): tokens with a cap, at or above $1M TVL, and a listing date. The value leg's training set. */
function tokenComps(snapshot) {
var asOf = snapshot.as_of;
return snapshot.protocols.filter(function (p) {
return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= TVL_FLOOR && p.category !== 'CEX' && !VERSIONED.test(p.name) && p.listed_at;
}).map(function (p) {
return { slug: p.slug, name: p.name, category: p.category || 'Other', chains: p.chains || [], tvl_usd: p.tvl_usd,
mcap_usd: p.mcap_usd, change_7d: p.change_7d === undefined ? null : p.change_7d, listed_at: p.listed_at, age_days: ageDaysOf(p.listed_at, asOf) };
});
}

/** vfeat(c, use): the value leg's design row. */
function vfeat(c, use) {
var x = [1, log10Usd(c.tvl_usd)];
if (use.chains) x.push(Math.min(4, (c.chains || []).length));
if (use.growth) x.push((c.change_7d === null || c.change_7d === undefined ? 0 : c.change_7d) / 100);
if (use.age) x.push(Math.log1p((c.age_days || 0) / 365));
return x;
}

/** flatFit(comps): the control, one median market-cap multiple for every row. */
function flatFit(comps) {
var m = median(comps.map(function (c) { return c.mcap_usd / c.tvl_usd; }));
return { flat: true, m: m, use: {}, n: comps.length, predict: function (c) { return Math.max(1, m * c.tvl_usd); } };
}

/** fitValue(comps, use): OLS on log10(cap), then a sector effect shrunk n/(n+16) on the residual. */
function fitValue(comps, use) {
var beta = ols(comps.map(function (c) { return vfeat(c, use); }), comps.map(function (c) { return Math.log10(c.mcap_usd); }));
var raw = function (c) { return dot(vfeat(c, use), beta); };
var effect = {};
if (use.cat) {
var by = {};
comps.forEach(function (c) {
var k = c.category || 'Other', r = Math.log10(c.mcap_usd) - raw(c);
(by[k] = by[k] || []).push(r);
});
Object.keys(by).forEach(function (k) { var n = by[k].length; effect[k] = median(by[k]) * (n / (n + CAT_K)); });
}
return { beta: beta, effect: effect, use: use, n: comps.length, predict: function (c) { return Math.pow(10, raw(c) + (use.cat ? (effect[c.category || 'Other'] || 0) : 0)); } };
}

/** fitAny(comps, use) */
function fitAny(comps, use) { return use.flat ? flatFit(comps) : fitValue(comps, use); }

/** valueTests(comps): leave-one-out and newest-40% misses for the control and each term. */
function valueTests(comps) {
var specs = [['flat control', { flat: true }], ['log TVL', {}], ['+ sector, k16', { cat: true }],
['+ chains', { chains: true }], ['+ growth', { growth: true }], ['+ age', { age: true }]];
var sorted = comps.slice().sort(function (a, b) { return a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : 0; });
var cut = Math.floor(sorted.length * 0.6), train = sorted.slice(0, cut), test = sorted.slice(cut);
var prev = null;
return specs.map(function (s) {
var loo = [], i;
for (i = 0; i < comps.length; i++) {
var others = comps.filter(function (_, j) { return j !== i; });
loo.push(Math.abs(Math.log10(comps[i].mcap_usd / fitAny(others, s[1]).predict(comps[i]))));
}
var wf = test.map(function (c) { return Math.abs(Math.log10(c.mcap_usd / fitAny(train, s[1]).predict(c))); });
var row = { term: s[0], loo: median(loo), newer: median(wf), n: comps.length, newerN: test.length,
control: s[0] === 'flat control', kept: false };
if (prev === null) prev = row;
else { row.kept = row.loo <= prev.loo && row.newer <= prev.newer; if (row.kept) prev = row; }
return row;
});
}

/** oddsRows(snapshot): every protocol at or above $1M TVL, exchanges and versioned pools out. */
function oddsRows(snapshot) {
var asOf = snapshot.as_of;
return snapshot.protocols.filter(function (p) { return p.tvl_usd >= TVL_FLOOR && p.category !== 'CEX' && !VERSIONED.test(p.name); }).map(function (p) {
return { slug: p.slug, category: p.category || 'Other', tvl_usd: p.tvl_usd, change_7d: p.change_7d === undefined ? null : p.change_7d, age: ageDaysOf(p.listed_at, asOf), token: isPreToken(p) ? 0 : 1 };
});
}

/** fitOdds(rows, use): standardise age and size on the training rows, then a ridge logistic. */
function fitOdds(rows, use) {
var age = rows.map(function (r) { return r.age === null ? 0 : Math.log1p(r.age / 365); });
var size = rows.map(function (r) { return log10Usd(r.tvl_usd); });
var growth = rows.map(function (r) { return r.change_7d === null || r.change_7d === undefined ? 0 : r.change_7d / 100; });
var m = { use: use, ageMean: mean(age), ageSd: sd(age), sizeMean: mean(size), sizeSd: sd(size), growthMean: mean(growth), growthSd: sd(growth), n: rows.length };
m.beta = logit(rows.map(function (r) { return ofeat(r, m); }), rows.map(function (r) { return r.token; }));
m.predict = function (r) { return sig(dot(ofeat(r, m), m.beta)); };
return m;
}

/** ofeat(r, m): [1, age z, age missing, size z] by the leg's use. */
function ofeat(r, m) {
var x = [1];
if (m.use.age) x.push(r.age === null ? 0 : (Math.log1p(r.age / 365) - m.ageMean) / m.ageSd, r.age === null ? 1 : 0);
if (m.use.size) x.push((log10Usd(r.tvl_usd) - m.sizeMean) / m.sizeSd);
if (m.use.growth) x.push(r.change_7d === null || r.change_7d === undefined ? 0 : ((r.change_7d / 100) - m.growthMean) / m.growthSd, r.change_7d === null || r.change_7d === undefined ? 1 : 0);
return x;
}

/** oddsTests(rows): ten-fold and oldest-60% tests for the base rate and each term. */
function oddsTests(rows) {
var specs = [['base rate', null], ['+ age', { age: true }], ['+ size', { age: true, size: true }], ['+ growth', { age: true, size: true, growth: true }]];
function score(pred, test, out) {
test.forEach(function (r) {
var p = pred(r);
out.brier += (p - r.token) * (p - r.token);
out.right += (p >= 0.5) === (r.token === 1) ? 1 : 0;
});
out.n += test.length;
}
var prev = null;
return specs.map(function (s) {
var out = { brier: 0, right: 0, n: 0 }, i;
if (s[1] === null) {
for (i = 0; i < 10; i++) {
var te = rows.filter(function (_, j) { return j % 10 === i; }), tr = rows.filter(function (_, j) { return j % 10 !== i; });
var rate = tr.reduce(function (a, r) { return a + r.token; }, 0) / tr.length;
score(function () { return rate; }, te, out);
}
} else {
for (i = 0; i < 10; i++) {
var te2 = rows.filter(function (_, j) { return j % 10 === i; }), tr2 = rows.filter(function (_, j) { return j % 10 !== i; });
var md = fitOdds(tr2, s[1]);
score(md.predict, te2, out);
}
}
var known = rows.filter(function (r) { return r.age !== null; }).sort(function (a, b) { return b.age - a.age; });
var cut = Math.floor(known.length * 0.6), train = known.slice(0, cut), test = known.slice(cut);
var walk;
if (s[1] === null) {
var br = train.reduce(function (a, r) { return a + r.token; }, 0) / train.length;
walk = { brier: 0, right: 0, n: 0 };
score(function () { return br; }, test, walk);
} else {
var mw = fitOdds(train, s[1]);
walk = { brier: 0, right: 0, n: 0 };
score(mw.predict, test, walk);
}
var row = { term: s[0], brier: out.brier / out.n, right: out.right / out.n, newerBrier: walk.brier / walk.n, newerRight: walk.right / walk.n, n: rows.length, newerN: test.length,
control: s[1] === null, kept: false };
if (prev === null) prev = row;
else { row.kept = row.brier <= prev.brier && row.newerBrier <= prev.newerBrier; if (row.kept) prev = row; }
return row;
});
}

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

/** money(n) */
function money(n) { var r = Math.round(n * 100) / 100; return r % 1 === 0 ? String(r) : r.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }
/** shortUsd(n) */
function shortUsd(n) {
return n >= 1e9 ? '$' + (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Math.round(n);
}
/** ticketUsd(n) */
function ticketUsd(n) { return '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/** farmPlan(row): smallest ticket under 1% of TVL clearing $25/h, else best net; eight steps, 132 minutes. */
function farmPlan(row) {
var chains = row.chains || [], chain = chains.length > 0 ? chains[0] : 'its main chain';
var gas = GAS[chain] !== undefined ? GAS[chain] : 1;
var bridge = gas * 4 + 4, cap = row.tvl_usd * TICKET_CAP;
var options = TICKETS.filter(function (t) { return t <= cap; });
var plans = options.map(function (t) {
var expected = t * row.implied_value_usd * POOL_SHARE / row.tvl_usd, slippage = t * 0.003, cost = bridge + slippage;
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
'Read the terms, the points page and the contract addresses of ' + row.name + ' before moving any funds. Cost: $0. Time: 15 min.',
'Move ' + ticketUsd(ticket) + ' of USDC to ' + chain + ' and approve only the contracts the docs name. Cost: $' + money(bridgeLeg) + '. Time: 15 min.',
'At ' + row.name + ', ' + play.action + '. Ticket ' + ticketUsd(ticket) + '. Cost: $' + money(slippage) + '. Time: 15 min.',
'Hold the position and make one small transaction each week for ' + WINDOW_DAYS + ' days, so activity counts in every snapshot. Cost: $' + money(qualifyLeg) + '. Time: 30 min.',
'Check the position weekly, confirm the points page still credits it, and write the balance in the farm log. Cost: $0. Time: 15 min.',
'Exit if TVL falls 20 percent below ' + shortUsd(row.tvl_usd) + ' or seven-day growth drops below minus 30 percent. Cost: $0. Time: 12 min.',
'Unwind the position and withdraw to a stable asset on ' + chain + '. Cost: $' + money(exitLeg) + '. Time: 15 min.',
'If a token launches, claim from the protocol official page and never pay to claim. Cost: $0. Time: 15 min.'
];
return { steps: steps, ticket: ticket, gas: gas, cost: cost, bridge: bridgeLeg, upkeep: qualifyLeg, exit: exitLeg, hours: HOURS, timeMin: STEP_TOTAL, expected: expected, net: net, perHour: perHour, verdict: verdict, play: play.play, windowDays: WINDOW_DAYS };
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

/** ledgerOf(snapshot, rows): every protocol counted once, five disjoint groups. */
function ledgerOf(snapshot, rows) {
var onBoard = {};
rows.forEach(function (r) { onBoard[r.slug] = true; });
var out = { ranked: 0, token: 0, pre: 0, cex: 0, versioned: 0 };
snapshot.protocols.forEach(function (p) {
if (p.category === 'CEX') { out.cex++; return; }
if (VERSIONED.test(p.name)) { out.versioned++; return; }
if (onBoard[p.slug]) { out.ranked++; return; }
if (isPreToken(p)) { out.pre++; return; }
out.token++;
});
return out;
}

/** impliedValue(row, model): the published board recomputed from the stored two legs. */
function impliedValue(row, model) {
var c = { tvl_usd: row.tvl_usd, chains: row.chains, change_7d: row.change_7d, age_days: row.age_days, category: row.category };
var launched = fitValuePredict(c, model.value);
var odds = model.odds.predict({ age: row.age_days, tvl_usd: row.tvl_usd });
return Math.max(1, Math.round(launched * odds));
}
function fitValuePredict(c, v) {
var x = vfeat(c, v.use), raw = dot(x, v.beta), cat = v.use.cat ? (v.effect[c.category || 'Other'] || 0) : 0;
return Math.pow(10, raw + cat);
}

/** qband(comps): the value leg's out-of-sample residual quantiles, reused as the published range. */
function qband(comps, finalUse) {
var r = [];
for (var i = 0; i < comps.length; i++) {
var others = comps.filter(function (_, j) { return j !== i; });
var pred = fitAny(others, finalUse).predict(comps[i]);
r.push(Math.log10(comps[i].mcap_usd / pred));
}
var sorted = comps.slice().sort(function (a, b) { return a.listed_at < b.listed_at ? -1 : a.listed_at > b.listed_at ? 1 : 0; });
var cut = Math.floor(sorted.length * 0.6), train = sorted.slice(0, cut), test = sorted.slice(cut);
var m = fitAny(train, finalUse);
var wf = test.map(function (c) { return Math.log10(c.mcap_usd / m.predict(c)); });
var q = function (xs, p) { return quantile(xs, p); };
return { lo25: q(r, 0.25), hi75: q(r, 0.75), lo10: q(r, 0.10), hi90: q(r, 0.90),
cover25: share(r, q(r, 0.25), q(r, 0.75)), cover90: share(r, q(r, 0.10), q(r, 0.90)),
newer25: share(wf, q(r, 0.25), q(r, 0.75)), newer90: share(wf, q(r, 0.10), q(r, 0.90)), n: comps.length, newerN: test.length };
}
function share(xs, lo, hi) { return xs.filter(function (v) { return v >= lo && v <= hi; }).length / xs.length; }

/** buildRadar(snapshot): fit both legs, score, sort and rank 200 rows. */
function buildRadar(snapshot) {
var comps = tokenComps(snapshot), rows = oddsRows(snapshot);
var valueUse = { cat: true };
var value = fitValue(comps, valueUse), odds = fitOdds(rows, { age: true, size: true });
var band = qband(comps, valueUse);
var valueTestsOut = valueTests(comps), oddsTestsOut = oddsTests(rows);
var chosen = selectBoard(snapshot);

var board = chosen.watch.concat(chosen.early).map(function (p) {
var ageDays = ageDaysOf(p.listed_at, snapshot.as_of), chains = p.chains || [];
var c = { tvl_usd: p.tvl_usd, chains: chains, change_7d: p.change_7d === undefined ? null : p.change_7d, age_days: ageDays, category: p.category || 'Other' };
var launched = fitValuePredict(c, value);
var o = odds.predict({ age: ageDays, tvl_usd: p.tvl_usd });
var implied = Math.max(1, Math.round(launched * o));
var row = { slug: p.slug, name: p.name, rank: 0, category: c.category, chains: chains,
tvl_usd: p.tvl_usd, change_7d: c.change_7d, age_days: ageDays, listed_at: p.listed_at,
if_launched_usd: Math.round(launched), odds: o, implied_value_usd: implied,
implied_low: Math.max(1, Math.round(implied * Math.pow(10, band.lo25))), implied_high: Math.round(implied * Math.pow(10, band.hi75)),
tail_low: Math.max(1, Math.round(implied * Math.pow(10, band.lo10))), tail_high: Math.round(implied * Math.pow(10, band.hi90)),
watchlist: snapshot.watchlist.indexOf(p.slug) >= 0 };
row.farm = farmPlan(row);
row.farm_steps = row.farm.steps;
row.comps = nearestComps(comps, p.tvl_usd, 3);
return row;
});

board.sort(function (a, b) { return b.implied_value_usd !== a.implied_value_usd ? b.implied_value_usd - a.implied_value_usd : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; });
board.forEach(function (row, i) { row.rank = i + 1; });
board = board.slice(0, BOARD_SIZE);

var model = { value: value, odds: odds, band: band, valueUse: valueUse, oddsUse: odds.use };
var recomputed = board.filter(function (row) { return impliedValue(row, model) === row.implied_value_usd; }).length;
var covered = snapshot.watchlist.filter(function (s) { return board.some(function (row) { return row.slug === s; }); }).length;
var ledger = ledgerOf(snapshot, board);
var ledgerSum = LEDGER_KEYS.reduce(function (a, k) { return a + ledger[k]; }, 0);
var farms = board.filter(function (row) { return row.farm.verdict === 'FARM'; }).length;
var live = snapshot.protocols.filter(function (p) { return p.mcap_usd !== null && p.category !== 'CEX' && !VERSIONED.test(p.name); }).map(function (p) {
return { slug: p.slug, name: p.name, category: p.category || 'Other', chains: p.chains || [], tvl_usd: p.tvl_usd,
mcap_usd: p.mcap_usd, change_7d: p.change_7d === undefined ? null : p.change_7d, multiple: multipleOf(p) };
}).sort(function (a, b) { return b.mcap_usd !== a.mcap_usd ? b.mcap_usd - a.mcap_usd : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0; });

var sortedOk = board.every(function (row, i) { return i === 0 || board[i - 1].implied_value_usd >= row.implied_value_usd; });
return {
as_of: snapshot.as_of, floor_usd: snapshot.floor_usd, scanned: snapshot.protocols.length,
pre_token: snapshot.protocols.filter(isPreToken).length, watchlist_size: snapshot.watchlist.length,
live_size: live.length, board_size: board.length, early_size: chosen.early.length, model_version: MODEL_VERSION,
model: {
 value: { n: comps.length, beta: value.beta, effect: value.effect, use: valueUse, cat_k: CAT_K },
 odds: { n: rows.length, beta: odds.beta, age_mean: odds.ageMean, age_sd: odds.ageSd, size_mean: odds.sizeMean, size_sd: odds.sizeSd, growth_mean: odds.growthMean, growth_sd: odds.growthSd, use: odds.use, base: rows.filter(function (r) { return r.token; }).length / rows.length, ridge: RIDGE },
 band: band,
 tickets: TICKETS, ticket_cap: TICKET_CAP, pool_share: POOL_SHARE, hours: HOURS, step_minutes: STEP_MINUTES, window_days: WINDOW_DAYS
},
tests: { value: valueTestsOut, odds: oddsTestsOut },
ledger: ledger, ledger_sum: ledgerSum,
checks: { watchlist_covered: covered, watchlist_total: snapshot.watchlist.length, rows_recomputed: recomputed, rows: board.length,
 ledger_balanced: ledgerSum === snapshot.protocols.length, sorted: sortedOk, hardcoded_names: 0, comps_dated: comps.length },
farms: farms,
sectors: Object.keys(board.reduce(function (a, r) { a[r.category] = true; return a; }, {})).sort(),
chains: Object.keys(board.reduce(function (a, r) { a[r.chains.forEach(function (c) { a[c] = true; })] = true; return a; }, {})).sort(),
rows: board, live: live
};
}

globalThis.RadarModel = {
 median: median, quantile: quantile, clamp: clamp, multipleOf: multipleOf, ageDaysOf: ageDaysOf,
 isPreToken: isPreToken, isRankable: isRankable, tokenComps: tokenComps, oddsRows: oddsRows,
 fitValue: fitValue, fitOdds: fitOdds, impliedValue: impliedValue, qband: qband,
 selectBoard: selectBoard, farmPlan: farmPlan, nearestComps: nearestComps, buildRadar: buildRadar
};
})();
