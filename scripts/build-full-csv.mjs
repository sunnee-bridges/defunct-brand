// scripts/build-full-csv.mjs
// Generates the full brand CSV for the email-gated download.
// Output: netlify/functions/_data/brands-full.csv
import { promises as fs } from "node:fs";
import { join } from "node:path";

const INPUT_DIR = "src/content/brands";
const OUT_DIR   = "netlify/functions/_data";
const OUT_FILE  = "brands-full.csv";

const HEADERS = [
  "brand", "slug", "category", "country",
  "active_start", "active_end", "fate", "summary", "wikipedia_url"
];

const q = (v = "") => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const toRow = (b) => [
  b.brand       ?? "",
  b.slug        ?? "",
  b.category    ?? "",
  b.country     ?? "",
  b?.active?.start ?? "",
  b?.active?.end   ?? "",
  b.fate        ?? "",
  b.summary     ?? "",
  b?.links?.wikipedia ?? ""
].map(q).join(",");

(async () => {
  let files;
  try {
    files = (await fs.readdir(INPUT_DIR))
      .filter(f => f.endsWith(".json") && !f.endsWith(".public.json"));
  } catch {
    console.error(`Input folder not found: ${INPUT_DIR}`);
    process.exit(1);
  }

  const brands = [];
  for (const f of files) {
    try {
      const raw = await fs.readFile(join(INPUT_DIR, f), "utf8");
      const obj = JSON.parse(raw);
      if (obj?.brand) brands.push(obj);
    } catch (e) {
      console.warn(`Skipping ${f}:`, e.message);
    }
  }

  brands.sort((a, b) => String(a.brand).localeCompare(String(b.brand)));

  await fs.mkdir(OUT_DIR, { recursive: true });
  const csv = [HEADERS.join(","), ...brands.map(toRow)].join("\n") + "\n";
  await fs.writeFile(join(OUT_DIR, OUT_FILE), csv, "utf8");
  console.log(`[build-full-csv] Wrote ${OUT_DIR}/${OUT_FILE} (${brands.length} brands)`);
})();
