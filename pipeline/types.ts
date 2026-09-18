/** Shared types between the pipeline (writer) and the Astro site (reader). */

export type SectionCode = "1" | "2B" | "3";

export interface Paragraph {
  id: string;
  text: string;
}

/** A BOE disposition as fetched and normalized, before any Jev analysis. */
export interface BoeItem {
  id: string;
  seccion: SectionCode;
  seccionNombre: string;
  departamento: string;
  epigrafe: string | null;
  rango: string | null;
  titulo: string;
  materias: string[];
  urlHtml: string;
  urlPdf: string;
  urlXml: string;
  /** Paragraphs sent to Jev (possibly truncated). */
  paragraphs: Paragraph[];
  truncated: boolean;
  totalParagraphs: number;
  totalChars: number;
}

export interface CategoryHit {
  id: string;
  p: number;
}

export interface Analysis {
  relevancia: {
    /** Expected score on the 0–3 rubric. */
    score: number;
    confidence: number;
    probabilities: Record<string, number>;
  };
  categorias: CategoryHit[];
  /** Every category probability, for debugging and threshold tuning. */
  categoriasRaw: Record<string, number>;
  extracto: {
    id: string;
    texto: string;
    p: number;
    confidence: number;
  } | null;
  oposicion?: {
    nueva: number;
    libre: number;
  };
}

export interface AnalyzedItem extends Omit<BoeItem, "paragraphs"> {
  analysis: Analysis | null;
  error: string | null;
  timings: {
    fetch_ms: number;
    jev_ms: number;
  };
  usage: {
    input_tokens: number;
  };
}

export interface DayStats {
  items: number;
  analyzed: number;
  failed: number;
  relevantes: number;
  /** Wall-clock time for the whole day: sumario + item fetches + Jev, with concurrency. */
  wall_ms: number;
  jev_ms_sum: number;
  jev_ms_avg: number;
  jev_ms_max: number;
  jev_ms_min: number;
  fetch_ms_sum: number;
  input_tokens: number;
  concurrency: number;
}

export interface DayFile {
  date: string;
  boe_numero: string;
  model: string;
  generated_at: string;
  stats: DayStats;
  items: AnalyzedItem[];
}

export interface DayIndexEntry {
  date: string;
  boe_numero: string;
  items: number;
  relevantes: number;
  wall_ms: number;
  jev_ms_sum: number;
  jev_ms_avg: number;
  input_tokens: number;
}

export interface DayIndex {
  generated_at: string;
  days: DayIndexEntry[];
}
