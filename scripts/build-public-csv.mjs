// scripts/build-public-csv.mjs
import { promises as fs } from "node:fs";
import { join } from "node:path";

const INPUT_DIR = process.env.CSV_SOURCE || "content/brands";
const OUT_DIR = "public/data";
const OUT_FILE = "brands-sample.csv";
const SAMPLE_ROWS = parseInt(process.env.SAMPLE_ROWS || process.env.PUBLIC_SAMPLE_ROWS || "7", 10);

const HEADERS = [
  "brand","slug","category","country",
  "active_start","active_end","fate","summary","wikipedia"
];

const q = (v = "") => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toRowArray = (b) => ([
  b.brand ?? "",
  b.slug ?? "",
  b.category ?? "",
  b.country ?? "",
  b?.active?.start ?? "",
  b?.active?.end ?? "",
  b.fate ?? "",
  b.summary ?? "",
  b?.links?.wikipedia ?? ""
]);
const toRow = (arr) => arr.map(q).join(",");

(async () => {
  let files;
  try {
    files = (await fs.readdir(INPUT_DIR)).filter(f => f.endsWith(".json"));
  } catch {
    console.error(`Input folder not found: ${INPUT_DIR}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`No JSON files found in ${INPUT_DIR}`);
    process.exit(1);
  }

  const objs = [];
  for (const f of files) {
    const raw = await fs.readFile(join(INPUT_DIR, f), "utf8");
    const obj = JSON.parse(raw);
    if (!obj?.brand) continue;
    objs.push(obj);
  }

  objs.sort((a, b) => String(a.brand || "").localeCompare(String(b.brand || "")));

  const rows = objs.map(toRowArray);
  const headerLine = HEADERS.join(",");
  const bodyLines = rows.map(toRow);

  const n = Math.max(0, Math.min(SAMPLE_ROWS, rows.length));
  await fs.mkdir(OUT_DIR, { recursive: true });
  const sampleCsv = [headerLine, ...bodyLines.slice(0, n)].join("\n");
  await fs.writeFile(join(OUT_DIR, OUT_FILE), sampleCsv + "\n", "utf8");
  console.log(`Wrote ${join(OUT_DIR, OUT_FILE)} with ${n} rows (SAMPLE_ROWS=${SAMPLE_ROWS})`);
})();
