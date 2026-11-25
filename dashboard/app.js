// Launch Ledger's page: reads window.RADAR and window.RadarModel; renders the board, detail, planner
// and set-aside from the hash. No network, no clock; every figure is a value from data.js.
(function () {
'use strict';
var D = window.RADAR, M = window.RadarModel;
if (!D || !M) return;
var app = document.getElementById('app');
var state = { q: '', sector: 'all', chain: 'all', growth: 'all', farms: false, sort: 'implied', dir: -1 };

/** esc(s) */
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
/** trim(n) */
function trim(n) { var r = Math.round(n * 100) / 100; return r % 1 === 0 ? String(r) : r.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }
/** usd(n) */
function usd(n) {
if (n === null || n === undefined || !isFinite(n)) return 'n/a';
var a = Math.abs(n);
return a >= 1e9 ? '$' + trim(n / 1e9) + 'B' : a >= 1e6 ? '$' + (Math.round(n / 1e5) / 10).toFixed(1) + 'M' : a >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + Math.round(n);
}
/** usd2(n) */
function usd2(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); }
/** pct(n) */
function pct(n) { return n === null || n === undefined || !isFinite(n) ? 'no 7d' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
/** age(days) */
function age(days) { return days === null || days === undefined ? 'unknown' : days >= 365 ? (days / 365).toFixed(1) + ' y' : Math.round(days) + ' d'; }
/** ageWords(days) */
function ageWords(days) { return days === null || days === undefined ? 'an unknown number of days' : days.toLocaleString('en-US') + ' days'; }
/** mult(n) */
function mult(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : trim(n) + 'x'; }
/** dex(n) */
function dex(n) { return n === null || n === undefined ? '0.00 dex' : (n >= 0 ? '+' : '') + n.toFixed(2) + ' dex'; }
/** byId(id) */
function byId(id) { return document.getElementById(id); }

/** topbar(active) */
function topbar(active) {
var nav = [['#/', 'Board', 'board'], ['#/p/' + D.rows[0].slug, 'Detail', 'detail'], ['#/planner', 'Planner', 'planner'], ['#/aside', 'Set aside', 'aside']];
return '<header class=topbar><div class=topbar-in><a class=wordmark href="#/"><i></i>LAUNCH LEDGER</a><nav class=topnav>' +
nav.map(function (n) { return '<a href="' + n[0] + '"' + (active === n[2] ? ' class=on' : '') + '>' + n[1] + '</a>'; }).join('') +
'</nav><div class=topright><span class=stamp>DefiLlama ' + D.as_of + '</span><span class=pill>watchlist ' + D.checks.watchlist_covered + '/' + D.checks.watchlist_total + '</span></div></div></header>';
}

/** kpi(label, value, note) */
function kpi(label, value, note) { return '<div class=kpi><span>' + label + '</span><b>' + value + '</b><em>' + note + '</em></div>'; }

/** hero() */
function hero() {
var m = D.model;
return '<section class=hero><div><p class=kicker>Pre-token intelligence · ' + D.as_of + '</p><h1>What a token would be worth</h1><p class=dek>' +
D.scanned + ' protocols scanned, ' + D.pre_token + ' pre-token, ' + D.watchlist_size + ' on the watchlist, ' + D.live_size + ' live tokens set aside.</p></div><div class=kpis>' +
kpi('Watchlist covered', D.checks.watchlist_covered + '/' + D.checks.watchlist_total, 'every slug on the list') +
kpi('Pre-token ranked', D.board_size, D.early_size + ' early rows, ' + D.watchlist_size + ' watchlist') +
kpi('Median live multiple', mult(m.median_live_multiple), D.live_size + ' live tokens, market cap / TVL') +
kpi('Blind test in range', Math.round(D.backtest.loo.share * 100) + '% / ' + Math.round(D.backtest.newer.share * 100) + '%', 'leave-one-out / newer, ' + D.backtest.loo.inside + '/' + D.backtest.loo.n + ' and ' + D.backtest.newer.inside + '/' + D.backtest.newer.n) +
'</div></section>';
}

/** growthPass(v) */
function growthPass(v) {
if (state.growth === 'all') return true;
if (state.growth === 'unknown') return v === null || v === undefined;
if (v === null || v === undefined) return false;
if (state.growth === 'up20') return v >= 20;
if (state.growth === 'up') return v > 0;
if (state.growth === 'down') return v < 0;
return v <= -20;
}

/** sortVal(row, key) */
function sortVal(r, key) {
if (key === 'tvl') return r.tvl_usd;
if (key === 'growth') return r.change_7d === null || r.change_7d === undefined ? -1e9 : r.change_7d;
if (key === 'age') return r.age_days === null || r.age_days === undefined ? 1e9 : r.age_days;
if (key === 'size') return r.size_mult;
if (key === 'perHour') return r.farm.perHour;
return r.implied_value_usd;
}

/** visibleRows() */
function visibleRows() {
var q = state.q.trim().toLowerCase();
var list = D.rows.filter(function (r) {
if (state.farms && r.farm.verdict !== 'FARM') return false;
if (state.sector !== 'all' && r.category !== state.sector) return false;
if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
if (!growthPass(r.change_7d)) return false;
return !q || (r.name + ' ' + r.slug + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) >= 0;
});
return list.sort(function (a, b) {
var av = sortVal(a, state.sort), bv = sortVal(b, state.sort);
return av !== bv ? (av < bv ? -state.dir : state.dir) : a.rank - b.rank;
});
}

/** th(label, key) */
function th(label, key, cls) {
var on = state.sort === key;
return '<th' + (cls ? ' class=' + cls : '') + '><button type=button data-sort=' + key + '>' + label + (on ? (state.dir < 0 ? ' &darr;' : ' &uarr;') : '') + '</button></th>';
}

/** thead() */
function thead() { return '<tr><th><button type=button data-sort=implied>#</button></th><th>Protocol</th>' + th('TVL', 'tvl', 'r') + th('7d', 'growth', 'r') + th('No token', 'age', 'r') + th('Size curve', 'size', 'r') + th('Implied value', 'implied', 'r') + th('Farm $/h', 'perHour', 'r') + '</tr>'; }

/** rowHtml(r) */
function rowHtml(r) {
var g = r.change_7d, w = Math.max(3, Math.round(Math.sqrt(r.implied_value_usd / (D.rows[0].implied_value_usd || 1)) * 100));
var sub = r.category + (r.chains.length ? ' · ' + r.chains.slice(0, 2).join(', ') : '');
return '<tr data-slug="' + esc(r.slug) + '"><td class=rank>' + r.rank + '</td>' +
'<td><div class=pname>' + esc(r.name) + '</div><div class=psub>' + esc(sub) + '</div></td>' +
'<td class=r>' + usd(r.tvl_usd) + '</td><td class="r ' + (g === null || g === undefined ? '' : g >= 0 ? 'pos' : 'neg') + '">' + pct(g) + '</td>' +
'<td class=r>' + age(r.age_days) + '</td><td><span class=size>' + mult(r.size_mult) + '</span></td>' +
'<td class=imp><div class=impv>' + usd(r.implied_value_usd) + '</div><div class=impr>' + usd(r.implied_low) + ' to ' + usd(r.implied_high) + '</div><div class=impbar aria-hidden=true><i style="width:' + w + '%"></i></div></td>' +
'<td class=farmcell><span class="chip ' + r.farm.verdict + '">' + r.farm.verdict + '</span><span class=rate>' + usd(r.farm.perHour) + '/h</span></td></tr>';
}

/** rowsHtml(list) */
function rowsHtml(list) {
return list.length === 0 ? '<tr><td colspan=8 class=caption>No row matches these filters. Clear one to widen the ledger.</td></tr>' : list.map(rowHtml).join('');
}

/** filterBar() */
function filterBar() {
function options(values, all) { return '<option value=all>' + all + '</option>' + values.map(function (v) { return '<option>' + esc(v) + '</option>'; }).join(''); }
return '<div class=filters><div class=field><label for=q>Search</label><input id=q type=search value="' + esc(state.q) + '" placeholder="Name, slug, sector or chain"></div>' +
'<div class=field><label for=sector>Sector</label><select id=sector>' + options(D.sectors, 'All sectors') + '</select></div>' +
'<div class=field><label for=chain>Chain</label><select id=chain>' + options(D.chains, 'All chains') + '</select></div>' +
'<div class=field><label for=growth>Growth</label><select id=growth><option value=all>Any growth</option><option value=up20>Up 20% or more</option><option value=up>Up</option><option value=down>Down</option><option value=down20>Down 20% or more</option><option value=unknown>No 7d print</option></select></div>' +
'<label class=check for=farms><input id=farms type=checkbox> Farms only</label><button id=clear class=btn type=button>Clear</button><span id=count class=count></span></div>';
}

/** ladder() */
function ladder() {
var top = D.rows.slice(0, 10), logs = top.map(function (r) { return Math.log10(r.implied_value_usd); });
var lo = Math.min.apply(null, logs), hi = Math.max.apply(null, logs);
return '<section class=panel><div class=ph><h2>Value ladder</h2><span>ALL 200 ROWS, TOP 10</span></div><div class=ladder>' +
top.map(function (r, i) {
var w = hi > lo ? 18 + 82 * ((logs[i] - lo) / (hi - lo)) : 100;
return '<div class=lrow><span class="muted num">' + r.rank + '</span><div><div class=lname>' + esc(r.name) + '</div><div class=lbar><i style="width:' + w.toFixed(1) + '%"></i></div></div><span class=lval>' + usd(r.implied_value_usd) + '</span></div>';
}).join('') + '</div></section>';
}

/** formulaPanel() */
function formulaPanel() {
var m = D.model;
function chip(name, range) { return '<span class=fchip><b>' + name + ' </b>' + range + '</span>'; }
return '<section class=panel><div class=ph><h2>How implied value is built</h2><span>ONE FORMULA, 200 ROWS</span></div><div class=formula>implied = TVL x sizeCurve(TVL) x sector x growth x age x chains</div><div class=fchips>' +
chip('size', mult(m.size_min) + '–' + mult(m.size_max)) + chip('sector', '0.55x–1.8x') + chip('growth', mult(m.growth_min) + '–' + mult(m.growth_max)) +
chip('age', mult(m.age_min) + '–' + mult(m.age_max)) + chip('chains', '1x–' + mult(1 + m.chain_max)) + chip('band', '±' + m.band.toFixed(2) + ' dex') +
'</div><p class=tnote>Theil-Sen on ' + m.comps + ' live comps: slope ' + m.slope.toFixed(2) + ', intercept ' + m.intercept.toFixed(2) + '. The range is the residual interquartile range, ' + m.band.toFixed(2) + ' dex either side.</p></section>';
}

/** testPanel() */
function testPanel() {
var b = D.backtest;
function bar(label, t) { return '<div><div class=tl><span>' + label + '</span><b>' + t.inside + '/' + t.n + ' · ' + Math.round(t.share * 100) + '%</b></div><div class=tbar><i style="width:' + (t.share * 100).toFixed(1) + '%"></i></div></div>'; }
return '<section class=panel><div class=ph><h2>Blind tests</h2><span>SAME MODEL, HELD OUT</span></div><div class=tests>' + bar('Leave-one-out', b.loo) + bar('Newest 40%', b.newer) +
'<p class=tnote>Median miss ' + Math.pow(10, b.loo.medianError).toFixed(1) + 'x on leave-one-out, ' + Math.pow(10, b.newer.medianError).toFixed(1) + 'x on the newest 40%. Range band ' + b.band.toFixed(2) + ' dex.</p></div><div class=tnote>Every one of the ' + D.checks.rows + ' rows is recomputed from the model and matches board.json.</div></section>';
}

/** boardHtml() */
function boardHtml() {
return '<section class=shell>' + hero() + '<div class=board><section class=bmain>' + filterBar() + '<p class=caption>Ranked by implied value. Select a row for the factor waterfall and its farm plan.</p>' +
'<div class=tablebox><table><thead id=thead>' + thead() + '</thead><tbody id=rows></tbody></table></div></section>' +
'<aside class=side>' + ladder() + formulaPanel() + testPanel() + '</aside></div></section>';
}

/** refreshBoard() */
function refreshBoard() {
var list = visibleRows();
byId('count').textContent = list.length + ' of ' + D.board_size + ' rows';
byId('thead').innerHTML = thead();
byId('rows').innerHTML = rowsHtml(list);
}

/** fitBoard(): cap the table at a whole number of rows so the fold never slices one. */
function fitBoard() {
var tb = document.querySelector('.tablebox');
if (!tb) return;
if (window.innerWidth < 1180) { tb.style.maxHeight = ''; return; }
var t = tb.getBoundingClientRect().top + window.scrollY;
var side = document.querySelector('.side');
var rail = side ? side.getBoundingClientRect().bottom + window.scrollY : 0;
var limit = Math.min(window.innerHeight - 56 + window.scrollY, rail || Infinity);
var rows = tb.querySelectorAll('tbody tr'), bottom = 0, head = tb.querySelector('thead');
for (var i = 0; i < rows.length; i++) {
var rb = rows[i].getBoundingClientRect().bottom + window.scrollY;
if (rb > limit) break;
bottom = rb;
}
if (!bottom && head) bottom = head.getBoundingClientRect().bottom + window.scrollY;
var h = bottom ? bottom - t : 0;
tb.style.maxHeight = h > 120 ? Math.ceil(h) + 'px' : '';
}

/** wireBoard() */
function wireBoard() {
var q = byId('q'), sector = byId('sector'), chain = byId('chain'), growth = byId('growth'), farms = byId('farms');
sector.value = state.sector; chain.value = state.chain; growth.value = state.growth; farms.checked = state.farms;
q.addEventListener('input', function () { state.q = q.value; refreshBoard(); });
sector.addEventListener('change', function () { state.sector = sector.value; refreshBoard(); });
chain.addEventListener('change', function () { state.chain = chain.value; refreshBoard(); });
growth.addEventListener('change', function () { state.growth = growth.value; refreshBoard(); });
farms.addEventListener('change', function () { state.farms = farms.checked; refreshBoard(); });
byId('clear').addEventListener('click', function () {
state.q = ''; state.sector = 'all'; state.chain = 'all'; state.growth = 'all'; state.farms = false;
q.value = ''; sector.value = 'all'; chain.value = 'all'; growth.value = 'all'; farms.checked = false; refreshBoard();
});
byId('thead').addEventListener('click', function (e) {
var b = e.target.closest('button[data-sort]');
if (!b) return;
var key = b.getAttribute('data-sort');
if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; }
refreshBoard();
});
function open(e) { var tr = e.target.closest('tr[data-slug]'); if (tr) window.location.hash = '#/p/' + tr.getAttribute('data-slug'); }
byId('rows').addEventListener('click', open);
byId('rows').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
refreshBoard();
}

/** factorWidth(f): bar width in percent; 1x is half the track, 1.51x is three quarters. */
function factorWidth(f) { return Math.max(2, Math.min(100, 50 * f)); }

/** waterfall(row): factor bars scaled from 1x, TVL and implied value full width. */
function waterfall(row) {
var rows = [
['TVL', usd(row.tvl_usd), 'reported on ' + D.as_of, 100],
['Size curve', mult(row.size_mult), 'Theil-Sen fit, ' + D.model.comps + ' comps, slope ' + D.model.slope.toFixed(2), factorWidth(row.size_mult)],
['Sector', mult(row.sector_mult), row.category + ', ' + dex(row.sector_effect) + ' residual', factorWidth(row.sector_mult)],
['7d growth', mult(row.growth_mult), pct(row.change_7d) + ' vs ' + pct(row.sector_median) + ' sector median', factorWidth(row.growth_mult)],
['Time with no token', mult(row.age_mult), row.age_days === null ? 'no listing date' : row.age_days + ' days on record', factorWidth(row.age_mult)],
['Chains', mult(row.chain_mult), row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ': ' + row.chains.join(', '), factorWidth(row.chain_mult)]
];
return '<div class=wf>' + rows.map(function (r) {
return '<div class=wrow><div class=wlab><b>' + r[0] + '</b><span>' + esc(r[2]) + '</span></div><div class=wbar><i style="width:' + r[3] + '%"></i><span class=tick></span></div><div class=wval>' + r[1] + '</div></div>';
}).join('') + '<div class="wrow last"><div class=wlab><b>Implied value</b><span>range ' + usd(row.implied_low) + ' to ' + usd(row.implied_high) + '</span></div><div class=wbar><i style="width:100%"></i></div><div class=wval>' + usd(row.implied_value_usd) + '</div></div></div>' +
'<p class=caption>Bar scale: 1x is half the track, 0.2x is a fifth of the 1x bar, 1.51x is three quarters. TVL and implied value are full width.</p>';
}

/** compStrip(row) */
function compStrip(row) {
var values = [row.implied_low, row.implied_high, row.implied_value_usd].concat(row.comps.map(function (c) { return c.mcap_usd; })).filter(function (v) { return v > 0; });
var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values), a = Math.log10(lo), b = Math.log10(hi);
function pos(v) { return b <= a ? 50 : Math.max(1, Math.min(99, ((Math.log10(Math.max(v, lo)) - a) / (b - a)) * 100)); }
var left = pos(row.implied_low), width = Math.max(1, pos(row.implied_high) - left);
return '<div class=strip><div class=band style="left:' + left + '%;width:' + width + '%"></div>' +
row.comps.map(function (c) { return '<div class=dot style="left:' + pos(c.mcap_usd) + '%"></div>'; }).join('') +
'<div class=mark style="left:' + pos(row.implied_value_usd) + '%"></div></div>' +
'<div class=axis><span>' + usd(lo) + '</span><span>market cap, log scale</span><span>' + usd(hi) + '</span></div>';
}

