// astro.config.mjs
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs';
import path from 'node:path';
import mdx from '@astrojs/mdx';
import { fileURLToPath } from 'url';

const SITE = 'https://vanishedbrands.com';

/* ... your toPath/buildBrandLastmods/metaFor helpers unchanged ... */

export default defineConfig({
  site: SITE,
  trailingSlash: 'always',
  prefetch: true,

  vite: {
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
        '@layouts': fileURLToPath(new URL('./src/layouts', import.meta.url)),
      },
    },
  },

  integrations: [
    mdx(),
    tailwind({ config: { applyBaseStyles: true } }),
    sitemap({
      entryLimit: 5000,
      filter: (page) => {
        const p = toPath(page);
        if (p === '/buy/') return false;
        if (p.startsWith('/download/')) return false;
        if (p.startsWith('/.netlify/functions/')) return false;
        if (p.startsWith('/content/')) return false;
        return true;
      },
      serialize: (page) => {
        const p = toPath(page);
        const base = {
          ...(typeof page === 'string' ? {} : page),
          url: p,
          ...metaFor(p),
        };
        const lastmod = brandLastmods[p];
        return lastmod ? { ...base, lastmod } : base;
      },
    }),
  ],
});
