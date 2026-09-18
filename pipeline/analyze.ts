import { TypeSafeClient, type ChoiceResponse, type NoulResponse, type ScoreResponse } from "@typesafe-ai/sdk";
import { buildQuestions, buildState, CATEGORIES, type Lang } from "./questions.ts";
import type { Analysis, AnalyzedItem, BoeItem, CategoryHit } from "./types.ts";

/** Thresholds applied in code; raw probabilities are stored so they can be re-tuned without re-running Jev. */
export const CATEGORY_THRESHOLD = 0.6;
export const RELEVANT_SCORE = 2.0;
export const LOW_CONFIDENCE = 0.4;

export const MODEL = process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest";

let client: TypeSafeClient | null = null;
export function getClient(): TypeSafeClient {
  client ??= new TypeSafeClient({ defaultModel: MODEL, timeout: 60_000 });
  return client;
}

export interface JevResult {
  analysis: Analysis;
  model: string;
  jev_ms: number;
  input_tokens: number;
}

/** One Jev request per item: relevance score, one Noul per category, excerpt choice, oposiciones extras. */
export async function askJev(item: BoeItem, lang: Lang = "en"): Promise<JevResult> {
  const questions = buildQuestions(item, lang);
  const t0 = performance.now();
  const res = await getClient().systemOne({ state: buildState(item), questions });
  const jev_ms = Math.round(performance.now() - t0);

  const answers = res.answers as Record<string, ScoreResponse | NoulResponse | ChoiceResponse>;
  const rel = answers.relevancia as ScoreResponse;

  const categoriasRaw: Record<string, number> = {};
  const categorias: CategoryHit[] = [];
  for (const c of CATEGORIES) {
    const p = (answers[`cat_${c.id}`] as NoulResponse).noul;
    categoriasRaw[c.id] = round(p);
    if (p >= CATEGORY_THRESHOLD) categorias.push({ id: c.id, p: round(p) });
  }
  categorias.sort((a, b) => b.p - a.p);

  let extracto: Analysis["extracto"] = null;
  const ex = answers.extracto as ChoiceResponse | undefined;
  if (ex) {
    const para = item.paragraphs.find((p) => p.id === ex.choice);
    if (para) {
      extracto = { id: ex.choice, texto: para.text, p: round(ex.probabilities[ex.choice] ?? 0), confidence: round(ex.confidence) };
    }
  }

  const analysis: Analysis = {
    relevancia: {
      score: round(rel.score),
      confidence: round(rel.confidence),
      probabilities: Object.fromEntries(Object.entries(rel.probabilities).map(([k, v]) => [k, round(v)])),
    },
    categorias,
    categoriasRaw,
    extracto,
  };
  if (answers.oposicion_nueva && answers.oposicion_libre) {
    analysis.oposicion = {
      nueva: round((answers.oposicion_nueva as NoulResponse).noul),
      libre: round((answers.oposicion_libre as NoulResponse).noul),
    };
  }
  return { analysis, model: res.model, jev_ms, input_tokens: res.usage.input_tokens };
}

export function isRelevant(a: Analysis | null): boolean {
  return a !== null && a.relevancia.score >= RELEVANT_SCORE;
}

export function toAnalyzedItem(item: BoeItem, fetch_ms: number, r: JevResult | null, error: string | null): AnalyzedItem {
  const { paragraphs: _p, ...meta } = item;
  return {
    ...meta,
    analysis: r?.analysis ?? null,
    error,
    timings: { fetch_ms: Math.round(fetch_ms), jev_ms: r?.jev_ms ?? 0 },
    usage: { input_tokens: r?.input_tokens ?? 0 },
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
