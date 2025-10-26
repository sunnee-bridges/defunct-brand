// astro.config.mjs
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://vanishedbrands.com';

/** Normalize plugin input (string or object) to a pathname like "/brand/foo/". */
function toPath(input) {
  const url = typeof input === 'string' ? input : input?.url || '';
  try {
    // If absolute, extract pathname; if already a path, URL will treat it relative to SITE
    return new URL(url, SITE).pathname;
  } catch {
    return url; // fallback
  }
}

/** Build map: "/brand/<slug>/" -> ISO lastmod from .json mtime */
function buildBrandLastmods() {
  const dir = path.resolve('src/content/brands'); // curated JSON used to build brand pages
  const map = {};
  if (!fs.existsSync(dir)) return map;

  // Stable order (not required, just nice for debugging)
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((ent) => ent.isFile())
    .map((ent) => ent.name)
    .sort();

  for (const f of files) {
    // Only accept plain JSON files (ignore hidden files, legacy *.public.json if any, etc.)
    if (!/^[^.].*\.json$/i.test(f)) continue;

    const slug = f.replace(/\.json$/i, '');
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

  integrations: [
    tailwind({ config: { applyBaseStyles: true } }),
    sitemap({
       entryLimit: 1,

    filter: (page) => {
      const p = toPath(page);
      // Exclude non-canonical / utility routes
      if (p === '/buy/') return false;
      if (p.startsWith('/download/')) return false;
      if (p.startsWith('/.netlify/functions/')) return false;
      if (p.startsWith('/content/')) return false; // any raw data paths, just in case
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
