import { CATEGORIES, CATEGORY_BY_ID, OTHER_CATEGORY } from "@pipeline/questions.ts";
import { LOW_CONFIDENCE, RELEVANT_SCORE } from "@pipeline/analyze.ts";
import type { AnalyzedItem } from "@pipeline/types.ts";

export { CATEGORIES, CATEGORY_BY_ID, OTHER_CATEGORY, LOW_CONFIDENCE, RELEVANT_SCORE };

const es = "es-ES";

export function longDate(iso: string): string {
  return new Intl.DateTimeFormat(es, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(es, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

export function seconds(ms: number): string {
  return `${new Intl.NumberFormat(es, { maximumFractionDigits: 1 }).format(ms / 1000)} s`;
}

export function int(n: number): string {
  return new Intl.NumberFormat(es).format(n);
}

export function compact(n: number): string {
  return new Intl.NumberFormat(es, { notation: "compact", maximumFractionDigits: 0 }).format(n);
}

export function score1(n: number): string {
  return new Intl.NumberFormat(es, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
}

/** Jev pricing: $0.042 per million input tokens; output is free. */
export function usd(tokens: number): string {
  return new Intl.NumberFormat(es, { style: "currency", currency: "USD", maximumFractionDigits: 3 }).format((tokens / 1_000_000) * 0.042);
}

export const RELEVANCE_LABELS = ["Interno", "Grupo concreto", "Grupo amplio", "Mayoría"] as const;

export function relevanceLevel(score: number): 0 | 1 | 2 | 3 {
  return Math.min(3, Math.max(0, Math.round(score))) as 0 | 1 | 2 | 3;
}

export function categoryLabel(id: string): string {
  return id === OTHER_CATEGORY.id ? OTHER_CATEGORY.label : (CATEGORY_BY_ID.get(id)?.label ?? id);
}

/** Category ids used for filtering; falls back to "otros" when Jev assigned none. */
export function itemCategories(item: AnalyzedItem): string[] {
  const ids = item.analysis?.categorias.map((c) => c.id) ?? [];
  return ids.length ? ids : [OTHER_CATEGORY.id];
}

export const SECTION_SHORT: Record<string, string> = {
  "1": "Disposiciones generales",
  "2B": "Oposiciones y concursos",
  "3": "Otras disposiciones",
};
