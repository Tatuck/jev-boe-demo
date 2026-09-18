/**
 * Daily pipeline: BOE sumario → item XML → Jev → data/days/<date>.json + data/index.json
 *
 *   pnpm pipeline --today
 *   pnpm pipeline --date 2026-09-17 [--force]
 *   pnpm pipeline --backfill 7
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import pLimit from "p-limit";
import { fetchItem, fetchSumario, type SumarioItem } from "./boe.ts";
import { askJev, isRelevant, MODEL, toAnalyzedItem, type JevResult } from "./analyze.ts";
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
  },
});

const dates: string[] = [];
if (values.date) dates.push(values.date);
if (values.today) dates.push(madridToday());
if (values.backfill) {
  const n = Number(values.backfill);
  const today = madridToday();
  for (let i = 0; i < n; i++) dates.push(addDays(today, -i));
}
if (dates.length === 0) {
  console.error("Usage: pnpm pipeline --today | --date YYYY-MM-DD | --backfill N [--force]");
  process.exit(1);
}

await mkdir(DAYS_DIR, { recursive: true });
let written = 0;
for (const date of dates.sort()) {
  const ok = await processDay(date, values.force);
  if (ok) written++;
}
await writeIndex();
console.log(`done · ${written} day(s) written`);

async function processDay(date: string, force: boolean): Promise<boolean> {
  const file = path.join(DAYS_DIR, `${date}.json`);
  if (existsSync(file) && !force) {
    console.log(`${date} · exists, skip (use --force)`);
    return false;
  }
  const t0 = performance.now();
  const sumario = await fetchSumario(date);
  if (!sumario) {
    console.log(`${date} · no BOE published`);
    return false;
  }
  console.log(`${date} · BOE ${sumario.numero} · ${sumario.items.length} items in sections I, II-B, III`);

  const limit = pLimit(CONCURRENCY);
  const items = await Promise.all(sumario.items.map((s) => limit(() => processItem(s))));
  const wall_ms = Math.round(performance.now() - t0);

  items.sort((a, b) => (b.analysis?.relevancia.score ?? -1) - (a.analysis?.relevancia.score ?? -1));
  const stats = computeStats(items, wall_ms);
  const day: DayFile = { date, boe_numero: sumario.numero, model: modelUsed, generated_at: new Date().toISOString(), stats, items };
  await writeFile(file, JSON.stringify(day, null, 2) + "\n");
  console.log(
    `${date} · wrote ${items.length} items (${stats.failed} failed) · wall ${(wall_ms / 1000).toFixed(1)}s · jev avg ${stats.jev_ms_avg} ms · ${stats.input_tokens} tokens`,
  );
  return true;
}

async function processItem(s: SumarioItem): Promise<AnalyzedItem> {
  const t0 = performance.now();
  let item;
  try {
    item = await fetchItem(s);
  } catch (e) {
    console.warn(`  ${s.id} · fetch failed: ${msg(e)}`);
    return toAnalyzedItem(
      { ...s, rango: null, materias: [], paragraphs: [], truncated: false, totalParagraphs: 0, totalChars: 0 },
      performance.now() - t0,
      null,
      `fetch: ${msg(e)}`,
    );
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
  return toAnalyzedItem(item, fetch_ms, r, error);
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
