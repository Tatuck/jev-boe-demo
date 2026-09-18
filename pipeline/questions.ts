import { choice, noul, score, type EntryType, type Questions } from "@typesafe-ai/sdk";
import type { BoeItem } from "./types.ts";

export type Lang = "en" | "es";

export interface Category {
  id: string;
  /** Spanish label for the UI. */
  label: string;
  /** What the category covers, phrased for the Noul question. */
  en: string;
  es: string;
}

export const CATEGORIES: readonly Category[] = [
  { id: "vivienda", label: "Vivienda", en: "housing: renting, buying, mortgages, evictions, housing aid, urban planning that affects homes", es: "vivienda: alquiler, compra, hipotecas, desahucios, ayudas a la vivienda, urbanismo que afecta a hogares" },
  { id: "empleo-y-trabajo", label: "Empleo y trabajo", en: "employment and labour law for workers in general: contracts, wages, working hours, unemployment benefits, self-employed workers, collective agreements (NOT public sector job calls or civil service appointments)", es: "derecho laboral y empleo para trabajadores en general: contratos, salarios, jornada, prestaciones por desempleo, autónomos, convenios colectivos (NO convocatorias de empleo público ni nombramientos de funcionarios)" },
  { id: "impuestos-y-hacienda", label: "Impuestos y Hacienda", en: "taxes and public finances that individuals or small businesses pay: income tax, VAT, fees, tax deadlines, tax deductions", es: "impuestos y Hacienda que pagan particulares o pequeñas empresas: IRPF, IVA, tasas, plazos fiscales, deducciones" },
  { id: "pensiones-y-seguridad-social", label: "Pensiones y Seguridad Social", en: "pensions and social security: retirement, contributions, disability, sick leave, minimum income schemes", es: "pensiones y Seguridad Social: jubilación, cotizaciones, incapacidad, bajas, ingreso mínimo vital" },
  { id: "sanidad", label: "Sanidad", en: "health care: public health system, medicines, prices of drugs, patient rights, health professionals", es: "sanidad: sistema público de salud, medicamentos, precios de fármacos, derechos de pacientes, profesionales sanitarios" },
  { id: "educacion", label: "Educación", en: "education: schools, universities, scholarships, degrees, teacher qualifications, vocational training", es: "educación: colegios, universidades, becas, titulaciones, profesorado, formación profesional" },
  { id: "ayudas-y-subvenciones", label: "Ayudas y subvenciones", en: "grants, subsidies and public aid that people, families, associations or small businesses can apply for", es: "ayudas, subvenciones y prestaciones que pueden solicitar personas, familias, asociaciones o pequeñas empresas" },
  { id: "oposiciones-y-empleo-publico", label: "Oposiciones y empleo público", en: "public sector jobs: civil service exams (oposiciones), job openings, admitted candidate lists, exam dates, public employment offers", es: "empleo público: oposiciones, convocatorias de plazas, listas de admitidos, fechas de examen, ofertas de empleo público" },
  { id: "consumo-y-empresas", label: "Consumo y empresas", en: "consumers and businesses: consumer rights, product safety, prices, banking and insurance rules, company obligations, trade", es: "consumo y empresas: derechos del consumidor, seguridad de productos, precios, normas bancarias y de seguros, obligaciones de empresas, comercio" },
  { id: "transporte-y-trafico", label: "Transporte y tráfico", en: "transport and traffic: driving licences, vehicle rules, road safety, public transport, fares, aviation and rail for passengers", es: "transporte y tráfico: carnet de conducir, normas de vehículos, seguridad vial, transporte público, tarifas, aviación y ferrocarril para viajeros" },
  { id: "extranjeria", label: "Extranjería y nacionalidad", en: "immigration and nationality: residence permits, visas, asylum, Spanish citizenship, foreign residents", es: "extranjería y nacionalidad: permisos de residencia, visados, asilo, nacionalidad española, residentes extranjeros" },
  { id: "justicia-y-derechos", label: "Justicia y derechos", en: "justice and civil rights for citizens: access to courts, criminal law, family law, data protection, equality and anti-discrimination, elections, civil registry (NOT internal staffing of the Ministry of Justice or courts)", es: "justicia y derechos de los ciudadanos: acceso a los tribunales, derecho penal, derecho de familia, protección de datos, igualdad y no discriminación, elecciones, registro civil (NO la organización interna del Ministerio de Justicia ni de los juzgados)" },
  { id: "medio-ambiente-y-energia", label: "Medio ambiente y energía", en: "environment and energy: electricity and gas bills, energy efficiency, renewables, water, waste, climate rules, agriculture and fishing", es: "medio ambiente y energía: factura de luz y gas, eficiencia energética, renovables, agua, residuos, normas climáticas, agricultura y pesca" },
];

export const CATEGORY_BY_ID: ReadonlyMap<string, Category> = new Map(CATEGORIES.map((c) => [c.id, c]));

/** Assigned to an item when no category passes the threshold. */
export const OTHER_CATEGORY = { id: "otros", label: "Otros" } as const;

export const RELEVANCE_LEVELS = {
  en: [
    "Internal administration only, or concerns a single named person, company or organization (appointments, one contract, one grant to one entity). Nothing changes for the public.",
    "Affects a specific narrow group: one profession, one municipality, one industry or sector, one company's workers, candidates of one specific exam.",
    "Affects a broad group of citizens: e.g. self-employed workers, pensioners, students, tenants, families, drivers, everyone taking public exams, or all residents of one autonomous community.",
    "Affects most people in Spain: changes rights, obligations, taxes, prices, benefits, deadlines or daily procedures for the general public.",
  ],
  es: [
    "Solo administración interna, o afecta a una única persona, empresa u organización con nombre propio (nombramientos, un contrato, una subvención a una entidad). No cambia nada para el público.",
    "Afecta a un grupo concreto y reducido: una profesión, un municipio, un sector, los trabajadores de una empresa, los candidatos de una oposición concreta.",
    "Afecta a un grupo amplio de ciudadanos: p. ej. autónomos, pensionistas, estudiantes, inquilinos, familias, conductores, todos los opositores, o todos los residentes de una comunidad autónoma.",
    "Afecta a la mayoría de personas en España: cambia derechos, obligaciones, impuestos, precios, prestaciones, plazos o trámites cotidianos del público general.",
  ],
} as const satisfies Record<Lang, readonly [string, string, string, ...string[]]>;

