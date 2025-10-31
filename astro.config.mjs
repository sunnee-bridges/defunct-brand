// astro.config.mjs
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs';
import path from 'node:path';
import mdx from '@astrojs/mdx';
import { fileURLToPath } from 'url';

const SITE = 'https://vanishedbrands.com';

/** Normalize plugin input (string or object) to a pathname like "/brand/foo/". */
function toPath(input) {
  const url = typeof input === 'string' ? input : input?.url || '';
  try {
    return new URL(url, SITE).pathname; // absolute → pathname; relative stays a path
  } catch {
    return url; // fallback
  }
}

/** Build map: "/brand/<slug>/" -> ISO lastmod from .json mtime */
function buildBrandLastmods() {
  const dir = path.resolve('src/content/brands');
  const map = {};
  if (!fs.existsSync(dir)) return map;

  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((ent) => ent.isFile())
    .map((ent) => ent.name)
    .sort();

  for (const f of files) {
    if (/\.public\.json$/i.test(f)) continue;     // ignore legacy names
    if (!/^[^.].*\.json$/i.test(f)) continue;     // only normal JSON

    const slug = f.replace(/\.public\.json$/i, '').replace(/\.json$/i, '');
    const stat = fs.statSync(path.join(dir, f));
    map[`/brand/${encodeURIComponent(slug)}/`] = stat.mtime.toISOString();
  }
  return map;
}
const brandLastmods = buildBrandLastmods();

/** changefreq/priority per section (by pathname) */
function metaFor(p) {
  if (p === '/')                  return { changefreq: 'daily',   priority: 1.0 };
  if (p === '/az/')               return { changefreq: 'weekly',  priority: 0.8 };
  if (p.startsWith('/decade/'))   return { changefreq: 'weekly',  priority: 0.7 };
  if (p.startsWith('/category/')) return { changefreq: 'monthly', priority: 0.6 };
  if (p.startsWith('/brand/'))    return { changefreq: 'monthly', priority: 0.9 };
  return { changefreq: 'monthly', priority: 0.5 };
}

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
          url: p, // plugin will prepend `site`
          ...metaFor(p),
        };
        const lastmod = brandLastmods[p];
        return lastmod ? { ...base, lastmod } : base;
      },
    }),
  ],
});
