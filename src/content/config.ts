// src/content/config.ts
import { defineCollection, z } from "astro:content";

/** Blog/articles (MD/MDX) */
const post = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    description: z.string().max(160),
    date: z.string().or(z.date()),
    updated: z.string().or(z.date()).optional(),
    author: z.string().default("Vanished Brands"),
    image: z
      .object({ src: z.string(), alt: z.string().default("") })
      .optional(),
    tags: z.array(z.string()).default([]),
    topics: z.array(z.string()).default([]),  // tie posts to /topics/*
    brands: z.array(z.string()).default([]),  // referenced brand slugs
    draft: z.boolean().default(false),
  }),
});

/** Topics hub metadata (single JSON file that is a map: { slug: {...} }) */
const topics = defineCollection({
  type: "data",
  schema: z.record(
    z.object({
      label: z.string(),
      desc: z.string(),
      descLong: z.string().optional(),
      heroImage: z.string().optional(),
      faq: z
        .array(z.object({ q: z.string(), a: z.string() }))
        .optional(),
    })
  ),
});

export const collections = { post, topics };
