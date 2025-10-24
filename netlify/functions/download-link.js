// netlify/functions/download-link.js
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

/* ---------- Config ---------- */
const REGION        = process.env.S3_REGION || "us-east-1";
const BUCKET        = process.env.S3_BUCKET_NAME; // required
const MANIFEST_KEY  = process.env.S3_MANIFEST_KEY || "exports/manifest.json";
const CSV_FALLBACK  = process.env.CSV_OBJECT_KEY || "exports/brands-latest.csv";
const DOWNLOAD_TTL  = Number(process.env.DOWNLOAD_TTL_SECONDS || 900); // 15m
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
  // For production you can restrict to your origin: "https://vanishedbrands.com"
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

function json(status, body, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { ...corsHeaders(), "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function isValidUUID(t) {
  return typeof t === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  try {
    // Preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }

    if (!BUCKET) return json(500, { error: "Server not configured." });
    if (tooMany(event)) return json(429, { error: "Too many requests. Try again shortly." });

    const isGET  = event.httpMethod === "GET";
    const isPOST = event.httpMethod === "POST";

    // Parse token and peek
    const qs = event.queryStringParameters || {};
    let token = null;

    if (isPOST) {
      try { token = (JSON.parse(event.body || "{}")).token || null; } catch {}
    } else if (isGET) {
      token = qs.token || (event.path || "").split("/").pop(); // supports pretty URL /download/<token>
    }

    const peek = isGET && (qs.peek === "1" || qs.peek === "true");

    if (!isGET && !isPOST) return json(405, { error: "Method not allowed" });
    if (!token || !isValidUUID(token)) return json(400, { error: "Invalid token format" });

    // Load token record (no mutation yet)
    const tokenKey = `tokens/${token}.json`;
    let record;
    try {
      record = await readJSON({ Bucket: BUCKET, Key: tokenKey });
    } catch (err) {
      console.error("[download-link] Token not found:", token, err.message);
      return json(404, { error: "Token not found or invalid" });
    }

    // Expiry
    const now = Date.now();
    const expiresAt = Number(record.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || now > (expiresAt + 5000)) {
      return json(410, {
        error: "Token expired",
        expiredAt: new Date(expiresAt).toLocaleString(),
        message: "This download link has expired. Please contact support if you need assistance."
      });
    }

    const uses = Number(record.useCount || 0);

    // ---- PEEK (GET ?peek=1) : return counts only; do NOT touch S3 or increment
    if (peek) {
      const remaining = Math.max(0, MAX_USES - uses);
      const last = remaining <= 1;
      return json(200, {
        uses,
        maxUses: MAX_USES,
        remaining,
        expiresAt: new Date(expiresAt).toISOString(),
        last
      });
    }

    // ---- Normal redemption (POST JSON or GET pretty URL) ----
    if (uses >= MAX_USES) {
      return json(429, {
        error: "Download limit reached",
        uses,
        maxUses: MAX_USES,
        message: `You've reached the maximum number of downloads (${MAX_USES}) for this purchase. Please contact support if you need assistance.`
      }, { "Retry-After": "86400" });
    }

    // Increment counters
    if (!record.usedAt) record.usedAt = now;
    record.useCount = uses + 1;
    record.lastUsedAt = now;
    try {
      await writeJSON({ Bucket: BUCKET, Key: tokenKey, data: record });
    } catch (e) {
      console.warn("[download-link] Failed to update token usage:", e.message);
      // continue anyway
    }

    // Resolve CSV key
    let Key = record.key || CSV_FALLBACK;
    if (!Key) {
      try {
        const manifest = await readJSON({ Bucket: BUCKET, Key: MANIFEST_KEY });
        if (manifest && typeof manifest.latest === "string") Key = manifest.latest;
      } catch {}
    }
    if (!Key) return json(500, { error: "File not configured (no record.key, CSV_OBJECT_KEY, or manifest.latest)." });

    // Generate signed URL
    const cmd = new GetObjectCommand({
      Bucket: BUCKET,
      Key,
      ResponseContentDisposition: 'attachment; filename="vanished-brands.csv"',
      ResponseContentType: "text/csv; charset=utf-8",
    });
    const url = await getSignedUrl(s3, cmd, { expiresIn: DOWNLOAD_TTL });
    const last = record.useCount >= MAX_USES;

    console.info(`[download-link] Success - key=${Key} ttl=${DOWNLOAD_TTL}s uses=${record.useCount}/${MAX_USES}`);

    if (isPOST) {
      // XHR flow → return JSON containing URL
      return json(200, {
        url,
        uses: record.useCount,
        maxUses: MAX_USES,
        expiresAt: new Date(expiresAt).toISOString(),
        last
      });
    }

    // Pretty GET flow → 302 redirect to S3 (browser navigates to file)
    return {
      statusCode: 302,
      headers: {
        ...corsHeaders(),
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        Location: url,
      },
      body: ""
    };

  } catch (e) {
    console.error("[download-link] Error:", e && e.message ? e.message : e);
    return json(500, { error: "Internal server error" });
  }
};
