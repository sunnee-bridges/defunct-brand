// src/content/config.ts
import { defineCollection, z } from "astro:content";

export const post = defineCollection({
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
    topics: z.array(z.string()).default([]),     // ← tie to your /topics/*
    brands: z.array(z.string()).default([]),     // ← brand slugs referenced
    draft: z.boolean().default(false),
  }),
});

export const collections = { post };
