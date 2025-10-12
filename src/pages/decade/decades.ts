// src/lib/decades.ts
export type Brand = { brand: string; slug: string; active?: { start?: string|number; end?: string|number } };

const toYear = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const m = String(v).match(/\d{3,4}/);
  if (!m) return undefined;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : undefined;
};
const decadeStart = (y: number) => Math.floor(y / 10) * 10;

/** Returns sorted decade starts (e.g., [1940, 1950, ...]) that actually exist in data. */
export function existingDecades(brands: Brand[]): number[] {
  const set = new Set<number>();
  for (const b of brands) {
    const y = toYear(b?.active?.end) ?? toYear(b?.active?.start);
    if (y !== undefined) set.add(decadeStart(y));
  }
  return [...set].sort((a, b) => a - b);
}
