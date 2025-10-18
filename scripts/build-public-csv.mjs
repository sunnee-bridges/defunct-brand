// scripts/build-public-csv.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, "content", "brands"); // your curated *.public.json live here
const OUT_DIR = path.join(ROOT, "public", "data");

const SAMPLE_ROWS = parseInt(process.env.SAMPLE_ROWS || "7", 10);
const VERSION = new Date().toISOString().slice(0,10).replace(/-/g, ""); // YYYYMMDD
const todayISO = new Date().toISOString().slice(0,10);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// load only JSON files (assume they are already curated public files)
const files = fs.readdirSync(CONTENT_DIR).filter(f => f.endsWith(".json"));
if (!files.length) {
  console.error(`No JSON files in ${CONTENT_DIR}`);
  process.exit(1);
}

const objects = files.map(f => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, f), "utf8")));

// de-dupe by slug (first-wins)
const seen = new Set();
const items = [];
for (const b of objects) {
  const key = String(b?.slug || "").trim().toLowerCase();
  if (!key) continue;
  if (seen.has(key)) continue;
  seen.add(key);
  items.push(b);
}
items.sort((a,b)=>String(a.brand||"").localeCompare(String(b.brand||"")));

const header = [
  "brand","slug","category","country","active_start","active_end",
  "fate","summary","notable_products","wikipedia_url","last_updated","dataset_version"
];
const esc = v => (v == null ? "" : String(v).replace(/"/g,'""'));
const csvRow = arr => arr.map(esc).map(s=>`"${s}"`).join(",");

const rows = items.map(b => ([
  b.brand, b.slug, b.category, b.country ?? "",
  b.active?.start ?? "", b.active?.end ?? "",
  b.fate ?? "", b.summary ?? "",
  (b.notable_products || []).join("; "),
  b.links?.wikipedia ?? "",
  todayISO, VERSION
]));

const full = [header.join(","), ...rows.map(csvRow)].join("\n") + "\n";

// write three files
const versionedPath = path.join(OUT_DIR, `brands-${VERSION}.csv`);
const latestPath    = path.join(OUT_DIR, "brands-latest.csv");
const samplePath    = path.join(OUT_DIR, "brands-sample.csv");

fs.writeFileSync(versionedPath, full, "utf8");
fs.writeFileSync(latestPath, full, "utf8");

// deterministic sample: first N after sort (change to shuffle if you prefer)
const n = Math.min(Math.max(SAMPLE_ROWS, 0), rows.length);
const sample = [header.join(","), ...rows.slice(0, n).map(csvRow)].join("\n") + "\n";
fs.writeFileSync(samplePath, sample, "utf8");

// optional manifest (handy for functions)
const manifest = {
  version: VERSION,
  latestKey: "brands-latest.csv",
  versionedKey: `brands-${VERSION}.csv`,
  sampleKey: "brands-sample.csv",
  generated: new Date().toISOString()
};
fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log(`✔ Wrote:
 - public/data/brands-${VERSION}.csv
 - public/data/brands-latest.csv
 - public/data/brands-sample.csv (${n} rows + header)
 - public/data/manifest.json`);
