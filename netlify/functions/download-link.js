// netlify/functions/download-link.js
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

/* ---------- Config ---------- */
const REGION        = process.env.S3_REGION || "us-east-1";
const BUCKET        = process.env.S3_BUCKET_NAME;
const MANIFEST_KEY  = process.env.S3_MANIFEST_KEY || "exports/manifest.json";
const CSV_FALLBACK  = process.env.CSV_OBJECT_KEY || "exports/brands-latest.csv";
const DOWNLOAD_TTL  = Number(process.env.DOWNLOAD_TTL_SECONDS || 900); // 15m
const MAX_USES      = Number(process.env.MAX_REDEMPTIONS || process.env.MAX_TOKEN_USES || 3);

/* ---------- Tiny per-process rate limit ---------- */
const RATE_LIMIT    = Number(process.env.RATE_LIMIT_PER_MIN || 40);
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

async function writeJSON({ Bucket, Key, data }) {
  await s3.send(new PutObjectCommand({
    Bucket,
    Key,
    Body: JSON.stringify(data),
    ContentType: "application/json; charset=utf-8",
  }));
}

/* ---------- Helpers ---------- */
function corsHeaders(methods = "GET, POST, OPTIONS") {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

function json(status, body, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", ...corsHeaders(), ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function redirect302(location) {
  return {
    statusCode: 302,
    headers: { ...corsHeaders("GET, OPTIONS"), Location: location },
    body: "",
  };
}

function isValidToken(t) {
  return typeof t === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}

/* ---------- Core redeem (shared by GET/POST) ---------- */
async function redeemOnce(token) {
  if (!BUCKET) return { type: "error", status: 500, body: { error: "Server not configured." } };
  if (!isValidToken(token)) return { type: "error", status: 400, body: { error: "Invalid token format" } };

  const tokenKey = `tokens/${token}.json`;
  let record;

  try {
    record = await readJSON({ Bucket: BUCKET, Key: tokenKey });
  } catch (err) {
    console.error("[download-link] Token not found:", token, err.message);
    return { type: "error", status: 404, body: { error: "Token not found or invalid" } };
  }

  const now = Date.now();
  const expiresAt = Number(record.expiresAt || 0);
  if (!Number.isFinite(expiresAt) || now > (expiresAt + 5000)) {
    const expiredDate = new Date(expiresAt).toISOString();
    return { type: "error", status: 410, body: { error: "Token expired", expiredAt: expiredDate } };
  }

  const currentUseCount = record.useCount || 0;
  if (currentUseCount >= MAX_USES) {
    return {
      type: "error",
      status: 429,
      body: {
        error: "Download limit reached",
        uses: currentUseCount,
        maxUses: MAX_USES,
        message: `You've reached the maximum number of downloads (${MAX_USES}) for this purchase.`,
      },
      headers: { "Retry-After": "86400" },
    };
  }

  // Mark used (atomic enough for our use case)
  record.useCount = currentUseCount + 1;
  record.lastUsedAt = now;
  if (!record.usedAt) record.usedAt = now;

  try {
    await writeJSON({ Bucket: BUCKET, Key: tokenKey, data: record });
  } catch (e) {
    console.warn("[download-link] Failed to persist token usage; continuing", e.message);
  }

  let Key = record.key || CSV_FALLBACK;
  if (!Key) {
    try {
      const manifest = await readJSON({ Bucket: BUCKET, Key: MANIFEST_KEY });
      if (manifest && typeof manifest.latest === "string") Key = manifest.latest;
    } catch {}
  }
  if (!Key) {
    return { type: "error", status: 500, body: { error: "File not configured" } };
  }

  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key,
    ResponseContentDisposition: 'attachment; filename="vanished-brands.csv"',
    ResponseContentType: "text/csv; charset=utf-8",
  });
  const url = await getSignedUrl(s3, cmd, { expiresIn: DOWNLOAD_TTL });

  const last = record.useCount >= MAX_USES;
  console.info(`[download-link] Success key=${Key} uses=${record.useCount}/${MAX_USES} last=${last}`);
  return { type: "ok", url, meta: { uses: record.useCount, maxUses: MAX_USES, expiresAt, last } };
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  try {
    if (tooMany(event)) return json(429, { error: "Too many requests. Try again shortly." });

    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }

    // GET /download/:token → 302 to signed S3 URL
    if (event.httpMethod === "GET") {
      const token = (event.queryStringParameters && event.queryStringParameters.token) || "";
      const out = await redeemOnce(token);
      if (out.type === "ok") return redirect302(out.url);
      return json(out.status || 500, out.body || { error: "Unknown error" }, out.headers);
    }

    // POST → JSON (body.token)
    if (event.httpMethod === "POST") {
      let payload = {};
      try { payload = JSON.parse(event.body || "{}"); } catch {}
      const token = payload.token || "";
      const out = await redeemOnce(token);
      if (out.type === "ok") {
        return json(200, {
          url: out.url,
          uses: out.meta.uses,
          maxUses: out.meta.maxUses,
          expiresAt: new Date(out.meta.expiresAt).toISOString(),
          last: out.meta.last,
        });
      }
      return json(out.status || 500, out.body || { error: "Unknown error" }, out.headers);
    }

    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("[download-link] Error:", e?.message || e);
    return json(500, { error: "Internal server error" });
  }
};