/** compsTable(row) */
function compsTable(row) {
return '<table class="dtable"><thead><tr><th>Comp</th><th>Sector</th><th class=r>TVL</th><th class=r>Cap</th><th class=r>Multiple</th></tr></thead><tbody>' +
row.comps.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td class=muted>' + esc(c.category) + '</td><td class=r>' + usd(c.tvl_usd) + '</td><td class=r>' + usd(c.mcap_usd) + '</td><td class=r>' + mult(c.multiple) + '</td></tr>'; }).join('') +
'</tbody></table>';
}

var STEP_NAMES = ['Verify', 'Bridge and fund', 'Enter', 'Qualify', 'Upkeep', 'Stop rule', 'Exit', 'Claim'];
var STEP_DAYS = [0, 0, 1, 7, 14, 30, 80, 90];

/** timeline(farm) */
function timeline(farm) {
return '<ol class=timeline>' + farm.steps.map(function (s, i) {
var m = / Cost: \$([0-9.]+)\. Time: (\d+) min\.$/.exec(s);
var body = s.replace(/ Cost: \$[0-9.]+\. Time: \d+ min\.$/, '');
return '<li><span class=day>Day ' + STEP_DAYS[i] + '</span><b>' + STEP_NAMES[i] + '</b><span class=ct>$' + (m ? m[1] : '0') + ' · ' + (m ? m[2] : '0') + ' min</span><p>' + esc(body) + '</p></li>';
}).join('') + '</ol>';
}

