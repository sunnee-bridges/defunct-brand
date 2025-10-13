// scripts/build-csv.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CONTENT = path.join(ROOT, "content", "brands");
const OUT = path.join(ROOT, "public", "data");

// version stamp (YYYYMMDD)
const VERSION = new Date().toISOString().slice(0,10).replace(/-/g, "");
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// ensure source exists
if (!fs.existsSync(CONTENT)) {
  console.error(`✖ Source folder not found: ${CONTENT}
Make sure you've run: npm run data (to generate content/brands/*.json)`);
  process.exit(1);
}

// load brand JSON files
const files = fs.readdirSync(CONTENT).filter(f => f.endsWith(".json"));
if (files.length === 0) {
  console.error(`✖ No brand JSON files in ${CONTENT}. Run: npm run data`);
  process.exit(1);
}
const rows = files.map(f => JSON.parse(fs.readFileSync(path.join(CONTENT, f), "utf8")));

// CSV helpers
const toCell = (v) => (v == null ? "" : String(v).replace(/"/g, '""')); // escape quotes
const asRow = (arr) => arr.map(toCell).map(x => `"${x}"`).join(",");

const header = [
  "brand","slug","category","country","active_start","active_end",
  "fate","summary","notable_products","wikipedia_url","last_updated","dataset_version"
];

// build rows
const today = new Date().toISOString().slice(0,10);
const fullRows = rows.map(b => ([
  b.brand, b.slug, b.category, b.country ?? "",
  b.active?.start ?? "", b.active?.end ?? "",
  b.fate ?? "", b.summary ?? "",
  (b.notable_products || []).join("; "),
  b.links?.wikipedia ?? "",
  today, VERSION
]));
const fullCsv = [header.join(","), ...fullRows.map(asRow)].join("\n") + "\n";

// write versioned + latest
const versioned = path.join(OUT, `brands-${VERSION}.csv`);
const latest = path.join(OUT, "brands-latest.csv");
fs.writeFileSync(versioned, fullCsv, "utf8");
fs.writeFileSync(latest, fullCsv, "utf8");

// write 100-row sample (or fewer if <100 total)
const SAMPLE_SIZE = Math.min(100, fullRows.length);
const sampleRows = fullRows.slice().sort(() => Math.random() - 0.5).slice(0, SAMPLE_SIZE);
const sampleCsv = [header.join(","), ...sampleRows.map(asRow)].join("\n") + "\n";
fs.writeFileSync(path.join(OUT, "brands-sample.csv"), sampleCsv, "utf8");

console.log(`✔ Wrote:
 - ${path.relative(ROOT, versioned)}
 - ${path.relative(ROOT, latest)}
 - ${path.relative(ROOT, path.join(OUT, "brands-sample.csv"))}`);
