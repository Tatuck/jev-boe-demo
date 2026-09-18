/**
 * Daily pipeline: BOE sumario → item XML → Jev → data/days/<date>.json + data/index.json
 *
 *   pnpm pipeline --today
 *   pnpm pipeline --date 2026-09-17 [--force]
 *   pnpm pipeline --backfill 7
 *   pnpm pipeline --date 2026-09-17 --dry-run --verbose   # analyze and print, write nothing
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import pLimit from "p-limit";
import { fetchItem, fetchSumario, type SumarioItem } from "./boe.ts";
import { askJev, isRelevant, MODEL, toAnalyzedItem, type JevResult } from "./analyze.ts";
import { CATEGORY_BY_ID } from "./questions.ts";
import type { AnalyzedItem, DayFile, DayIndex, DayIndexEntry, DayStats } from "./types.ts";

const DATA_DIR = path.resolve(import.meta.dirname, "..", "data");
const DAYS_DIR = path.join(DATA_DIR, "days");
const CONCURRENCY = 6;

/** Resolved model id reported by the API (e.g. `jev-1.13.0` for the `jev-latest` alias). */
let modelUsed = MODEL;

const { values } = parseArgs({
  options: {
    date: { type: "string" },
    today: { type: "boolean", default: false },
    backfill: { type: "string" },
    force: { type: "boolean", default: false },
    /** Analyze but write nothing to data/ (also ignores existing day files). */
    "dry-run": { type: "boolean", default: false },
    /** One line per disposition as soon as Jev answers it. */
    verbose: { type: "boolean", default: false },
  },
});
const dryRun = values["dry-run"];

const dates: string[] = [];
if (values.date) dates.push(values.date);
if (values.today) dates.push(madridToday());
if (values.backfill) {
  const n = Number(values.backfill);
  const today = madridToday();
  for (let i = 0; i < n; i++) dates.push(addDays(today, -i));
}
if (dates.length === 0) {
  console.error("Usage: pnpm pipeline --today | --date YYYY-MM-DD | --backfill N [--force] [--dry-run] [--verbose]");
  process.exit(1);
}

if (!dryRun) await mkdir(DAYS_DIR, { recursive: true });
let written = 0;
for (const date of dates.sort()) {
  const ok = await processDay(date, values.force);
  if (ok) written++;
}
if (dryRun) {
  console.log(`done · dry run, nothing written`);
} else {
  await writeIndex();
  console.log(`done · ${written} day(s) written`);
}

async function processDay(date: string, force: boolean): Promise<boolean> {
  const file = path.join(DAYS_DIR, `${date}.json`);
  if (existsSync(file) && !force && !dryRun) {
    console.log(`${date} · exists, skip (use --force)`);
    return false;
  }
  const t0 = performance.now();
  const sumario = await fetchSumario(date);
  if (!sumario) {
    console.log(`${date} · no BOE published`);
    return false;
  }
  const total = sumario.items.length;
  console.log(`${date} · BOE ${sumario.numero} · ${total} items in sections I, II-B, III · ${CONCURRENCY} Jev calls in parallel`);

  let done = 0;
  const onDone = (item: AnalyzedItem): void => {
    done++;
    if (values.verbose) console.log(progressLine(item, done, total, performance.now() - t0));
  };
  const limit = pLimit(CONCURRENCY);
  const items = await Promise.all(sumario.items.map((s) => limit(() => processItem(s, onDone))));
  const wall_ms = Math.round(performance.now() - t0);

  items.sort((a, b) => (b.analysis?.relevancia.score ?? -1) - (a.analysis?.relevancia.score ?? -1));
  const stats = computeStats(items, wall_ms);
  const summary = `wall ${(wall_ms / 1000).toFixed(1)}s · jev avg ${stats.jev_ms_avg} ms · ${stats.input_tokens} tokens`;
  if (dryRun) {
    console.log(`${date} · analyzed ${items.length} items (${stats.failed} failed, ${stats.relevantes} relevant) · ${summary} · dry run, nothing written`);
    return false;
  }
  const day: DayFile = { date, boe_numero: sumario.numero, model: modelUsed, generated_at: new Date().toISOString(), stats, items };
  await writeFile(file, JSON.stringify(day, null, 2) + "\n");
  console.log(`${date} · wrote ${items.length} items (${stats.failed} failed) · ${summary}`);
  return true;
}

