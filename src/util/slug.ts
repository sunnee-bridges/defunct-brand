// src/utils/slug.ts
export function slugifyCategory(s: string) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function titleCaseSlug(slug: string) {
  return String(slug)
    .split("-")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
}

export function normalizeCategories(raw: string[]) {
  const uniq = new Set<string>();
  for (const c of raw) {
    if (!c || c.toLowerCase() === "category") continue;
    uniq.add(c.trim());
  }
  return [...uniq].sort((a, b) => a.localeCompare(b));
}
