// netlify/functions/download-link.js
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

/* ---------- Config ---------- */
const REGION        = process.env.S3_REGION || "us-east-1";
const BUCKET        = process.env.S3_BUCKET_NAME;                  // required
const MANIFEST_KEY  = process.env.S3_MANIFEST_KEY || "exports/manifest.json";
const CSV_FALLBACK  = process.env.CSV_OBJECT_KEY || "exports/brands-latest.csv";           
const DOWNLOAD_TTL  = Number(process.env.DOWNLOAD_TTL_SECONDS || 900); // 15m
const KEEP_TOKENS   = process.env.KEEP_TOKENS === "1";

/* ---------- Tiny per-process rate limit ---------- */
const RATE_LIMIT    = Number(process.env.RATE_LIMIT_PER_MIN || 20);
const WINDOW_MS     = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const buckets       = new Map(); // ip -> { count, ts }
function tooMany(event) {
  const h = event.headers || {};
  const ip =
    h["x-nf-client-connection-ip"] ||
    (h["x-forwarded-for"] ? h["x-forwarded-for"].split(",")[0].trim() : null) ||
    h["client-ip"] || "unknown";
  const now = Date.now();
  const b = buckets.get(ip) || { count: 0, ts: now };
  if (now - b.ts > WINDOW_MS) { b.count = 0; b.ts = now; }
  b.count += 1;
  buckets.set(ip, b);
  return b.count > RATE_LIMIT;
}

/* ---------- S3 ---------- */
const s3 = new S3Client({
  region: REGION,
  credentials: (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY)
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined,
});

function streamToString(stream) {
  return new Promise((res, rej) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", rej);
  });
}

async function readJSON({ Bucket, Key }) {
  const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
  return JSON.parse(await streamToString(r.Body));
}

/* ---------- Helpers ---------- */
function corsHeaders() {
  // Adjust origin if you need to restrict
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };
}
const json = (status, body) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify(body) });

function isValidToken(t) {
  // 43–128 safe chars; adjust if your token format differs
  return typeof t === "string" && /^[A-Za-z0-9._-]{16,128}$/.test(t);
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(204, {});
    if (!BUCKET) return json(500, { error: "Server not configured." });
    if (tooMany(event)) return json(429, { error: "Too many requests. Try again shortly." });
    if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

    let payload = {};
    try { payload = JSON.parse(event.body || "{}"); } catch {}
    const token = payload.token;
    if (!isValidToken(token)) return json(400, { error: "token invalid" });

    // 1) Load token record
    const tokenKey = `tokens/${token}.json`;
    let record;
    try {
      record = await readJSON({ Bucket: BUCKET, Key: tokenKey });
    } catch {
      return json(404, { error: "token not found or already used" });
    }

    // 2) Expiry check (with tiny grace for clock skew)
    const now = Date.now();
    const expiresAt = Number(record.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || now > (expiresAt + 5000)) { // +5s grace
      if (!KEEP_TOKENS) { try { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: tokenKey })); } catch {} }
      return json(410, { error: "token expired" });
    }

    // 3) Single-use delete
    if (!KEEP_TOKENS) {
      try { await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: tokenKey })); } catch {}
    }

    // 4) Resolve which CSV to serve
    let Key = record.key || CSV_FALLBACK;
    if (!Key) {
      try {
        const manifest = await readJSON({ Bucket: BUCKET, Key: MANIFEST_KEY });
        if (manifest && typeof manifest.latest === "string") Key = manifest.latest;
      } catch {}
    }
    if (!Key) return json(500, { error: "File not configured (no record.key, CSV_OBJECT_KEY, or manifest.latest)." });

    // 5) Sign URL
    const cmd = new GetObjectCommand({
      Bucket: BUCKET,
      Key,
      ResponseContentDisposition: 'attachment; filename="vanished-brands.csv"',
      ResponseContentType: "text/csv; charset=utf-8",
    });
    const url = await getSignedUrl(s3, cmd, { expiresIn: DOWNLOAD_TTL });

    // Minimal, privacy-safe log line
    console.info(`[download-link] ok key=${Key} ttl=${DOWNLOAD_TTL}s`);
    return json(200, { url });

  } catch (e) {
    console.error("[download-link] error", e && e.message ? e.message : e);
    return json(500, { error: "internal error" });
  }
};
