// Generate a static JSON file of all brand slugs at build time
export const prerender = true;

export async function GET() {
  // Load all brand JSON modules at build time
  const mods = import.meta.glob('/content/brands/*.json', { eager: true });
  const slugs = Object.keys(mods).map((p) => (p.split('/').pop() || '').replace(/\.json$/i, ''));

  return new Response(JSON.stringify(slugs), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