/** costsTable(farm) */
function costsTable(farm) {
var slip = farm.ticket * 0.003, bridge = farm.cost - slip;
return '<table class=costs><tbody><tr><td>Bridge and gas</td><td>' + usd2(bridge) + '</td></tr><tr><td>Slippage on ' + usd(farm.ticket) + ' ticket</td><td>' + usd2(slip) + '</td></tr><tr class=total><td>Total cost</td><td>' + usd2(farm.cost) + '</td></tr></tbody></table>';
}

/** ktiles(farm) */
function ktiles(farm) {
function tile(label, value) { return '<div class=ktile><span>' + label + '</span><b>' + value + '</b></div>'; }
return '<div class=ktiles>' + tile('Expected at launch', usd(farm.expected)) + tile('Cost', usd2(farm.cost)) + tile('Net', usd(farm.net)) + tile('Net per hour', usd(farm.perHour) + '/h') + '</div>';
}

/** hoursText(min): 132 minutes reads as 2 h 12 min. */
function hoursText(min) { var h = Math.floor(min / 60), m = min % 60; return h + ' h' + (m ? ' ' + m + ' min' : ''); }

/** detailHtml(slug) */
function detailHtml(slug) {
var row = D.rows.filter(function (r) { return r.slug === slug; })[0];
if (!row) return '<section class="shell detail"><a class=back href="#/">&#8592; Back to the board</a><p class=caption>No row has that slug. It may be outside the 200 ranked rows.</p></section>';
var chains = row.chains.length ? row.chains.join(', ') : 'an unnamed chain';
return '<section class="shell detail"><a class=back href="#/">&#8592; Back to the board</a><div class=dhead><div><p class=kicker>Protocol dossier</p><h1>' + esc(row.name) + '</h1><p class=dmeta>Rank ' + row.rank + ' of ' + D.board_size + ', ' + esc(row.category) + ', ' + esc(chains) + ', TVL ' + usd(row.tvl_usd) + ', no token on record for ' + ageWords(row.age_days) + '.</p><p class=dmeta>Farm plan: ' + usd(row.farm.ticket) + ' ticket, expected ' + usd(row.farm.expected) + ', cost ' + usd2(row.farm.cost) + ', net ' + usd(row.farm.net) + ', ' + usd(row.farm.perHour) + '/h, total time ' + hoursText(row.farm.timeMin) + '.</p></div>' +
'<div class=dval><span class=lab>Implied value</span><span class=big>' + usd(row.implied_value_usd) + '</span><span class=rng>' + usd(row.implied_low) + ' to ' + usd(row.implied_high) + '</span></div></div>' +
'<div class=dgrid><div class=dcol><h2>Factor waterfall</h2><p class=caption>Each factor multiplies the one above; the last bar is the rounded implied value.</p>' + waterfall(row) +
'<h2 style="margin-top:28px">Nearest comps</h2><p class=caption>The three live protocols closest in TVL. The shaded band is the implied range; the rule is this row.</p>' + compStrip(row) + compsTable(row) +
'<h2 style="margin-top:28px">Farm economics</h2>' + ktiles(row.farm) + '</div>' +
'<div class=dcol><h2>Farm plan</h2><p class=caption>' + esc(row.farm.play) + ' · ' + row.farm.windowDays + ' days · ' + usd(row.farm.ticket) + ' ticket · ' + row.farm.hours + ' hours</p>' + timeline(row.farm) +
'<h2 style="margin-top:20px">Cost</h2>' + costsTable(row.farm) +
'<p class=risk>A launch is not promised. The expected value is 1.5% of the ticket at the implied price, and that allocation would be shared across every farmer. The stop rule exits if TVL falls 20% or seven-day growth drops below -30%. Window: ' + row.farm.windowDays + ' days.</p></div></div></section>';
}

