// src/lib/brandUtils.ts
// Shared helpers for homepage, A–Z, and brand pages

import { slugify } from "../lib/slug"; // adjust path if this file moves

/* ---------- Category labels ---------- */
export const CATEGORY_META: Record<string, { label: string }> = {
  retail: { label: "Retail" },
  "retail-entertainment": { label: "Retail & Entertainment" },
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
  "toys-games": { label: "Toys & Games" },
  "consumer-products": { label: "Consumer Products" },
};

/* ---------- Canonicalizer: noisy → stable SEO slug ---------- */
export function normalizeCategory(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();

  // ── Retail ──────────────────────────────────────────────────────────
  if (["retail", "retaiil",
       "retail/home goods", "retail/footwear",
       "retail/apparel"].includes(lower))
    return "retail";

  // ── Retail & Entertainment ───────────────────────────────────────────
  if (["retail/entertainment", "retail & entertainment",
       "retail-entertainment", "retail/video rental"].includes(lower))
    return "retail-entertainment";

  // ── Food & Beverage ──────────────────────────────────────────────────
  if (["food & beverage", "food/beverage", "food and beverage",
       "food-beverage", "food beverage", "food/cpg", "food/snacks",
       "food/confectionery", "food/condiments", "food/candy",
       "food/breakfast cereal", "confectionery/gum", "confectionery/candy",
       "beverages/non-alcoholic", "beverages/soft drinks",
       "beverages/energy drinks", "beverage/promotions"].includes(lower))
    return "food-beverage";

  // ── Alcoholic Beverages ──────────────────────────────────────────────
  if (["alcohol", "alcoholic beverages", "alcoholic-beverages",
       "alcoholic beverage", "beverages/alcohol", "beverages (alcohol)",
       "flavored malt beverage"].includes(lower))
    return "alcoholic-beverages";

  // ── Consumer Electronics ─────────────────────────────────────────────
  if (["consumer electronics", "consumer-electronics",
       "consumer electronics/mp3 players"].includes(lower))
    return "consumer-electronics";

  // ── Consumer Products ────────────────────────────────────────────────
  if (["consumer products", "consumer-products",
       "consumer products/beauty", "consumer products & beauty",
       "beauty", "cosmetics", "cosmetics/beauty",
       "personal care", "personal-care"].includes(lower))
    return "consumer-products";

  // ── Computers & Hardware ─────────────────────────────────────────────
  if (["computers", "computers & hardware", "computers-hardware",
       "computer hardware", "computers and hardware"].includes(lower))
    return "computers-hardware";

  // ── Mobile & Wearables ───────────────────────────────────────────────
  if (["mobile devices", "mobile", "wearables", "mobile & wearables",
       "mobile-wearables", "mobile-devices", "wearables & mobile",
       "mobile and wearables"].includes(lower))
    return "mobile-wearables";

  // ── Software & Internet ──────────────────────────────────────────────
  if (["software/internet", "software & internet", "software - internet",
       "software internet", "software-internet", "e-commerce", "ecommerce",
       "games/social media", "games/mobile apps"].includes(lower))
    return "software-internet";

  // ── Video Games & Consoles ───────────────────────────────────────────
  if (["video games & consoles", "video-games-consoles", "video games",
       "video-games", "video game consoles", "video-game-consoles",
       "games & consoles"].includes(lower))
    return "video-games-consoles";

  // ── Airlines & Aviation ──────────────────────────────────────────────
  if (["airline", "airlines", "aviation", "airline/aviation",
       "airline-aviation", "airlines-aviation",
       "airlines & aviation"].includes(lower))
    return "airlines-aviation";

  // ── Automotive ───────────────────────────────────────────────────────
  if (["auto", "automotive", "motorcycles/automotive"].includes(lower))
    return "automotive";

  // ── Finance & Payments ───────────────────────────────────────────────
  if (["finance", "payments", "finance & payments", "finance-payments",
       "finance/banking", "finance/cryptocurrency", "finance/payments"].includes(lower))
    return "finance-payments";

  // ── Healthcare & Diagnostics ─────────────────────────────────────────
  if (["healthcare", "diagnostics", "healthcare & diagnostics",
       "healthcare-diagnostics", "healthcare/diagnostics"].includes(lower))
    return "healthcare-diagnostics";

  // ── Toys & Games ─────────────────────────────────────────────────────
  if (["toys", "games", "toys/games", "toys & games", "toys and games",
       "toy", "board games", "toys-games"].includes(lower))  // ← lower, not s
    return "toys-games";

  // Fallback — if you see unexpected slugs, the raw value from that
  // brand JSON is hitting this line. Add a mapping above to catch it.
  return slugify(s);
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
