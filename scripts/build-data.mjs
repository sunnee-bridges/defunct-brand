// scripts/build-data.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "content", "brands");

const csvPath = process.env.CSV || path.join(ROOT, "defunct_brands_seed.csv");
const csv = fs.readFileSync(csvPath, "utf8");

// super-light CSV parser (since our file is simple)
function parseCSV(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((h) => h.trim());
  return lines.map((line) => {
    // handle quoted commas
    const cells = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'; i++; continue;
      }
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === "," && !inQ) { cells.push(cur); cur = ""; continue; }
      cur += ch;
    }
    cells.push(cur);
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = (cells[idx] ?? "").trim()));
    return obj;
  });
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const rows = parseCSV(csv);

for (const r of rows) {
  const json = {
    brand: r.brand,
    slug: r.slug,
    category: r.category,
    country: r.country,
    active: {
      start: Number(r.active_start) || null,
      end: Number(r.active_end) || null,
    },
    fate: r.fate,
    summary: r.summary,
    notable_products: (r.notable_products || "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean),
    links: {
      wikipedia: r.sources || null,
    },
  };
  const out = path.join(OUT_DIR, `${r.slug}.json`);
  fs.writeFileSync(out, JSON.stringify(json, null, 2));
  console.log("wrote", out);
}

console.log("Done. Brand JSON files in content/brands/");

