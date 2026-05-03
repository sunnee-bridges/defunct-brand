// netlify/functions/csv-download.js
// Verifies a signed token, watermarks the full CSV with the requester's email, serves it.
const crypto = require("crypto");
const path   = require("path");
const fs     = require("fs");

const SECRET = process.env.DATA_DOWNLOAD_SECRET || "change-me";
const CSV_PATH = path.join(__dirname, "_data", "brands-full.csv");

function verifyToken(t) {
  try {
    const [p64, s64] = String(t || "").split(".");
    if (!p64 || !s64) return null;
    const payload = JSON.parse(Buffer.from(p64, "base64url").toString("utf8"));
    const h = crypto.createHmac("sha256", SECRET).update(p64).digest("base64url");
    if (h !== s64) return null;
    if (typeof payload.x !== "number" || Date.now() / 1000 > payload.x) return null;
    return payload;
  } catch { return null; }
}

function watermark(csv, email) {
  const stamp = new Date().toISOString();
  const fp = crypto.createHash("sha1").update(`${email}.${stamp}`).digest("hex").slice(0, 10);
  const note = `__WATERMARK__,,,,,,,"Downloaded by ${email.replace(/"/g, '""')} at ${stamp} · fp:${fp}"`;
  return csv.trimEnd() + "\n" + note + "\n";
}

exports.handler = async (event) => {
  const token = (event.queryStringParameters || {}).token || "";
  const payload = verifyToken(token);

  if (!payload) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: `<p>This download link is invalid or has expired.</p>
             <p><a href="/data/">Return to the dataset page to request a new link.</a></p>`
    };
  }

  if (!fs.existsSync(CSV_PATH)) {
    console.error("[csv-download] CSV not found at", CSV_PATH);
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain" },
      body: "Dataset file unavailable. Please contact support@vanishedbrands.com."
    };
  }

  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const stamped = watermark(raw, payload.e);

  console.log(`[csv-download] served to ${payload.e}`);

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="vanished-brands.csv"',
      "Cache-Control": "no-store, no-cache",
      "X-Robots-Tag": "noindex, nofollow"
    },
    body: stamped
  };
};
