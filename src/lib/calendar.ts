/** Month grid data for the day picker. All arithmetic is UTC, like format.ts. */

export interface Month {
  /** YYYY-MM */
  key: string;
  /** "septiembre de 2026" */
  label: string;
  /** Rows of 7 cells, Monday first; ISO date or null for padding. */
  weeks: (string | null)[][];
}

export const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"] as const;

const monthLabel = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthOf(y: number, m0: number): Month {
  const first = new Date(Date.UTC(y, m0, 1));
  const daysInMonth = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Sunday=0 → Monday-first offset
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(iso(new Date(Date.UTC(y, m0, d))));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return { key: iso(first).slice(0, 7), label: monthLabel.format(first), weeks };
}

/** Every month between the oldest and newest date (inclusive), in chronological order. */
export function monthsBetween(dates: string[]): Month[] {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const [y0, m0] = sorted[0].split("-").map(Number);
  const [y1, m1] = sorted[sorted.length - 1].split("-").map(Number);
  const out: Month[] = [];
  for (let y = y0, m = m0 - 1; y < y1 || (y === y1 && m < m1); ) {
    out.push(monthOf(y, m));
    if (++m === 12) {
      m = 0;
      y++;
    }
  }
  return out;
}
