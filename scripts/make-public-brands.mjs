import { promises as fs } from "node:fs";
import path from "node:path";

const SRC_DIR = path.join(process.cwd(), "content", "brands_src");
const DST_DIR = path.join(process.cwd(), "content", "brands");

const ALLOW = new Set([
  "brand", "slug", "category", "country", "active", "fate",
  "summary", "notable_products", "links"
]);

await fs.mkdir(DST_DIR, { recursive: true });
const files = (await fs.readdir(SRC_DIR)).filter(f => f.endsWith(".json"));

for (const file of files) {
  const raw = await fs.readFile(path.join(SRC_DIR, file), "utf8");
  const src = JSON.parse(raw);
  const pub = {};
  for (const k of ALLOW) if (src[k] !== undefined) pub[k] = src[k];

  // normalize a couple of fields safely
  if (pub.notable_products && !Array.isArray(pub.notable_products)) pub.notable_products = [];
  if (pub.links) pub.links = { wikipedia: src?.links?.wikipedia ?? null };

  const slug = src.slug || path.basename(file, ".json");
  const out = path.join(DST_DIR, `${slug}.public.json`);
  await fs.writeFile(out, JSON.stringify(pub, null, 2), "utf8");
  console.log("→", out);
}
console.log("Done. Review files before committing.");
