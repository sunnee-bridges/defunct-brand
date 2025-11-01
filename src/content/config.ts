// src/content/config.ts
import { defineCollection, z } from "astro:content";

const post = defineCollection({
  type: "content",
  schema: z
    .object({
      title: z.string(),
      description: z.string().max(160),

      // Accept either `date` or `publishDate` (string or Date), both optional.
      date: z.union([z.string(), z.date()]).optional(),
      publishDate: z.union([z.string(), z.date()]).optional(),

      updated: z.union([z.string(), z.date()]).optional(),
      author: z.string().default("Vanished Brands"),

      // Allow either an object { src, alt } or a simple string path
      image: z
        .union([
          z.object({ src: z.string(), alt: z.string().default("") }),
          z.string(),
        ])
        .optional(),

      tags: z.array(z.string()).default([]),
      topics: z.array(z.string()).default([]),
      brands: z.array(z.string()).default([]),
      draft: z.boolean().default(false),
      featured: z.boolean().default(false).optional(),
      category: z.string().optional(),
      keywords: z.array(z.string()).default([]).optional(),
      relatedBrands: z.array(z.string()).default([]).optional(),
    })
    .superRefine((val, ctx) => {
      if (!val.date && !val.publishDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["publishDate"],
          message: "Provide either `date` or `publishDate`.",
        });
      }
    }),
});

const topics = defineCollection({
  type: "data",
  schema: z.record(
    z.object({
      label: z.string(),
      desc: z.string(),
      descLong: z.string().optional(),
      heroImage: z.string().optional(),
      faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
    })
  ),
});

export const collections = { post, topics };
