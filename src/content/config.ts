// src/content/config.ts
import { defineCollection, z } from "astro:content";

// MD/MDX articles
const articles = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().max(160),
    publishDate: z.string().or(z.date()),        // ← matches your MDX
    updated: z.string().or(z.date()).optional(),
    author: z.string().default("Vanished Brands"),
    image: z.object({ src: z.string(), alt: z.string().default("") }).optional(),
    tags: z.array(z.string()).default([]),
    topics: z.array(z.string()).default([]),
    brands: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

// Centralized topic metadata (data collection)
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

export const collections = { articles, topics };
