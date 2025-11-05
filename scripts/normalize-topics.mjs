#!/usr/bin/env node
/**
 * Normalize topics across /src/content/brands/*.json
 * - Fixes decades (e.g., "80s" -> "1980s"; also fixes "19800s" -> "1980s")
 * - Unifies separators, casing, and spacing
 * - Applies canonical alias mapping (e.g., "Software / Internet" -> "Software & Internet")
 * - Dedupes and sorts topics
 *
 * Run (dry run):   node scripts/normalize-topics.mjs
 * Run (write):     node scripts/normalize-topics.mjs --write
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import glob from "fast-glob";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, ".."); // repo root
const BRANDS_DIR = path.join(ROOT, "src", "content", "brands");

const WRITE = process.argv.includes("--write");

/* ---------- helpers ---------- */

function titleCaseWord(w) {
  // Keep common acronyms uppercase
  const ACR = /^(PC|P2P|IM|RTD|FWD|GM)$/i;
  if (ACR.test(w)) return w.toUpperCase();
  // e.g., "e-commerce" keep lower “e” for stylistic? We'll normalize later via aliases.
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function titleCase(str) {
  return str
    .split(" ")
    .map(titleCaseWord)
    .join(" ");
}

/** Fix decade tokens:
 *  - "80s" -> "1980s", "90s nostalgia" -> "1990s Nostalgia"
 *  - "19800s" typo -> "1980s"
 */
function normalizeDecades(s) {
  let out = s;

  // Fix obvious typo "19800s" -> "1980s", "19700s" -> "1970s" etc.
  out = out.replace(/\b(19[0-9])00s\b/g, (_m, p1) => `${p1}0s`);

  // "80s" -> "1980s", "90s something" -> "1990s something"
  out = out.replace(/\b([5-9]0?)s\b/gi, (m, d2) => {
    // If already like 1980s, skip
    if (/^\d{4}s$/i.test(m)) return m;
    const tens = d2.length === 1 ? `19${d2}0` : `19${d2}`; // "80" -> 1980; "90" -> 1990
    return `${tens}s`;
  });

  return out;
}

/** Core canonicalization:
 *  - convert "/" to " & "
 *  - unify hyphens/underscores to space
 *  - collapse multi-space
 *  - title-case
 *  - apply alias map
 */
function canonicalLabel(raw) {
  if (!raw) return "";

  let s = String(raw).trim();

  // Normalize slashes as conjunctions first
  s = s.replace(/\//g, " & ");

  // Unify hyphens/underscores into spaces (we're cleaning data, not slugs)
  s = s.replace(/[_-]+/g, " ");

  // Collapse spaces
  s = s.replace(/\s+/g, " ").trim();

  // Normalize decades and fix 19800s style typos
  s = normalizeDecades(s);

  // Lower key for alias lookups
  const key0 = s.toLowerCase();

  // Alias map (keys are lowercase, space-separated)
  const ALIASES = {
    "retail entertainment": "Retail & Entertainment",
    "software internet": "Software & Internet",
    "e commerce": "E-commerce",
    "dot com": "Dot-com",
    "mobile devices": "Mobile & Wearables",
    "wearables": "Mobile & Wearables",
    "airline": "Airlines & Aviation",
    "airlines": "Airlines & Aviation",
    "airline aviation": "Airlines & Aviation",
    "video games": "Video Games",
    "video game consoles": "Video Game Consoles",
    "brand retired": "Brand Retired",
    "brand sold": "Brand Sold",
    "pc clone era": "PC Clone Era",
    "one hour photo": "One-hour Photo",
    "cult favorite": "Cult Favorite",
    "vanished product": "Vanished Product",
    "physical media": "Physical Media",
    "forward look": "Forward Look",
    "fwd innovation": "FWD Innovation",
    "gm division": "GM Division",
    "open source": "Open Source",
    "online first": "Online First",
    "platform shift": "Platform Shift",
    "p2p": "P2P",
    "instant messaging": "Instant Messaging",
    "mobile security": "Mobile Security",
    "video arcade": "Video Arcade",
    "e commerce relaunch": "E-commerce Relaunch",
  };

  // Apply alias if we have an exact space-normalized match
  if (ALIASES[key0]) return ALIASES[key0];

  // Finally, title-case (keeps acronyms intact)
  s = titleCase(s);

  // Normalize " & " spacing
  s = s.replace(/\s*&\s*/g, " & ");

  // Normalize “E Commerce” → “E-commerce”, “Dot Com” → “Dot-com”
  s = s.replace(/\bE Commerce\b/g, "E-commerce");
  s = s.replace(/\bDot Com\b/g, "Dot-com");

  return s;
}

/* ---------- main ---------- */

async function run() {
  const files = await glob("**/*.json", { cwd: BRANDS_DIR, absolute: true });
  if (!files.length) {
    console.log("No brand JSON files found.");
    return;
  }

  let changed = 0;
  let touched = 0;

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.warn("⚠️  Skipping invalid JSON:", file);
      continue;
    }

    if (!Array.isArray(data.topics)) continue;

    const before = data.topics.slice();

    // Normalize → dedupe → sort
    const set = new Set();
    for (const t of data.topics) {
      const label = canonicalLabel(t);
      if (label) set.add(label);
    }
    const afterArr = Array.from(set).sort((a, b) => a.localeCompare(b));

    // Replace only if different
    const different =
      before.length !== afterArr.length ||
      before.some((v, i) => v !== afterArr[i]);

    if (different) {
      data.topics = afterArr;

      if (WRITE) {
        fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
      }
      changed++;
      console.log(
        `✔ ${path.relative(ROOT, file)}: ${before.join(", ")}  ->  ${afterArr.join(", ")}`
      );
    }
    touched++;
  }

  if (!WRITE) {
    console.log(
      `\n💡 DRY RUN complete. ${changed}/${touched} files would change. Re-run with --write to apply.`
    );
  } else {
    console.log(`\n✅ Updated ${changed}/${touched} files.`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
