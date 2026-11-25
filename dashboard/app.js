// Launch Ledger's page: the board, one protocol's dossier and the farm-only view. No network, no clock,
// no randomness. Every figure is a value the model published in data.js.
(function () {
'use strict';
var D = window.RADAR, M = window.RadarModel;
if (!D || !M) return;
var app = document.getElementById('app');
var state = { q: '', sector: 'all', chain: 'all', growth: 'all', farms: false, sort: 'implied', dir: -1 };
var FOCUS = (D.rows.filter(function (r) { return r.farm.verdict === 'FARM'; })[0] || D.rows[0]).slug;
var IMP_MAX = Math.max.apply(null, D.rows.map(function (r) { return r.implied_high || 1; })) || 1;
var STEP_NAMES = ['Verify', 'Bridge and fund', 'Enter', 'Qualify', 'Upkeep', 'Stop rule', 'Exit', 'Claim'];
var STEP_DAYS = [0, 0, 1, 7, 14, 30, 80, 90];

/** esc(s) */
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
/** trim(n) */
function trim(n) { var r = Math.round(n * 100) / 100; return r % 1 === 0 ? String(r) : r.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }
/** usd(n) */
function usd(n) {
if (n === null || n === undefined || !isFinite(n)) return 'n/a';
var a = Math.abs(n), sign = n < 0 ? '-' : '';
return sign + (a >= 1e9 ? '$' + trim(a / 1e9) + 'B' : a >= 1e6 ? '$' + (Math.round(a / 1e5) / 10).toFixed(1) + 'M' : a >= 1e3 ? '$' + Math.round(a / 1e3) + 'K' : '$' + Math.round(a));
}
/** usd2(n) */
function usd2(n) { return (n < 0 ? '-' : '') + '$' + (Math.round(Math.abs(n) * 100) / 100).toFixed(2); }
/** usdC(n): dollars and cents with thousands separators, for sums the reader will check. */
function usdC(n) { return (n < 0 ? '-' : '') + '$' + (Math.round(Math.abs(n) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
/** catName(c): the snapshot's category key as the page prints it. */
function catName(c) { return String(c) === 'Dexs' ? 'DEXs' : String(c); }
/** pct(n) */
function pct(n) { return n === null || n === undefined || !isFinite(n) ? 'no 7d' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
/** age(days) */
function age(days) { return days === null || days === undefined ? 'unknown' : days >= 365 ? (days / 365).toFixed(1) + ' y' : Math.round(days) + ' d'; }
/** ageWords(days) */
function ageWords(days) { return days === null || days === undefined ? 'an unknown number of days' : days.toLocaleString('en-US') + ' days'; }
/** mult(n) */
function mult(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : trim(n) + 'x'; }
/** byId(id) */
function byId(id) { return document.getElementById(id); }
/** hoursText(min) */
function hoursText(min) { var h = Math.floor(min / 60), m = min % 60; return h + ' h' + (m ? ' ' + m + ' min' : ''); }

/** topbar(active) */
function topbar(active) {
var nav = [['#/', 'Board', 'board'], ['#/p/' + FOCUS, 'Detail', 'detail'], ['#/farms', 'Farms', 'farms']];
return '<header class=topbar><div class=topbar-in><a class=wordmark href="#/"><i></i>LAUNCH LEDGER</a><nav class=topnav>' +
nav.map(function (n) { return '<a href="' + n[0] + '"' + (active === n[2] ? ' class=on' : '') + '>' + n[1] + '</a>'; }).join('') +
'</nav><div class=topright><span class=stamp>DefiLlama ' + D.as_of + '</span><span class=pill>watchlist ' + D.checks.watchlist_covered + '/' + D.checks.watchlist_total + '</span></div></div></header>';
}

/** kpi(label, value, note) */
function kpi(label, value, note) { return '<div class=kpi><span>' + label + '</span><b>' + value + '</b><em>' + note + '</em></div>'; }

/** hero(): six blind-test cards, every number from the build. */
function hero() {
var v = D.tests.value, o = D.tests.odds, b = D.model.band;
var vk = v.filter(function (t) { return t.kept; }).length, ok = o.filter(function (t) { return t.kept; }).length;
var sector = v[2], base = o[0], finalO = o[2];
return '<section class=hero><div><p class=kicker>Pre-token radar · ' + D.as_of + '</p><h1>What a token would be worth</h1><p class=dek>' +
D.scanned + ' protocols scanned: ' + D.ledger.ranked + ' ranked on the board, ' + D.ledger.pre + ' more pre-token under the floor, ' + D.ledger.token + ' already trading, ' +
D.ledger.cex + ' exchanges and ' + D.ledger.versioned + ' versioned pools set aside. Each row prices a launch, discounts it by the probability it happens, and prices the farm that pays for the attempt.</p></div><div class=kpis>' +
kpi('Range covers', Math.round(b.cover25 * 100) + '%/' + Math.round(b.newer25 * 100) + '%', 'P25-P75, blind and newer') +
kpi('Walk-forward miss', 'x' + Math.pow(10, sector.newer).toFixed(2), 'newest ' + b.newerN + ' tokens; flat x' + Math.pow(10, v[0].newer).toFixed(2)) +
kpi('Odds Brier', finalO.brier.toFixed(3), 'ten-fold; base rate ' + base.brier.toFixed(3)) +
kpi('Terms kept', vk + '/' + (v.length - 1) + ' + ' + ok + '/' + (o.length - 1), 'value and odds; both misses fall') +
kpi('Worth farming', D.farms + '/' + D.board_size, '$25/h after fees and slippage') +
kpi('Watchlist', D.checks.watchlist_covered + '/' + D.checks.watchlist_total, 'every slug ranked') +
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
if (key === 'odds') return r.odds;
if (key === 'ifl') return r.if_launched_usd;
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

/** th(label, key, cls) */
function th(label, key, cls) {
var on = state.sort === key;
return '<th' + (cls ? ' class="' + cls + '"' : '') + '><button type=button data-sort=' + key + '>' + label + (on ? (state.dir < 0 ? ' &darr;' : ' &uarr;') : '') + '</button></th>';
}

/** thead(): one row per protocol, the two legs then the product. */
function thead() {
return '<tr><th class=r><button type=button data-sort=implied>#</button></th><th>Protocol</th>' + th('TVL', 'tvl', 'r') + th('No token', 'age', 'r') +
th('Token odds', 'odds', 'r oddc') + th('If it launches', 'ifl', 'r') + th('Implied value', 'implied', 'r') + th('Farm $/h', 'perHour', 'r') + '</tr>';
}

/** rowHtml(r) */
function rowHtml(r) {
var g = r.change_7d;
function at(v) { return Math.min(100, Math.sqrt(Math.max(0, v) / IMP_MAX) * 100); }
var lo = at(r.implied_low), hi = at(r.implied_high), pt = at(r.implied_value_usd);
var sub = [catName(r.category)].concat(r.chains.slice(0, 2)).join(' · ') + ' · ' + pct(g);
return '<tr data-slug="' + esc(r.slug) + '"><td class=rank>' + r.rank + '</td>' +
'<td><div class=pname>' + esc(r.name) + '</div><div class=psub>' + esc(sub) + '</div></td>' +
'<td class=r>' + usd(r.tvl_usd) + '</td><td class=r>' + age(r.age_days) + '</td>' +
'<td class="r oddc"><span class=odd>' + Math.round(r.odds * 100) + '%</span><span class=obar aria-hidden=true><i style="width:' + Math.round(r.odds * 100) + '%"></i></span></td>' +
'<td class=r>' + usd(r.if_launched_usd) + '</td>' +
'<td class=imp><div class=impv>' + usd(r.implied_value_usd) + '</div><div class=impr>' + usd(r.implied_low) + ' to ' + usd(r.implied_high) + '</div><div class=impbar aria-hidden=true><i class=band style="left:' + lo.toFixed(1) + '%;width:' + Math.max(0.8, hi - lo).toFixed(1) + '%"></i><i class=point style="left:' + pt.toFixed(1) + '%"></i></div></td>' +
'<td class=farmcell title="' + esc(r.farm.play + ', ' + r.farm.verdict) + '"><span class="chip ' + r.farm.verdict + '">' + r.farm.verdict + '</span><span class=rate>' + usd(r.farm.perHour) + '/h</span></td></tr>';
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

/** panel(title, tag, body) */
function panel(title, tag, body) { return '<section class=panel><div class=ph><h2>' + title + '</h2><span>' + tag + '</span></div>' + body + '</section>'; }

/** modelPanel(): the two legs and their ranges. */
function modelPanel() {
var m = D.model, v = m.value, o = m.odds, b = m.band;
return panel('The two legs', 'ONE BOARD, TWO BLIND TESTS',
'<div class=formula>implied = ifLaunched(TVL, sector) x odds(age, TVL)</div>' +
'<div class=fchips><span class=fchip><b>value</b> ' + v.n + ' dated tokens</span><span class=fchip><b>odds</b> ' + o.n + ' protocols</span>' +
'<span class=fchip><b>P25-P75</b> ' + Math.pow(10, b.lo25).toFixed(2) + 'x–' + Math.pow(10, b.hi75).toFixed(2) + 'x</span>' +
'<span class=fchip><b>P10-P90</b> ' + Math.pow(10, b.lo10).toFixed(2) + 'x–' + Math.pow(10, b.hi90).toFixed(2) + 'x</span></div>' +
'<p class=tnote>The value leg fits log market cap on log TVL, plus a sector effect shrunk n/(n+' + v.cat_k + '). The odds leg is a ridge logistic on years without a token and TVL. The range is the value leg\'s own blind residual, so it can be checked.</p>');
}

/** termRow(t, kind) */
function termRow(t, kind) {
var a = kind === 'value' ? 'x' + Math.pow(10, t.loo).toFixed(2) : t.brier.toFixed(3);
var b = kind === 'value' ? 'x' + Math.pow(10, t.newer).toFixed(2) : t.newerBrier.toFixed(3);
return '<div class=trow><span class=tname>' + esc(t.term) + '</span><span>' + a + '</span><span>' + b + '</span><span class="' + (t.kept ? 'keep' : 'drop') + '">' + (t.kept ? 'kept' : t.control ? 'control' : 'drop') + '</span></div>';
}

/** termsPanel(): the printed keep rule and every term that lost. */
function termsPanel() {
return panel('Terms tested', 'KEPT ONLY IF BOTH MISSES FALL',
'<div class="trow th"><span class=tname>value term</span><span>LOO</span><span>newer</span><span></span></div>' +
D.tests.value.map(function (t) { return termRow(t, 'value'); }).join('') +
'<div class="trow th second"><span class=tname>odds term</span><span>Brier</span><span>newer</span><span></span></div>' +
D.tests.odds.map(function (t) { return termRow(t, 'odds'); }).join('') +
'<p class=tnote>Blind misses: leave-one-out, then the newest 40% by listing date. A control row sets the baseline and is not a term.</p>');
}

/** chk(text) */
function chk(text) { return '<div class=chk><i></i>' + text + '</div>'; }

/** ledgerPanel(): every protocol counted once, then six checks that can fail. */
function ledgerPanel() {
var l = D.ledger, c = D.checks, sum = [l.ranked, l.token, l.pre, l.cex, l.versioned].join(' + ');
function row(k, v) { return '<div class="lrow2"><span>' + k + '</span><b>' + v + '</b></div>'; }
return panel('Accounting, ' + D.ledger_sum, 'EVERY PROTOCOL ONCE',
'<div class=ledger>' + row('ranked pre-token', l.ranked) + row('token trading, set aside', l.token) + row('pre-token, unranked', l.pre) + row('exchange', l.cex) + row('versioned pool', l.versioned) +
'<div class="lrow2 total"><span>total</span><b>' + D.ledger_sum + '</b></div></div>' +
'<div class=strip6>' + chk(c.rows_recomputed + '/' + c.rows + ' rows recomputed') + chk(c.watchlist_covered + '/' + c.watchlist_total + ' watchlist ranked') +
chk(sum + ' = ' + D.ledger_sum) + chk(c.hardcoded_names + ' names hardcoded') + chk(c.comps_dated + ' dated comps') +
chk(c.sorted ? 'ranks 1-' + c.rows + ' monotone' : 'ranks not monotone') + '</div>');
}

/** boardHtml() */
function boardHtml() {
return '<section class=shell>' + hero() + '<div class=board><section class=bmain>' + filterBar() + '<p class=caption id=cap></p>' +
'<div class=tablebox><table><thead id=thead>' + thead() + '</thead><tbody id=rows></tbody></table></div><p class="caption more" id=more></p></section>' +
'<aside class=side>' + modelPanel() + termsPanel() + ledgerPanel() + '</aside></div></section>';
}

/** refreshBoard() */
function refreshBoard() {
var list = visibleRows();
byId('count').textContent = list.length + ' of ' + D.board_size + ' rows';
byId('cap').textContent = 'Ranked by implied value. Showing ' + list.length + ' of ' + D.board_size + ' ranked rows' + (state.farms ? ', only those that clear $25/h after fees' : '') +
'. Bars are scaled to implied value; the pale tail under each is the value leg\'s P25-P75 range.';
var more = byId('more');
if (more) more.textContent = list.length > 14 ? (list.length === D.board_size ? 'All ' + D.board_size + ' rows are in the table: scroll inside it for the rest, same columns.' : 'Scroll inside the table for the remaining ' + (list.length - 14) + ' rows.') : (list.length === 0 ? '' : list.length + ' rows here; open any one for its eight-step farm plan, the costs behind the net figure and its nearest comps.');
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

/** waterfall(row): TVL, the launch value, the odds, and the product. */
function waterfall(row) {
var tvl = row.tvl_usd, ifl = row.if_launched_usd, imp = row.implied_value_usd;
function scale(v) { return Math.max(3, Math.min(100, (v / tvl) * 100)); }
var rows = [
['TVL today', usd(tvl), 'snapshot ' + D.as_of, 100],
['If it launches', usd(ifl), 'log fit on TVL and sector', scale(ifl)],
['Odds it launches', Math.round(row.odds * 100) + '%', 'logistic on age and TVL', Math.round(row.odds * 100)],
['Implied value', usd(imp), 'launch value x odds', scale(imp)]
];
return '<div class=wf>' + rows.map(function (r, i) {
return '<div class="wrow' + (i === 3 ? ' last' : '') + '"><div class=wlab><b>' + r[0] + '</b><span>' + esc(r[2]) + '</span></div><div class=wbar><i style="width:' + r[3].toFixed(1) + '%"></i></div><div class=wval>' + r[1] + '</div></div>';
}).join('') + '</div><p class=caption>Rows 1, 2 and 4 share one money scale; row 3 is the probability. The value leg is fitted on ' + D.model.value.n + ' dated tokens, the odds leg on ' + D.model.odds.n + ' protocols. ' + (ifl / tvl).toFixed(2) + ' x ' + row.odds.toFixed(2) + ' = ' + (imp / tvl).toFixed(2) + ' of TVL.</p>';
}

/** compStrip(row) */
function compStrip(row) {
var values = [row.implied_low, row.implied_high, row.implied_value_usd].concat(row.comps.map(function (c) { return c.mcap_usd; })).filter(function (v) { return v > 0; });
var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values), a = Math.log10(lo), b = Math.log10(hi);
function pos(v) {
var f = b <= a ? 0.5 : (Math.log10(Math.max(v, lo)) - a) / (b - a);
return 4 + 92 * Math.max(0, Math.min(1, f));
}
var left = pos(row.implied_low), width = Math.max(1.5, pos(row.implied_high) - left);
return '<div class=strip><div class=band style="left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%"></div>' +
row.comps.map(function (c) { return '<div class=dot style="left:' + pos(c.mcap_usd).toFixed(2) + '%"></div>'; }).join('') +
'<div class=mark style="left:' + pos(row.implied_value_usd).toFixed(2) + '%"></div></div>' +
'<div class=axis><span>' + usd(lo) + '</span><span>market cap, log scale</span><span>' + usd(hi) + '</span></div>';
}

/** compsTable(row) */
function compsTable(row) {
return '<table class="dtable"><thead><tr><th>Comp</th><th>Sector</th><th class=r>TVL</th><th class=r>Cap</th><th class=r>Multiple</th></tr></thead><tbody>' +
row.comps.map(function (c) { return '<tr><td>' + esc(c.name) + '</td><td class=muted>' + esc(catName(c.category)) + '</td><td class=r>' + usd(c.tvl_usd) + '</td><td class=r>' + usd(c.mcap_usd) + '</td><td class=r>' + mult(c.multiple) + '</td></tr>'; }).join('') +
'</tbody></table>';
}

/** planTable(farm): WHEN, STEP, COST, TIME, one row per step. */
function planTable(farm) {
return '<table class=plan><thead><tr><th>When</th><th>Step</th><th class=r>Cost</th><th class=r>Time</th></tr></thead><tbody>' +
farm.steps.map(function (s, i) {
var m = / Cost: \$([0-9.]+)\. Time: (\d+) min\.$/.exec(s);
var body = s.replace(/ Cost: \$[0-9.]+\. Time: \d+ min\.$/, '');
return '<tr><td class=when>Day ' + STEP_DAYS[i] + '</td><td><b>' + STEP_NAMES[i] + '</b><p>' + esc(body) + '</p></td><td class=r>$' + (m ? m[1] : '0') + '</td><td class=r>' + (m ? m[2] : '0') + ' min</td></tr>';
}).join('') + '</tbody></table>';
}

/** costsTable(farm): the same three costs the plan rows print, summed. */
function costsTable(farm) {
var slip = farm.ticket * 0.003;
return '<table class=costs><tbody><tr><td>Bridge and funding gas</td><td>' + usd2(farm.bridge) + '</td></tr>' +
'<tr><td>Slippage on ' + usd(farm.ticket) + ' ticket</td><td>' + usd2(slip) + '</td></tr>' +
'<tr><td>Upkeep and exit gas</td><td>' + usd2(farm.upkeep + farm.exit) + '</td></tr>' +
'<tr class=total><td>Total cost</td><td>' + usd2(farm.cost) + '</td></tr></tbody></table>';
}

/** ktiles(farm) */
function ktiles(farm) {
function tile(label, value) { return '<div class=ktile><span>' + label + '</span><b>' + value + '</b></div>'; }
return '<div class=ktiles>' + tile('Expected at launch', usd(farm.expected)) + tile('Cost', usd2(farm.cost)) + tile('Net', usd(farm.net)) + tile('Net / hour', usd(farm.perHour)) + '</div>';
}

/** verdictBox(row): why this row carries its verdict, and what would move it. */
function verdictBox(row) {
var f = row.farm, perHourFloor = 25;
var need = (perHourFloor * f.hours + f.cost) * row.tvl_usd / (D.model.pool_share * f.ticket);
var half = f.expected / 2 - f.cost, halfHour = half / f.hours;
return '<div class=vrule><b class=vtag>' + f.verdict + '</b><p>FARM needs a positive net and at least ' + usd(perHourFloor) + '/h of work. This row nets ' + usd(f.net) + ' over ' + hoursText(f.timeMin) + ', or ' + usd(f.perHour) + '/h.</p></div>' +
'<ul class=vlist>' +
'<li>At a 1.5% pool share instead of ' + Math.round(D.model.pool_share * 100) + '%, the net falls to ' + usd(half) + ' (' + usd(halfHour) + '/h), which is THIN.</li>' +
'<li>An implied value under ' + usd(need) + ' takes the rate below ' + usd(perHourFloor) + '/h.</li>' +
'<li>A ticket is never more than 1% of TVL, so this ' + usd(f.ticket) + ' ticket needs TVL above ' + usd(100 * f.ticket) + '.</li>' +
'</ul>';
}

/** detailHtml(slug) */
function detailHtml(slug) {
var row = D.rows.filter(function (r) { return r.slug === slug; })[0];
if (!row) return '<section class="shell detail"><a class=back href="#/">&larr; Back to the board</a><p class=caption>No row has that slug. It may be outside the 200 ranked rows.</p></section>';
var chains = row.chains.length ? row.chains.join(', ') : 'an unnamed chain';
var recon = 'Ticket ' + usdC(row.farm.ticket) + ' + cost ' + usd2(row.farm.cost) + ' = ' + usdC(row.farm.ticket + row.farm.cost) + ' at risk. Expected ' + usd(row.farm.expected) + ' at launch. Net ' + usd(row.farm.net) + ' over ' + hoursText(row.farm.timeMin) + ', ' + usd(row.farm.perHour) + '/h. Verdict ' + row.farm.verdict + '.';
return '<section class="shell detail"><a class=back href="#/">&larr; Back to the board</a><div class=dhead><div><p class=kicker>Protocol dossier &middot; rank ' + row.rank + ' of ' + D.board_size + '</p><h1>' + esc(row.name) + '</h1>' +
'<p class=dmeta>' + esc(catName(row.category)) + ' &middot; ' + esc(chains) + ' &middot; TVL ' + usd(row.tvl_usd) + ' &middot; seven-day ' + pct(row.change_7d) + ' &middot; no token for ' + ageWords(row.age_days) + '.</p>' +
'<p class=dmeta>Farm plan: ' + usd(row.farm.ticket) + ' ticket, expected ' + usd(row.farm.expected) + ', cost ' + usd2(row.farm.cost) + ', net ' + usd(row.farm.net) + ', ' + usd(row.farm.perHour) + '/h, ' + hoursText(row.farm.timeMin) + ' of work.</p></div>' +
'<div class=dval><span class=lab>Implied value</span><span class=big>' + usd(row.implied_value_usd) + '</span><span class=rng>' + usd(row.implied_low) + ' to ' + usd(row.implied_high) + ' &middot; P25-P75</span></div></div>' +
'<div class=dgrid><div class=dcol><h2>How the number is built</h2><p class=caption>Launch value from the value leg, odds from the odds leg, range from the value leg\'s blind P25-P75.</p>' + waterfall(row) +
'<h2 class=gap>Farm plan</h2><p class=caption>' + esc(row.farm.play) + ' &middot; ' + row.farm.windowDays + ' days &middot; ' + usd(row.farm.ticket) + ' ticket &middot; ' + hoursText(row.farm.timeMin) + ' of work</p>' + planTable(row.farm) +
'<p class=risk>A launch is not promised. Expected value assumes farmers receive ' + Math.round(D.model.pool_share * 100) + '% of the implied value, shared pro rata across the protocol\'s TVL, and that pool is shared with every other farmer. Window: ' + row.farm.windowDays + ' days.</p>' +
'<p class=recon>' + recon + '</p></div>' +
'<div class=dcol><h2>Farm economics</h2>' + ktiles(row.farm) +
'<h2 class=gap>Cost</h2>' + costsTable(row.farm) +
'<h2 class=gap>Verdict rule</h2>' + verdictBox(row) +
'<h2 class=gap>Nearest comps</h2><p class=caption>The three live protocols closest in TVL. The band is this row\'s P25-P75 implied range; each dot is a comp\'s market cap.</p>' + compStrip(row) + compsTable(row) + '</div></div></section>';
}

/** route() */
function route() {
var h = window.location.hash || '#/';
if (h.indexOf('#/p/') === 0) return { view: 'detail', slug: decodeURIComponent(h.slice(4)) };
if (h.indexOf('#/farms') === 0) return { view: 'farms' };
return { view: 'board' };
}

/** render() */
function render() {
var r = route();
state.farms = r.view === 'farms';
app.innerHTML = topbar(r.view) + (r.view === 'detail' ? detailHtml(r.slug) : boardHtml());
if (r.view !== 'detail') { wireBoard(); fitBoard(); }
app.setAttribute('aria-busy', 'false');
if (r.view === 'detail') window.scrollTo(0, 0);
}

window.addEventListener('resize', function () { if (route().view !== 'detail') fitBoard(); });
window.addEventListener('hashchange', render);
render();
})();
