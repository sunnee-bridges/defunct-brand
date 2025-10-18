// scripts/upload-public-csv.mjs
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "public", "data");
const BUCKET = process.env.S3_BUCKET;          // e.g. "vanishedbrands-private"
const PREFIX = process.env.S3_PREFIX || "exports"; // folder in bucket, e.g. "exports"

if (!BUCKET) {
  console.error("✖ Missing S3_BUCKET env var");
  process.exit(1);
}
if (!fs.existsSync(DIR)) {
  console.error(`✖ ${DIR} does not exist. Run build-public-csv first.`);
  process.exit(1);
}

// upload helper
function put(file) {
  const dest = `s3://${BUCKET}/${PREFIX}/${path.basename(file)}`;
  const cmd = [
    "aws s3 cp",
    `"${path.join(DIR, file)}"`,
    `"${dest}"`,
    "--content-type text/csv",
    "--cache-control max-age=300,public"
  ].join(" ");
  console.log("→", cmd);
  execSync(cmd, { stdio: "inherit" });
}

// mandatory files
["brands-latest.csv", "brands-sample.csv"].forEach(put);

// also upload the versioned file if present
const versioned = fs.readdirSync(DIR).find(f => /^brands-\d{8}\.csv$/.test(f));
if (versioned) put(versioned);

// (optional) upload manifest for your functions to read
const manifest = "manifest.json";
if (fs.existsSync(path.join(DIR, manifest))) {
  const cmd = [
    "aws s3 cp",
    `"${path.join(DIR, manifest)}"`,
    `"s3://${BUCKET}/${PREFIX}/${manifest}"`,
    "--content-type application/json",
    "--cache-control no-cache"
  ].join(" ");
  console.log("→", cmd);
  execSync(cmd, { stdio: "inherit" });
}

console.log("✔ Upload complete.");
