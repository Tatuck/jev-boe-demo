/**
 * Manual calibration: run Jev over one day's items and print a readable table.
 * Does not write to data/. Use --lang es to compare Spanish instructions against English.
 *
 *   pnpm calibrate --date 2026-09-17 --limit 15 [--lang en|es] [--section 1|2B|3] [--ids BOE-A-...,BOE-A-...]
 */
import { parseArgs } from "node:util";
import pLimit from "p-limit";
import { fetchItem, fetchSumario } from "./boe.ts";
import { CATEGORY_BY_ID, type Lang } from "./questions.ts";
import { askJev, LOW_CONFIDENCE } from "./analyze.ts";

const { values } = parseArgs({
  options: {
    date: { type: "string", default: yesterdayIso() },
    limit: { type: "string", default: "15" },
    lang: { type: "string", default: "en" },
    section: { type: "string" },
    ids: { type: "string" },
    full: { type: "boolean", default: false },
  },
});
const lang = values.lang as Lang;

const sumario = await fetchSumario(values.date!);
if (!sumario) {
  console.log(`No BOE for ${values.date}`);
  process.exit(0);
}
let list = sumario.items;
if (values.section) list = list.filter((i) => i.seccion === values.section);
if (values.ids) {
  const want = new Set(values.ids.split(","));
  list = list.filter((i) => want.has(i.id));
}
list = list.slice(0, Number(values.limit));
console.log(`BOE ${sumario.numero} (${values.date}) · ${list.length} items · lang=${lang}\n`);

const limit = pLimit(6);
const t0 = performance.now();
const rows = await Promise.all(
  list.map((s) =>
    limit(async () => {
      const item = await fetchItem(s);
      const r = await askJev(item, lang);
      return { item, r };
    }),
  ),
);
const wall = performance.now() - t0;

rows.sort((a, b) => b.r.analysis.relevancia.score - a.r.analysis.relevancia.score);
for (const { item, r } of rows) {
  const a = r.analysis;
  const cats = a.categorias.map((c) => `${CATEGORY_BY_ID.get(c.id)?.label} ${c.p}`).join(", ") || "—";
  const flag = a.relevancia.confidence < LOW_CONFIDENCE ? " ⚠ low conf" : "";
  console.log(`[${a.relevancia.score.toFixed(2)} c=${a.relevancia.confidence.toFixed(2)}${flag}] ${item.seccion} · ${item.rango ?? "?"} · ${r.jev_ms} ms · ${r.input_tokens} tok`);
  console.log(`  ${item.titulo.slice(0, 150)}`);
  console.log(`  cats: ${cats}`);
  if (a.oposicion) console.log(`  oposicion: nueva=${a.oposicion.nueva} libre=${a.oposicion.libre}`);
  if (a.extracto) console.log(`  » (${a.extracto.id} p=${a.extracto.p}) ${a.extracto.texto.slice(0, values.full ? 2000 : 220)}`);
  if (values.full) console.log(`  raw: ${JSON.stringify(a.categoriasRaw)}`);
  console.log();
}
const jevSum = rows.reduce((n, x) => n + x.r.jev_ms, 0);
console.log(`wall ${Math.round(wall)} ms · jev sum ${jevSum} ms · avg ${Math.round(jevSum / rows.length)} ms/item · tokens ${rows.reduce((n, x) => n + x.r.input_tokens, 0)}`);

function yesterdayIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