/** Paragraphs shorter than this are headings or boilerplate; not offered as excerpt candidates. */
export const MIN_EXCERPT_CHARS = 80;

const T = {
  en: {
    relevance: "How directly does this official publication (`titulo`, `texto`) change things for ordinary people living in Spain?",
    category: (c: Category) => `Does this publication contain at least one concrete measure (a rule, aid, tax change, call, price, deadline or procedure) about ${c.en}? Judge from \`titulo\`, \`materias\` and \`texto\`.`,
    catYes: "Yes: someone following this topic would want to read this publication because it changes or offers something in it.",
    catNo: "No: the topic is unrelated, or is only mentioned in passing (a legal citation, background context, a name of a ministry).",
    excerpt: "Which paragraph of `texto` best explains, in plain terms, what this publication changes or offers, and for whom? Prefer a paragraph that states the concrete measure, its purpose, who it applies to, or the deadline. Never pick promulgation formulas, headings, legal citations, signatures or procedural formalities.",
    newCall: "Does this publication open a NEW call for public job positions (convoca plazas), as opposed to correcting a previous call, publishing admitted candidate lists, exam dates, tribunals or results?",
    openAccess: "Are the positions open to the general public (acceso libre / turno libre), rather than only internal promotion or existing civil servants?",
  },
  es: {
    relevance: "¿En qué medida esta publicación oficial (`titulo`, `texto`) cambia algo para las personas corrientes que viven en España?",
    category: (c: Category) => `¿Contiene esta publicación al menos una medida concreta (una norma, ayuda, cambio fiscal, convocatoria, precio, plazo o trámite) sobre ${c.es}? Juzga a partir de \`titulo\`, \`materias\` y \`texto\`.`,
    catYes: "Sí: quien siga este tema querría leer esta publicación porque cambia u ofrece algo en él.",
    catNo: "No: el tema no tiene relación, o solo se menciona de pasada (una cita legal, contexto, el nombre de un ministerio).",
    excerpt: "¿Qué párrafo de `texto` explica mejor, en términos llanos, qué cambia u ofrece esta publicación, y para quién? Prefiere un párrafo que exponga la medida concreta, su finalidad, a quién se aplica o el plazo. Nunca elijas fórmulas de promulgación, encabezados, citas legales, firmas ni formalidades de procedimiento.",
    newCall: "¿Esta publicación abre una convocatoria NUEVA de plazas de empleo público, en lugar de corregir una convocatoria anterior, publicar listas de admitidos, fechas de examen, tribunales o resultados?",
    openAccess: "¿Las plazas son de acceso libre (turno libre) para el público general, y no solo promoción interna o funcionarios ya existentes?",
  },
} as const;

/** The state Jev evaluates: metadata plus the identified paragraphs. */
export function buildState(item: BoeItem): EntryType {
  return {
    titulo: item.titulo,
    rango: item.rango ?? "",
    seccion: item.seccionNombre,
    departamento: item.departamento,
    materias: item.materias,
    texto: item.paragraphs.map((p) => ({ id: p.id, text: p.text })),
  };
}

/** Article/chapter headings and signature lines: never a good excerpt even when long. */
const HEADING_RE = /^(Artículo|Art\.|Disposición (adicional|transitoria|final|derogatoria)|Capítulo|CAPÍTULO|Título|TÍTULO|Sección|SECCIÓN|Anexo|ANEXO|Base \w+|Primera|Segunda|Tercera|Cuarta|Quinta|Sexta|Séptima|Octava|Novena|Décima)\b/;
const MAX_HEADING_CHARS = 260;

/** Promulgation formulas, signatures and other boilerplate that literally mention "citizens" but explain nothing. */
const BOILERPLATE_RE = /^(Sea notorio|A todos los que la presente|Por tanto, ordeno|Por tanto,? mando|Dado en |Madrid, \d|En su virtud|Lo que se hace público|Contra la presente|Esta resolución|La presente resolución)/i;

function isHeading(text: string): boolean {
  return (HEADING_RE.test(text) && text.length <= MAX_HEADING_CHARS) || BOILERPLATE_RE.test(text);
}

export function excerptCandidates(item: BoeItem): string[] {
  return item.paragraphs.filter((p) => p.text.length >= MIN_EXCERPT_CHARS && !isHeading(p.text)).map((p) => p.id);
}

/** All questions for one item, asked in a single request so Jev evaluates them in parallel. */
export function buildQuestions(item: BoeItem, lang: Lang = "en") {
  const t = T[lang];
  const questions: Questions = {
    relevancia: score(t.relevance, RELEVANCE_LEVELS[lang]),
  };
  for (const c of CATEGORIES) {
    questions[`cat_${c.id}`] = noul(t.category(c), { true: t.catYes, false: t.catNo });
  }
  const candidates = excerptCandidates(item);
  if (candidates.length > 0) {
    questions.extracto = choice(t.excerpt, Object.fromEntries(candidates.map((id) => [id, null])));
  }
  if (item.seccion === "2B") {
    questions.oposicion_nueva = noul(t.newCall);
    questions.oposicion_libre = noul(t.openAccess);
  }
  return questions;
}
