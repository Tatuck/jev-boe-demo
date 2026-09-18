import { XMLParser } from "fast-xml-parser";
import type { BoeItem, Paragraph, SectionCode } from "./types.ts";

const SUMARIO_URL = "https://www.boe.es/datosabiertos/api/boe/sumario";
const ITEM_XML_URL = "https://www.boe.es/diario_boe/xml.php?id=";

/** Sections analyzed: I Disposiciones generales, II-B Oposiciones y concursos, III Otras disposiciones. */
export const SECTIONS: ReadonlySet<SectionCode> = new Set(["1", "2B", "3"]);

/** State budget sent to Jev per item (well under its 32k-token limit, keeps context rot low). */
export const MAX_CHARS = 20_000;
/** Jev's Choice accepts up to 255 options; keep excerpt candidates under that. */
export const MAX_PARAGRAPHS = 200;
/** A paragraph this long after an "ÍNDICE" heading is prose again, not an index entry. */
const INDEX_ENTRY_MAX_CHARS = 200;

const USER_AGENT = "boe-ciudadano-demo/0.1 (+https://github.com/Tatuck/jev-boe-demo/)";

/** BOE JSON returns single objects where a list has one element; normalize. */
function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** `2026-09-18` → `20260918`. */
export function toBoeDate(iso: string): string {
  return iso.replaceAll("-", "");
}

export interface SumarioItem {
  id: string;
  seccion: SectionCode;
  seccionNombre: string;
  departamento: string;
  epigrafe: string | null;
  titulo: string;
  urlHtml: string;
  urlPdf: string;
  urlXml: string;
}

export interface Sumario {
  date: string;
  numero: string;
  items: SumarioItem[];
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** Returns null when there is no BOE for that date (Sundays, holidays). */
export async function fetchSumario(isoDate: string): Promise<Sumario | null> {
  const json = await getJson(`${SUMARIO_URL}/${toBoeDate(isoDate)}`);
  if (json?.status?.code !== "200") return null;

  const items: SumarioItem[] = [];
  let numero = "";
  for (const diario of asArray<any>(json.data?.sumario?.diario)) {
    numero ||= String(diario.numero ?? "");
    for (const seccion of asArray<any>(diario.seccion)) {
      const code = String(seccion.codigo) as SectionCode;
      if (!SECTIONS.has(code)) continue;
      for (const dep of asArray<any>(seccion.departamento)) {
        const push = (it: any, epigrafe: string | null) =>
          items.push({
            id: it.identificador,
            seccion: code,
            seccionNombre: seccion.nombre,
            departamento: dep.nombre,
            epigrafe,
            titulo: it.titulo,
            urlHtml: it.url_html,
            urlPdf: it.url_pdf?.texto ?? "",
            urlXml: it.url_xml ?? `${ITEM_XML_URL}${it.identificador}`,
          });
        for (const ep of asArray<any>(dep.epigrafe)) {
          for (const it of asArray<any>(ep.item)) push(it, ep.nombre ?? null);
        }
        for (const it of asArray<any>(dep.item)) push(it, null);
      }
    }
  }
  return { date: isoDate, numero, items };
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " };

function decodeEntities(s: string): string {
  return s
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

/** Text of a parsed node that may carry attributes (`<rango codigo="1350">Real Decreto</rango>`). */
function nodeText(v: unknown): string | null {
  if (typeof v === "string") return v || null;
  if (v && typeof v === "object" && "#text" in v) return nodeText((v as any)["#text"]);
  return null;
}

/**
 * Extract top-level <p> text from the document body, dropping tables (their cells also carry <p>).
 * `<texto>` also appears inside <analisis><referencias>, so the body is the one after </analisis>.
 */
export function extractParagraphs(xml: string): string[] {
  const from = xml.indexOf("</analisis>");
  const start = xml.indexOf("<texto>", from === -1 ? 0 : from);
  const end = xml.lastIndexOf("</texto>");
  if (start === -1 || end === -1 || end < start) return [];
  const body = xml.slice(start + "<texto>".length, end).replace(/<table\b[\s\S]*?<\/table>/g, "");
  const out: string[] = [];
  for (const p of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = decodeEntities(p[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  }
  return out;
}

/** Long laws open with a table of contents ("ÍNDICE") of hundreds of short lines; drop it. */
export function stripIndex(all: string[]): string[] {
  const at = all.findIndex((t) => /^[ÍI]NDICE\.?$/i.test(t));
  if (at === -1) return all;
  let end = at + 1;
  while (end < all.length && all[end].length <= INDEX_ENTRY_MAX_CHARS) end++;
  return [...all.slice(0, at), ...all.slice(end)];
}

/** Keep the opening of the text (preamble / exposición de motivos) within the state budget. */
export function truncateParagraphs(all: string[]): { paragraphs: Paragraph[]; truncated: boolean } {
  const paragraphs: Paragraph[] = [];
  let chars = 0;
  for (const text of stripIndex(all)) {
    if (paragraphs.length >= MAX_PARAGRAPHS || chars + text.length > MAX_CHARS) break;
    paragraphs.push({ id: `p${paragraphs.length + 1}`, text });
    chars += text.length;
  }
  return { paragraphs, truncated: chars < all.reduce((n, t) => n + t.length, 0) };
}

export async function fetchItem(s: SumarioItem): Promise<BoeItem> {
  const res = await fetch(s.urlXml, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${s.urlXml}`);
  const xml = await res.text();
  const doc = parser.parse(xml)?.documento ?? {};
  const meta = doc.metadatos ?? {};
  const materias = asArray<any>(doc.analisis?.materias?.materia)
    .map(nodeText)
    .filter((x): x is string => x !== null);

  const all = extractParagraphs(xml);
  const { paragraphs, truncated } = truncateParagraphs(all);

  return {
    ...s,
    rango: nodeText(meta.rango),
    materias,
    paragraphs,
    truncated,
    totalParagraphs: all.length,
    totalChars: all.reduce((n, p) => n + p.length, 0),
  };
}
