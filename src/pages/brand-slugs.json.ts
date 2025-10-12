// src/pages/brand-slugs.json.ts
export async function GET() {
  // Load all brand JSON at build-time
  const mods = import.meta.glob('/content/brands/*.json', { eager: true });
  const slugs = Object.keys(mods)
    .map((p) => (p.split('/').pop() || '').replace(/\.json$/i, ''))
    .filter(Boolean);

  return new Response(JSON.stringify(slugs), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600' // 1h; tune as you like
    }
  });
}
