// src/lib/categoryMeta.ts
export type CatMeta = { label?: string; desc?: string };

export const CATEGORY_META: Record<string, CatMeta> = {
  "retail": {
    desc:
      "Department stores, specialty shops, and mall icons that shuttered—browse timelines, fates, and what led to the downfall.",
  },
  "retail-entertainment": {
    label: "Retail & Entertainment",
    desc:
      "Video rental, arcades, and music/movie retailers that couldn’t survive the digital turn.",
  },
  "food-beverage": {
    label: "Food & Beverage",
    desc:
      "Cereal, snacks, and soft drinks—limited runs, cult favorites, and why they vanished.",
  },
  "alcoholic-beverages": {
    label: "Alcoholic Beverages",
    desc:
      "Beers, malts, and RTDs that defined eras, then disappeared (and sometimes came back).",
  },
  "consumer-electronics": {
    label: "Consumer Electronics",
    desc:
      "Gadgets we loved—from music players to cameras—retired by smartphones or shifting tastes.",
  },
  "computers-hardware": {
    label: "Computers & Hardware",
    desc:
      "PC makers and components that shaped personal computing before being outpaced by new ecosystems.",
  },
  "mobile-wearables": {
    label: "Mobile & Wearables",
    desc:
      "Phones, PDAs, and smartwatches that set the pace for mobility—then ceded it.",
  },
  "software-internet": {
    label: "Software & Internet",
    desc:
      "Browsers, IM clients, P2P, and e-commerce pioneers—what they built, and why they ended.",
  },
  "video-games-consoles": {
    label: "Video Games & Consoles",
    desc:
      "Hardware and online worlds that battled for the living room—launches, closures, and legacy.",
  },
  "airline-aviation": {
    label: "Airlines & Aviation",
    desc:
      "Carriers that merged, rebranded, or ceased operations—routes, fleets, and consolidation timelines.",
  },
  "automotive": {
    desc:
      "Marques and halo models that defined eras, from mid-century giants to single-year cult icons.",
  },
  "finance-payments": {
    label: "Finance & Payments",
    desc:
      "Banks, crypto exchanges, and processors—rise, risk, regulation, and collapse.",
  },
  "healthcare-diagnostics": {
    label: "Healthcare & Diagnostics",
    desc:
      "Ambitious med-tech and diagnostics brands—promises, pivots, and regulatory reality.",
  },
};

// Helpers
export const labelFor = (slug: string, fallback?: string) =>
  CATEGORY_META[slug]?.label || fallback || slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

export const descFor = (slug: string, fallback?: string) =>
  CATEGORY_META[slug]?.desc || fallback || "";