/** campaign(capital, weeklyHours) */
function campaign(capital, weeklyHours) {
var timeLeft = weeklyHours * (D.model.window_days / 7), moneyLeft = capital, picked = [];
var ranked = D.rows.slice().sort(function (a, b) { return b.farm.perHour !== a.farm.perHour ? b.farm.perHour - a.farm.perHour : a.rank - b.rank; });
ranked.some(function (r) {
if (picked.length >= 10 || r.farm.hours > timeLeft) return true;
if (r.farm.ticket > moneyLeft) return false;
picked.push(r); moneyLeft -= r.farm.ticket; timeLeft -= r.farm.hours;
return picked.length >= 10;
});
return picked;
}

/** plannerBody(capital, weeklyHours) */
function plannerBody(capital, weeklyHours) {
var picked = campaign(capital, weeklyHours);
var s = picked.reduce(function (a, r) { a.ticket += r.farm.ticket; a.cost += r.farm.cost; a.expected += r.farm.expected; a.net += r.farm.net; a.hours += r.farm.hours; return a; }, { ticket: 0, cost: 0, expected: 0, net: 0, hours: 0 });
var per = s.hours > 0 ? s.net / s.hours : 0;
var tiles = '<div class=sum><div><span>Capital deployed</span><b>' + usd(s.ticket) + '</b></div><div><span>Cost</span><b>' + usd(s.cost) + '</b></div><div><span>Expected</span><b>' + usd(s.expected) + '</b></div><div><span>Net</span><b>' + usd(s.net) + '</b></div><div><span>Net per hour</span><b>' + usd(per) + '/h</b></div></div>';
if (picked.length === 0) return tiles + '<p class=caption>No farm fits that capital and time. Raise either budget.</p>';
var rows = picked.map(function (r) {
return '<tr><td class=num>' + r.rank + '</td><td><b>' + esc(r.name) + '</b><div class=psub>' + esc(r.category) + '</div></td><td>' + esc(r.farm.play) + '</td><td class=r>' + usd(r.farm.ticket) + '</td><td class=r>' + usd(r.farm.cost) + '</td><td class=r>' + r.farm.hours + ' h</td><td class=r>' + usd(r.farm.expected) + '</td><td class=r>' + usd(r.farm.net) + '</td><td class=r>' + usd(r.farm.perHour) + '/h</td></tr>';
}).join('');
return tiles + '<table class=ptable><thead><tr><th>#</th><th>Protocol</th><th>Play</th><th class=r>Ticket</th><th class=r>Cost</th><th class=r>Hours</th><th class=r>Expected</th><th class=r>Net</th><th class=r>Per hour</th></tr></thead><tbody>' + rows +
'<tr class=total><td colspan=3><b>Total</b> <span class=muted>' + picked.length + ' positions</span></td><td class=r>' + usd(s.ticket) + '</td><td class=r>' + usd(s.cost) + '</td><td class=r>' + s.hours.toFixed(1) + ' h</td><td class=r>' + usd(s.expected) + '</td><td class=r>' + usd(s.net) + '</td><td class=r>' + usd(per) + '/h</td></tr></tbody></table>';
}

