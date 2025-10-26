// prerender so the file is built once at build-time
export const prerender = true;

export async function GET() {
  const mods = import.meta.glob("/src/content/brands/*.json", { eager: true });
  const slugs = Object.values(mods)
    .map((m: any) => (m as any).default?.slug ?? (m as any).slug)
    .filter(Boolean)
    .sort();

  // newline-delimited text is smaller and faster to parse than JSON
  return new Response(slugs.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // long-lived, immutable cache
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
}
