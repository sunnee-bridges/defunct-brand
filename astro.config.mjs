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

/** Build map: "/brand/<slug>/" -> ISO lastmod from .public.json mtime */
function buildBrandLastmods() {
  const dir = path.resolve('src/content/brands');
  const map = {};
  if (!fs.existsSync(dir)) return map;

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.public.json')) continue;
    const slug = f.replace(/\.public\.json$/i, '');
    const stat = fs.statSync(path.join(dir, f));
    map[`/brand/${slug}/`] = stat.mtime.toISOString();
  }
  return map;
}
const brandLastmods = buildBrandLastmods();

/** changefreq/priority per section (by pathname) */
function metaFor(p) {
  if (p === '/')                 return { changefreq: 'daily',   priority: 1.0 };
  if (p === '/az/')              return { changefreq: 'weekly',  priority: 0.8 };
  if (p.startsWith('/decade/'))  return { changefreq: 'weekly',  priority: 0.7 };
  if (p.startsWith('/category/'))return { changefreq: 'monthly', priority: 0.6 };
  if (p.startsWith('/brand/'))   return { changefreq: 'monthly', priority: 0.9 };
  return { changefreq: 'monthly', priority: 0.5 };
}

export default defineConfig({
  site: SITE,
  trailingSlash: 'always',
  prefetch: true,

  integrations: [
    tailwind({ config: { applyBaseStyles: true } }),
    sitemap({
      filter: (page) => {
        const p = toPath(page);
        // Exclude utility routes
        if (p === '/buy/') return false;
        if (p.startsWith('/download/')) return false;
        if (p.startsWith('/.netlify/functions/')) return false;
        return true;
      },
      serialize: (page) => {
        const p = toPath(page);
        const base = {
          ...(typeof page === 'string' ? {} : page),
          url: p,                 // give sitemap a pathname; plugin will prepend site
          ...metaFor(p),
        };
        const lastmod = brandLastmods[p];
        return lastmod ? { ...base, lastmod } : base;
      },
    }),
  ],
});