/** plannerHtml() */
function plannerHtml() {
return '<section class="shell page"><div class=phead><div><p class=kicker>Planner · ' + D.model.window_days + '-day window</p><h1>Campaign planner</h1><p class=dek>Spend the capital and the time you actually have, best net per hour first. Each position takes a ticket of ' + usd(D.model.tickets[0]) + ' to ' + usd(D.model.tickets[D.model.tickets.length - 1]) + ', never more than 1% of its TVL, and ' + D.model.hours + ' hours.</p></div>' +
'<p class=caption>The board\u2019s top farm pays ' + usd(D.rows[0].farm.perHour) + '/h in the model. The planner caps the campaign at ten positions.</p></div>' +
'<div class=pcontrols><div><label for=cap>Capital</label><input id=cap type=range min=5000 max=50000 step=2500 value=50000><b id=capval class=val></b></div>' +
'<div><label for=hrs>Your time</label><input id=hrs type=range min=1 max=10 step=1 value=6><b id=hrsval class=val></b></div></div><div id=plan></div>' +
'<p class=plnote>Time available is the weekly hours times ' + (D.model.window_days / 7).toFixed(1) + ' weeks. The planner buys the highest net-per-hour rows while both budgets last; a row that cannot pay its ticket is skipped, and the ten-position cap keeps the work finite.</p></section>';
}

