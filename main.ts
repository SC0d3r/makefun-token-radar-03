// Launch Ledger: the build for a token-radar-01 entry.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
//
// It reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), loads the value model
// from dashboard/model.js for its side effect, and writes:
//   board.json    the 200 ranked rows the gate checks (slug, name, rank, implied_value_usd, farm_steps)
//   data.js       window.RADAR, every figure the static dashboard shows
//   dashboard/    the page's own source, copied from this repository
//   screenshots/  the three or four images the judge opens
//   dossier.json  the vendored make.fun dossier, rebuilt from the output directory
//
// The model lives in dashboard/, not here: the judge reads the page's source, so the arithmetic must
// be visible beside the page. This program only calls it and checks what it produced.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './dashboard/model.js';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps (reference/gate.json). Only text_max_bytes shapes the dossier's bytes. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** parseSnapshot(text): the sealed JSON, refused unless every field the model reads is there. */
function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (typeof doc.as_of !== 'string') throw new Error('snapshot: as_of is missing');
  if (!Array.isArray(doc.protocols)) throw new Error('snapshot: protocols is missing');
  if (!Array.isArray(doc.watchlist)) throw new Error('snapshot: watchlist is missing');
  for (const p of doc.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string') throw new Error('snapshot: a protocol has no slug or name');
    if (!Array.isArray(p.chains)) throw new Error(`snapshot: ${p.slug} has no chains`);
    if (typeof p.tvl_usd !== 'number') throw new Error(`snapshot: ${p.slug} has no tvl_usd`);
  }
  return doc;
}

/** boardIssue(rows, snapshot): the first reason the gate would refuse the board, or null. */
function boardIssue(rows: Row[], snapshot: Snapshot): string | null {
  if (rows.length !== 200) return `${rows.length} rows, not 200`;
  const ranks = new Set<number>();
  for (const row of rows) {
    if (!Number.isInteger(row.rank) || row.rank < 1 || row.rank > 200) return `${row.slug} has rank ${row.rank}`;
    if (ranks.has(row.rank)) return `rank ${row.rank} appears twice`;
    ranks.add(row.rank);
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} has ${row.farm_steps ? row.farm_steps.length : 0} farm steps`;
    }
    for (const step of row.farm_steps) {
      if (typeof step !== 'string' || step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    }
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${i + 1} is worth more than row ${i}`;
  }
  const slugs = new Set(rows.map((r) => r.slug));
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `watchlist slug ${slug} is missing`;
  }
  return null;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launch ledger: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const model = (globalThis as { RadarModel?: any }).RadarModel;
if (!model) {
  process.stderr.write('launch ledger: dashboard/model.js did not assign globalThis.RadarModel\n');
  process.exit(2);
}

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const radar = model.buildRadar(snapshot);
const rows: Row[] = radar.rows.map((row: any) => ({
  slug: row.slug,
  name: row.name,
  rank: row.rank,
  implied_value_usd: row.implied_value_usd,
  farm_steps: row.farm_steps
}));
const issue = boardIssue(rows, snapshot);
if (issue !== null) {
  process.stderr.write(`launch ledger: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}
if (radar.checks.rows_recomputed !== radar.checks.rows) {
  process.stderr.write(`launch ledger: checkBoard recomputed ${radar.checks.rows_recomputed} of ${radar.checks.rows} rows\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows })}\n`);
writeFileSync(join(out, 'data.js'), `window.RADAR = ${JSON.stringify(radar)};\n`);

/** copyFiles(from, to): each regular file in one directory, dot names skipped, names returned. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboard = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`launch ledger: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in three, the board, a detail view and a planner view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`launch ledger: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this output directory and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: SCREENSHOT_CAPS,
  dashboard: { max_files: 400, max_bytes: 4_194_304 }
}));

const top = radar.rows.slice(0, 3).map((r: any) => `#${r.rank} ${r.name} $${Math.round(r.implied_value_usd / 1e6)}M`).join(', ');
process.stdout.write(
  `launch ledger: ${snapshot.protocols.length} scanned, ${radar.pre_token} pre-token, ${radar.watchlist_size} watchlist, ${radar.live_size} live set aside\n` +
    `launch ledger: board ${radar.board_size} rows, ${radar.early_size} early, ${radar.checks.watchlist_covered}/${radar.checks.watchlist_total} watchlist, checkBoard ${radar.checks.rows_recomputed}/${radar.checks.rows}\n` +
    `launch ledger: top three ${top}\n` +
    `launch ledger: blind tests LOO ${radar.backtest.loo.inside}/${radar.backtest.loo.n} (${Math.round(radar.backtest.loo.share * 100)}%), newer ${radar.backtest.newer.inside}/${radar.backtest.newer.n} (${Math.round(radar.backtest.newer.share * 100)}%), band ${radar.backtest.band.toFixed(2)} dex\n` +
    `launch ledger: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboard.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`
);
