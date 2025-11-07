// src/lib/brandUtils.ts
// Shared helpers for homepage, A–Z, and brand pages

import { slugify } from "../lib/slug"; // adjust path if this file moves

/* ---------- Category labels ---------- */
export const CATEGORY_META: Record<string, { label: string }> = {
  retail: { label: "Retail" },
  "food-beverage": { label: "Food & Beverage" },
  "alcoholic-beverages": { label: "Alcoholic Beverages" },
  "consumer-electronics": { label: "Consumer Electronics" },
  "computers-hardware": { label: "Computers & Hardware" },
  "mobile-wearables": { label: "Mobile & Wearables" },
  "software-internet": { label: "Software & Internet" },
  "video-games-consoles": { label: "Video Games & Consoles" },
  "airlines-aviation": { label: "Airlines & Aviation" },
  automotive: { label: "Automotive" },
  "finance-payments": { label: "Finance & Payments" },
  "healthcare-diagnostics": { label: "Healthcare & Diagnostics" },
};

/* ---------- Canonicalizer: noisy → stable SEO slug ---------- */
export function normalizeCategory(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();

  if (lower === "retaiil" || lower === "retail ") return "retail";
  if (["retail/entertainment", "retail & entertainment", "retail-entertainment"].includes(lower))
    return "retail"; // merged taxonomy

  if (["food & beverage","food/beverage","food and beverage","food-beverage","food beverage"].includes(lower))
    return "food-beverage";
  if (["alcohol","alcoholic beverages","alcoholic-beverages","alcoholic beverage"].includes(lower))
    return "alcoholic-beverages";

  if (["consumer electronics","consumer-electronics"].includes(lower))
    return "consumer-electronics";
  if (["computers","computers & hardware","computers-hardware","computer hardware"].includes(lower))
    return "computers-hardware";
  if (["mobile devices","mobile","wearables","mobile & wearables","mobile-wearables","mobile-devices","wearables & mobile"].includes(lower))
    return "mobile-wearables";

  if (["software/internet","software & internet","software - internet","software internet","software-internet"].includes(lower))
    return "software-internet";

  if ([
    "video games & consoles","video-games-consoles","video games","video-games",
    "video game consoles","video-game-consoles","games & consoles"
  ].includes(lower))
    return "video-games-consoles";

  if ([
    "airline","airlines","aviation","airline/aviation","airline-aviation",
    "airlines-aviation","airlines & aviation"
  ].includes(lower))
    return "airlines-aviation";

  if (["finance","payments","finance & payments","finance-payments","finance/banking","finance/cryptocurrency","finance/payments"].includes(lower))
    return "finance-payments";

  if (["healthcare","diagnostics","healthcare & diagnostics","healthcare-diagnostics"].includes(lower))
    return "healthcare-diagnostics";

  if (["auto","automotive"].includes(lower))
    return "automotive";

  const slug = slugify(s);
  return CATEGORY_META[slug] ? slug : slug;
}

/* ---------- Years & decade helpers ---------- */
export const toYear = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const m = String(v).match(/\d{3,4}/);
  if (!m) return undefined;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : undefined;
};
export const decadeStart = (y: number) => Math.floor(y / 10) * 10;

export const yearsOf = (b: any) => {
  const start = b?.active?.start;
  const end = b?.active?.end;
  if (start && end) return `${start}\u2013${end}`;
  if (start && !end) return `${start}\u2013?`;
  if (!start && end) return `\u2013${end}`;
  return "";
};

/* ---------- Fate icon helpers ---------- */
export function fateTypeOf(b: any): string {
  const s = String(b?.fate || "").toLowerCase();
  if (!s) return "";
  if (s.includes("banned") || s.includes("ban by") || s.includes("federal ban")) return "banned";
  if (s.includes("recall") || s.includes("cpsc")) return "safety-recall";
  if (s.includes("bankrupt") || s.includes("chapter")) return "bankruptcy";
  if (s.includes("acquired") || s.includes("acquisition")) return "acquired";
  if (s.includes("merged") || s.includes("merge")) return "merged";
  if (s.includes("liquidat")) return "liquidated";
  if (s.includes("fraud") || s.includes("scandal")) return "fraud";
  if (s.includes("shutdown") || s.includes("closed") || s.includes("ceased")) return "shutdown";
  if (s.includes("crisis")) return "crisis";
  return "other";
}
export function fateIconOf(b: any): string {
  const map: Record<string, string> = {
    bankruptcy: "💥",
    acquired: "🤝",
    merged: "🔀",
    liquidated: "📉",
    fraud: "⚠️",
    "safety-recall": "⚠️",
    shutdown: "🔒",
    crisis: "🚨",
    banned: "🚫",
    other: "✨",
  };
  const t = fateTypeOf(b);
  return map[t] || map.other;
}

/* ---------- Text helpers ---------- */
export function primaryTextOf(b: any): string {
  const hook = (b?.hook ?? "").toString().trim();
  if (hook) return hook;
  const fate = (b?.fate ?? "").toString().trim();
  if (fate) return fate;
  const summary = (b?.summary ?? "").toString().trim();
  return summary;
}
export function truncateInline(text: string, max = 160) {
  const plain = String(text).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  return plain.slice(0, max - 1).replace(/\W?$/, "") + "…";
}

/* ---------- Visual tint helper ---------- */
export const hashHue = (s: string) => {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
};
export const catHue = (label: string) => hashHue((label || "brand") + "-vb");

/* ---------- Brand normalization ---------- */
export function normalizeBrands(modules: Record<string, any>) {
  const bySlug = new Map<string, any>();
  for (const raw of Object.values(modules)) {
    const b = (raw as any) || null;
    if (!b) continue;

    const key = String(b.slug || "").trim().toLowerCase() || slugify(String(b.brand || ""));
    if (!key) continue;

    const catRaw = (b.seo_category ?? b.category ?? "").toString().trim();
    if (!catRaw) continue;

    const canonicalCat = normalizeCategory(catRaw);
    if (!canonicalCat) continue;

    b.__seo_category = canonicalCat;
    b.__seo_category_label = CATEGORY_META[canonicalCat]?.label ?? catRaw;

    if (!bySlug.has(key)) bySlug.set(key, b);
  }
  return Array.from(bySlug.values());
}
