// scripts/build-csv.mjs
import { promises as fs } from "node:fs";
import { join } from "node:path";

const INPUT_DIR = process.env.CSV_SOURCE || "content/brands_src"; // private by default
const OUT_DIR = "exports";
const OUT_FILE = process.env.CSV_OUT || "full-dataset.csv";

const HEADERS = [
  "brand","slug","category","country",
  "active_start","active_end","fate","summary","wikipedia"
];

const q = (v = "") => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const toRow = (b) => [
  b.brand ?? "",
  b.slug ?? "",
  b.category ?? "",
  b.country ?? "",
  b?.active?.start ?? "",
  b?.active?.end ?? "",
  b.fate ?? "",
  b.summary ?? "",
  b?.links?.wikipedia ?? ""
].map(q).join(",");

(async () => {
  // read *.json from INPUT_DIR (works for either brands_src or brands)
  let files;
  try {
    files = (await fs.readdir(INPUT_DIR)).filter(f => f.endsWith(".json"));
  } catch (e) {
    console.error(`Input folder not found: ${INPUT_DIR}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`No JSON files found in ${INPUT_DIR}`);
    process.exit(1);
  }

  const rows = [];
  for (const f of files) {
    const raw = await fs.readFile(join(INPUT_DIR, f), "utf8");
    const obj = JSON.parse(raw);
    rows.push(toRow(obj));
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const csv = [HEADERS.join(","), ...rows].join("\n");
  await fs.writeFile(join(OUT_DIR, OUT_FILE), csv, "utf8");
  console.log(`Wrote ${join(OUT_DIR, OUT_FILE)} with ${rows.length} rows from ${INPUT_DIR}`);
})();
