// netlify/functions/download-link.js
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

/* ---------- Config ---------- */
const REGION        = process.env.S3_REGION || "us-east-1";
const BUCKET        = process.env.S3_BUCKET_NAME;                       // required
const MANIFEST_KEY  = process.env.S3_MANIFEST_KEY || "exports/manifest.json";
const CSV_FALLBACK  = process.env.CSV_OBJECT_KEY || "exports/brands-latest.csv";
const DOWNLOAD_TTL  = Number(process.env.DOWNLOAD_TTL_SECONDS || 900);  // 15m
const MAX_USES      = Number(process.env.MAX_REDEMPTIONS || process.env.MAX_TOKEN_USES || 3);

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

async function writeJSON({ Bucket, Key, data }) {
  await s3.send(new PutObjectCommand({
    Bucket,
    Key,
    Body: JSON.stringify(data),
    ContentType: "application/json; charset=utf-8",
  }));
}

/* ---------- Helpers ---------- */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };
}

function json(status, body, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { ...corsHeaders(), ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function isValidToken(t) {
  return typeof t === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}

// Extract token from multiple places for safety
function getTokenFromEvent(event) {
  // 1) Query param (from netlify.toml redirect)
  const qs = event.queryStringParameters || {};
  if (qs.token && isValidToken(qs.token)) return qs.token.trim();

  // 2) For direct function paths (/ .netlify / functions / download-link/<token>)
  const p = (event.path || "");
  const m = p.match(/(?:download-link|download)\/([0-9a-f-]{36})$/i);
  if (m && isValidToken(m[1])) return m[1];

  // 3) POST body
  try {
    if (event.httpMethod === "POST" && event.body) {
      const payload = JSON.parse(event.body || "{}");
      if (payload.token && isValidToken(payload.token)) return payload.token.trim();
    }
  } catch {}

  return null;
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }
    if (!BUCKET) return json(500, { error: "Server not configured." });
    if (tooMany(event)) return json(429, { error: "Too many requests. Try again shortly." });

    const method = event.httpMethod;
    if (method !== "GET" && method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    // --- Unified token extraction for GET and POST ---
    const token = getTokenFromEvent(event);
    if (!token) return json(400, { error: "Invalid token format" });

    // 1) Load token record
    const tokenKey = `tokens/${token}.json`;
    let record;
    try {
      record = await readJSON({ Bucket: BUCKET, Key: tokenKey });
    } catch (err) {
      console.error("[download-link] Token not found:", token, err.message);
      return json(404, { error: "Token not found or invalid" });
    }

    // 2) Expiry check (+ tiny grace)
    const now = Date.now();
    const expiresAt = Number(record.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || now > (expiresAt + 5000)) {
      const expiredDate = new Date(expiresAt).toLocaleString();
      console.warn("[download-link] Token expired:", token, "expired at:", expiredDate);
      return json(410, {
        error: "Token expired",
        expiredAt: expiredDate,
        message: "This download link has expired. Please contact support if you need assistance."
      });
    }

    // 3) Usage limit
    const currentUseCount = record.useCount || 0;
    if (currentUseCount >= MAX_USES) {
      console.warn("[download-link] Token usage limit reached:", token, "uses:", currentUseCount);
      return json(429, {
        error: "Download limit reached",
        uses: currentUseCount,
        maxUses: MAX_USES,
        message: `You've reached the maximum number of downloads (${MAX_USES}) for this purchase. Please contact support if you need assistance.`
      }, { "Retry-After": "86400" });
    }

    // 4) Update usage counters (best-effort)
    if (!record.usedAt) {
      record.usedAt = now;
      console.info("[download-link] First use of token:", token);
    }
    record.useCount = currentUseCount + 1;
    record.lastUsedAt = now;

    try {
      await writeJSON({ Bucket: BUCKET, Key: tokenKey, data: record });
    } catch (e) {
      console.error("[download-link] Failed to update token usage:", e.message);
      // Do not block the download
    }

    // 5) Resolve which CSV to serve
    let Key = record.key || CSV_FALLBACK;
    if (!Key) {
      try {
        const manifest = await readJSON({ Bucket: BUCKET, Key: MANIFEST_KEY });
        if (manifest && typeof manifest.latest === "string") Key = manifest.latest;
      } catch {}
    }
    if (!Key) {
      console.error("[download-link] No CSV key configured");
      return json(500, { error: "File not configured (no record.key, CSV_OBJECT_KEY, or manifest.latest)." });
    }

    // 6) Generate signed URL
    const cmd = new GetObjectCommand({
      Bucket: BUCKET,
      Key,
      ResponseContentDisposition: 'attachment; filename="vanished-brands.csv"',
      ResponseContentType: "text/csv; charset=utf-8",
    });
    const url = await getSignedUrl(s3, cmd, { expiresIn: DOWNLOAD_TTL });
    const last = record.useCount >= MAX_USES;

    console.info(`[download-link] Success key=${Key} ttl=${DOWNLOAD_TTL}s uses=${record.useCount}/${MAX_USES}`);

    // --- Behavior: GET → 302 redirect; POST → JSON (kept for XHR) ---
    if (method === "GET") {
      return {
        statusCode: 302,
        headers: {
          Location: url,
          // allow GET & OPTIONS on this endpoint for the browser navigation
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Cache-Control": "no-store",
        },
        body: "",
      };
    }

    // POST JSON response (existing behavior)
    return json(200, {
      url,
      uses: record.useCount,
      maxUses: MAX_USES,
      expiresAt: new Date(expiresAt).toISOString(),
      last
    });

  } catch (e) {
    console.error("[download-link] Error:", e && e.message ? e.message : e);
    return json(500, { error: "Internal server error" });
  }
};
