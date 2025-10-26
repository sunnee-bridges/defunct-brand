// make-public-brands.mjs
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ---------- Resolve paths relative to this script (cwd-proof) ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Defaults (you can override via CSV_SOURCE / PUBLIC_BRANDS_DIR)
const DEFAULT_SRC = path.resolve(__dirname, "..", "src", "content", "brands_src");   // private inputs (updated)
const DEFAULT_DST = path.resolve(__dirname, "..", "src", "content", "brands");      // public outputs

const SRC_DIR = path.resolve(process.env.CSV_SOURCE || DEFAULT_SRC);
const DST_DIR = path.resolve(process.env.PUBLIC_BRANDS_DIR || DEFAULT_DST);

/* ---------- Whitelist of fields to expose publicly ---------- */
const ALLOW = new Set([
  "brand", "slug", "category", "country", "active", "fate",
  "summary", "notable_products", "links"
]);

/* ---------- Helpers ---------- */
async function safeReadJSON(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${filePath}: ${e.message}`);
  }
}

function toPublic(src) {
  const pub = {};
  for (const k of ALLOW) if (src[k] !== undefined) pub[k] = src[k];

  // Normalize shapes
  if (pub.notable_products && !Array.isArray(pub.notable_products)) {
    pub.notable_products = [];
  }
  if (pub.links) {
    pub.links = { wikipedia: src?.links?.wikipedia ?? null };
  }

  return pub;
}

/* ---------- Main ---------- */
async function main() {
  try { await fs.access(SRC_DIR); }
  catch {
    console.warn(`[make-public-brands] Source directory not found: ${SRC_DIR} — skipping generation.`);
    return;  
  }

  await fs.mkdir(DST_DIR, { recursive: true });

  const all = await fs.readdir(SRC_DIR);
  // Only raw source JSON; skip any accidental *.public.json
  const files = all.filter(f => f.toLowerCase().endsWith(".json") && !f.endsWith(".public.json"));

  if (files.length === 0) {
    console.warn(`[make-public-brands] No JSON files found in ${SRC_DIR}`);
    return;
  }

  let ok = 0, fail = 0;
  for (const file of files) {
    const srcPath = path.join(SRC_DIR, file);
    try {
      const src = await safeReadJSON(srcPath);
      const pub = toPublic(src);

      const slug = (src.slug || path.basename(file, ".json")).toString().trim();
      if (!slug) throw new Error("Missing slug");

      const outPath = path.join(DST_DIR, `${slug}.public.json`);
      await fs.writeFile(outPath, JSON.stringify(pub, null, 2), "utf8");
      console.log("→", outPath);
      ok++;
    } catch (e) {
      console.error("×", srcPath, "-", e.message);
      fail++;
    }
  }

  console.log(`[make-public-brands] Done. Wrote ${ok} file(s). ${fail ? `Failed: ${fail}` : ""}`);
}

main().catch(err => {
  console.error("[make-public-brands] Fatal:", err.message);
  process.exitCode = 1;
});
