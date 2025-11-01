// src/content/config.ts
import { defineCollection, z } from "astro:content";

const post = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().max(160),
    // accept publishDate instead of date
    publishDate: z.string().or(z.date()),
    updatedDate: z.string().or(z.date()).optional(),

    author: z.string().default("Vanished Brands"),

    // accept image as string OR object
    image: z.union([
      z.string(),
      z.object({ src: z.string(), alt: z.string().default("") })
    ]).optional(),

    // support your extra fields
    category: z.string().optional(),
    featured: z.boolean().default(false),

    // keep both 'tags' and 'keywords' (optional)
    tags: z.array(z.string()).default([]),
    keywords: z.array(z.string()).default([]),

    // keep both 'brands' and 'relatedBrands' (optional)
    brands: z.array(z.string()).default([]),
    relatedBrands: z.array(z.string()).default([]),

    draft: z.boolean().default(false),
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