/** wirePlanner() */
function wirePlanner() {
var cap = byId('cap'), hrs = byId('hrs');
function draw() {
var capital = Number(cap.value), weekly = Number(hrs.value);
byId('capval').textContent = usd(capital);
byId('hrsval').textContent = weekly + ' h / week';
byId('plan').innerHTML = plannerBody(capital, weekly);
}
cap.addEventListener('input', draw);
hrs.addEventListener('input', draw);
draw();
}

/** asideHtml() */
function asideHtml() {
var rows = D.live.map(function (r) {
return '<tr><td><b>' + esc(r.name) + '</b><div class=psub>' + esc(r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + '</div></td><td class=r>' + usd(r.tvl_usd) + '</td><td class=r>' + usd(r.mcap_usd) + '</td><td class=r>' + mult(r.multiple) + '</td><td>' + esc(r.category) + '</td></tr>';
}).join('');
return '<section class="shell page"><div class=phead><div><p class=kicker>Set aside · ' + D.live_size + ' live tokens</p><h1>Already trading</h1></div><p class=dek>These protocols have a token and a market cap, so their number is a fact, not a model. They are the comps the size curve learns from and are kept out of the 200-row ranking.</p></div>' +
'<table class=ptable style="margin-top:18px"><thead><tr><th>Protocol</th><th class=r>TVL</th><th class=r>Market cap</th><th class=r>Multiple</th><th>Sector</th></tr></thead><tbody>' + rows + '</tbody></table></section>';
}

/** route() */
function route() {
var h = window.location.hash || '#/';
if (h.indexOf('#/p/') === 0) return { view: 'detail', slug: decodeURIComponent(h.slice(4)) };
if (h.indexOf('#/planner') === 0) return { view: 'planner' };
if (h.indexOf('#/aside') === 0) return { view: 'aside' };
return { view: 'board' };
}

/** render() */
function render() {
var r = route();
app.innerHTML = topbar(r.view) + (r.view === 'detail' ? detailHtml(r.slug) : r.view === 'planner' ? plannerHtml() : r.view === 'aside' ? asideHtml() : boardHtml());
if (r.view === 'board') { wireBoard(); fitBoard(); }
else if (r.view === 'planner') wirePlanner();
app.setAttribute('aria-busy', 'false');
if (r.view !== 'board') window.scrollTo(0, 0);
}

window.addEventListener('resize', function () { if (route().view === 'board') fitBoard(); });

window.addEventListener('hashchange', render);
render();
})();
