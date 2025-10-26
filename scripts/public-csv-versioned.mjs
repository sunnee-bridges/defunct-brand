// scripts/publish-csv-versioned.mjs
import { spawnSync } from "node:child_process";

// ---- Config (override via env if you like) ----
const BASE_NAME   = process.env.CSV_BASENAME || "brands";
const DATE_STR    = process.env.CSV_DATE || new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
const FILE_NAME   = process.env.CSV_OUT || `${BASE_NAME}-${DATE_STR}.csv`;
const S3_BUCKET   = process.env.CSV_S3_BUCKET || "s3://vanishedbrands-private";
const S3_PREFIX   = process.env.CSV_S3_PREFIX || "exports";
const S3_KEY      = `${S3_PREFIX}/${FILE_NAME}`;

// 1) Build the CSV to exports/<FILE_NAME>
console.log(`→ Building CSV as exports/${FILE_NAME}`);
let r = spawnSync("npm", ["run", "data:csv"], {
  stdio: "inherit",
  env: { ...process.env, CSV_OUT: FILE_NAME } // tells build-csv.mjs where to write
});
if (r.status !== 0) process.exit(r.status);

// 2) Upload that exact file to S3 with a versioned key
console.log(`→ Uploading to ${S3_BUCKET}/${S3_KEY}`);
r = spawnSync("aws", ["s3", "cp", `exports/${FILE_NAME}`, `${S3_BUCKET}/${S3_KEY}`, 
  "--acl", "private",
  "--cache-control", "private, max-age=0, no-store"
], { stdio: "inherit" });

if (r.status !== 0) process.exit(r.status);

// (Optional) also maintain a stable "latest" key for convenience.
// Toggle with CSV_UPLOAD_LATEST=0 to skip.
if (process.env.CSV_UPLOAD_LATEST !== "0") {
  const latestName = `${BASE_NAME}-latest.csv`;
  const latestKey = `${S3_PREFIX}/${latestName}`;
  console.log(`→ Also updating ${S3_BUCKET}/${latestKey}`);
  r = spawnSync("aws", ["s3", "cp", `exports/${FILE_NAME}`, `${S3_BUCKET}/${latestKey}`,
    "--acl", "private",
    "--cache-control", "private, max-age=0, no-store"
  ], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status);
}

console.log("✓ Versioned publish complete.");
