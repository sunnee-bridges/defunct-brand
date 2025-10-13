export const prerender = true;
export async function GET() {
  const mods = import.meta.glob('/content/brands/*.json');
  const slugs = Object.keys(mods).map((p) => (p.split('/').pop() || '').replace(/\.json$/i, ''));
  return new Response(JSON.stringify(slugs), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  });
}
