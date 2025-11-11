// src/content/config.ts
import { defineCollection, z } from "astro:content";

/** Accept Date or ISO string and ensure it parses */
const dateLike = z.union([z.string(), z.date()]);
const isValidDate = (v: unknown) =>
  v instanceof Date ? Number.isFinite(+v) :
  typeof v === "string" ? Number.isFinite(+new Date(v)) :
  false;

const post = defineCollection({
  type: "content",
  schema: z.object({
    // Basics
    title: z.string().min(1, "title is required"),
    description: z.string().min(1, "description is required").max(260, "description must be ≤260 chars"),

    // One of these is required (enforced below)
    date: dateLike.optional(),
    publishDate: dateLike.optional(),

    updated: dateLike.optional(),
    author: z.string().default("Vanished Brands"),

    // Rich image or simple string
    image: z.union([
      z.object({
        src: z.string(),
        alt: z.string().default(""),
        credit: z.string().optional(),
        source: z.string().optional(),   // e.g., Commons page
        license: z.string().optional(),  // e.g., "CC BY 4.0"
        attribution_html: z.string().optional(),
        fit: z.enum(["cover","contain"]).optional(), // <-- add this to support collage contain
      }),
      z.string(),
    ]).optional(),

    tags: z.array(z.string()).default([]),
    topics: z.array(z.string()).default([]),
    brands: z.array(z.string()).default([]),

    draft: z.boolean().default(false),
    featured: z.boolean().optional().default(false),
    category: z.string().optional(),
    keywords: z.array(z.string()).default([]).optional(),
    relatedBrands: z.array(z.string()).default([]).optional(),

    // Extras your templates reference
    hero: z.boolean().optional(),
    slug: z.string().optional(),
    canonical: z.string().optional(),
  }).superRefine((val, ctx) => {
    // Require either date or publishDate
    if (!val.date && !val.publishDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publishDate"],
        message: "Provide either `date` or `publishDate`.",
      });
    }

    // Validate dates if present
    ([
      ["date", val.date],
      ["publishDate", val.publishDate],
      ["updated", val.updated],
    ] as const).forEach(([key, v]) => {
      if (v != null && !isValidDate(v)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `Invalid ${key}: use a valid ISO date string (YYYY-MM-DD) or Date`,
        });
      }
    });
  }),
});

/**
 * Existing map-style topics data (unchanged)
 * Example shape:
 * {
 *   "90s-nostalgia": { label: "...", desc: "..." }
 * }
 */
const topics = defineCollection({
  type: "data",
  schema: z.record(z.object({
    label: z.string(),
    desc: z.string(),
    descLong: z.string().optional(),
    heroImage: z.string().optional(),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  })),
});

/**
 * NEW: taxonomy collection for dynamic /category/* and /topics/* intros
 * Create files like:
 *   /src/content/taxonomy/category-consumer-products.json
 *   /src/content/taxonomy/topic-90s-nostalgia.json
 */
const taxonomy = defineCollection({
  type: "data",
  schema: z.object({
    kind: z.enum(["category","topic"]),
    slug: z.string(),             // e.g. "consumer-products" or "90s-nostalgia"
    title: z.string().optional(), // optional human-readable title
    intro_md: z.string().optional(), // Markdown intro you render on the page
    hero: z.object({
      src: z.string(),
      alt: z.string().optional(),
    }).optional(),
    lastmod: z.string().optional(), // e.g. "2025-11-10"
  }),
});

export const collections = { post, topics, taxonomy };
