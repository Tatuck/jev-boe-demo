import type { DayFile, DayIndex } from "@pipeline/types.ts";
import index from "@data/index.json";

const modules = import.meta.glob<{ default: DayFile }>("/data/days/*.json", { eager: true });

const days = new Map<string, DayFile>();
for (const m of Object.values(modules)) days.set(m.default.date, m.default);

/** All available dates, newest first. */
export const dates: string[] = [...days.keys()].sort().reverse();

export const dayIndex = index as DayIndex;

export function getDay(date: string): DayFile | undefined {
  return days.get(date);
}

export function latestDate(): string {
  return dates[0];
}

/** Adjacent published days (skips Sundays / holidays automatically since they have no file). */
export function neighbours(date: string): { prev: string | null; next: string | null } {
  const i = dates.indexOf(date);
  return {
    prev: i >= 0 && i + 1 < dates.length ? dates[i + 1] : null,
    next: i > 0 ? dates[i - 1] : null,
  };
}