async function processItem(s: SumarioItem, onDone: (item: AnalyzedItem) => void): Promise<AnalyzedItem> {
  const t0 = performance.now();
  let item;
  try {
    item = await fetchItem(s);
  } catch (e) {
    console.warn(`  ${s.id} · fetch failed: ${msg(e)}`);
    const failed = toAnalyzedItem(
      { ...s, rango: null, materias: [], paragraphs: [], truncated: false, totalParagraphs: 0, totalChars: 0 },
      performance.now() - t0,
      null,
      `fetch: ${msg(e)}`,
    );
    onDone(failed);
    return failed;
  }
  const fetch_ms = performance.now() - t0;
  let r: JevResult | null = null;
  let error: string | null = null;
  try {
    r = await askJev(item);
    modelUsed = r.model;
  } catch (e) {
    error = `jev: ${msg(e)}`;
    console.warn(`  ${s.id} · ${error}`);
  }
  const analyzed = toAnalyzedItem(item, fetch_ms, r, error);
  onDone(analyzed);
  return analyzed;
}

/** `  1.9s  12/77  BOE-A-2026-19330  Ley           2.08  Educación, Sanidad +5   676 ms  17.9k tok` */
function progressLine(item: AnalyzedItem, done: number, total: number, elapsedMs: number): string {
  const a = item.analysis;
  const elapsed = `${(elapsedMs / 1000).toFixed(1)}s`.padStart(6);
  const count = `${String(done).padStart(String(total).length)}/${total}`;
  const kind = (item.rango ?? item.seccionNombre).slice(0, 12).padEnd(12);
  if (!a) return `${elapsed}  ${count}  ${item.id}  ${kind}  ----  ${item.error ?? "failed"}`;
  const labels = a.categorias.map((c) => CATEGORY_BY_ID.get(c.id)?.label ?? c.id);
  const tokens = `${(item.usage.input_tokens / 1000).toFixed(1)}k tok`.padStart(9);
  return `${elapsed}  ${count}  ${item.id}  ${kind}  ${a.relevancia.score.toFixed(2)}  ${fitLabels(labels, 48)}  ${String(item.timings.jev_ms).padStart(5)} ms  ${tokens}`;
}

/** Joins as many labels as fit in `width` columns, then `+N` for the rest; pads to `width`. */
function fitLabels(labels: string[], width: number): string {
  if (labels.length === 0) return "—".padEnd(width);
  let out = "";
  let used = 0;
  for (const l of labels) {
    const next = used === 0 ? l : `${out}, ${l}`;
    const rest = labels.length - used - 1;
    if (next.length + (rest ? ` +${rest}`.length : 0) > width) break;
    out = next;
    used++;
  }
  if (used === 0) out = labels[0]!.slice(0, width - 3);
  const rest = labels.length - used;
  return (rest ? `${out} +${rest}` : out).padEnd(width);
}

function computeStats(items: AnalyzedItem[], wall_ms: number): DayStats {
  const ok = items.filter((i) => i.analysis);
  const jev = ok.map((i) => i.timings.jev_ms);
  const sum = jev.reduce((a, b) => a + b, 0);
  return {
    items: items.length,
    analyzed: ok.length,
    failed: items.length - ok.length,
    relevantes: ok.filter((i) => isRelevant(i.analysis)).length,
    wall_ms,
    jev_ms_sum: sum,
    jev_ms_avg: jev.length ? Math.round(sum / jev.length) : 0,
    jev_ms_max: jev.length ? Math.max(...jev) : 0,
    jev_ms_min: jev.length ? Math.min(...jev) : 0,
    fetch_ms_sum: items.reduce((a, i) => a + i.timings.fetch_ms, 0),
    input_tokens: items.reduce((a, i) => a + i.usage.input_tokens, 0),
    concurrency: CONCURRENCY,
  };
}

async function writeIndex(): Promise<void> {
  const files = (await readdir(DAYS_DIR)).filter((f) => f.endsWith(".json")).sort();
  const days: DayIndexEntry[] = [];
  for (const f of files) {
    const d = JSON.parse(await readFile(path.join(DAYS_DIR, f), "utf8")) as DayFile;
    days.push({
      date: d.date,
      boe_numero: d.boe_numero,
      items: d.stats.items,
      relevantes: d.stats.relevantes,
      wall_ms: d.stats.wall_ms,
      jev_ms_sum: d.stats.jev_ms_sum,
      jev_ms_avg: d.stats.jev_ms_avg,
      input_tokens: d.stats.input_tokens,
    });
  }
  const index: DayIndex = { generated_at: new Date().toISOString(), days };
  await writeFile(path.join(DATA_DIR, "index.json"), JSON.stringify(index, null, 2) + "\n");
}

/** Today's date in Madrid, as the BOE counts days. */
function madridToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
