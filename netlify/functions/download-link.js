// netlify/functions/download-link.js
/* eslint-disable node/no-unsupported-features/es-syntax */
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

/* ---------- Config ---------- */
const REGION        = process.env.S3_REGION || "us-east-1";
const BUCKET        = process.env.S3_BUCKET_NAME; // required: holds tokens JSON, state objects, manifest, and file
const MANIFEST_KEY  = process.env.S3_MANIFEST_KEY || "exports/manifest.json";
const CSV_FALLBACK  = process.env.CSV_OBJECT_KEY || "exports/brands-latest.csv";
const DOWNLOAD_TTL  = Number(process.env.DOWNLOAD_TTL_SECONDS || 900); // 15m
const MAX_USES      = Number(process.env.MAX_REDEMPTIONS || process.env.MAX_TOKEN_USES || 3);

const TOKENS_JSON_PREFIX  = process.env.TOKENS_JSON_PREFIX  || "tokens/";        // tokens/<uuid>.json
const TOKENS_STATE_PREFIX = process.env.TOKENS_STATE_PREFIX || "tokens-state/";  // tokens-state/<uuid> (metadata only)

/* ---------- Tiny per-process rate limit (best-effort) ---------- */
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
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*"; // tighten to your site origin in prod
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}
function json(status, body, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
    body: JSON.stringify(body),
  };
}
function isValidUUID(t) {
  return typeof t === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}
const jsonKey  = (token) => `${TOKENS_JSON_PREFIX}${token}.json`;
const stateKey = (token) => `${TOKENS_STATE_PREFIX}${token}`;

/* ---------- State object (metadata-only) ---------- */
async function headState(Bucket, Key) {
  const head = await s3.send(new HeadObjectCommand({ Bucket, Key }));
  const etag = (head.ETag || "").replace(/"/g, "");
  const meta = head.Metadata || {};
  return { etag, meta };
}
async function bootstrapState({ Bucket, Key, max, expIso }) {
  // Create if missing
  await s3.send(new PutObjectCommand({
    Bucket,
    Key,
    Body: "", // zero-byte ok
    Metadata: {
      uses: "0",
      max: String(max),
      exp: expIso || "",
    },
    ContentType: "application/octet-stream",
  }));
}
function parseState(meta, defaultMax) {
  const uses = Number(meta.uses ?? 0);
  const max  = Number(meta.max ?? defaultMax ?? MAX_USES);
  const exp  = meta.exp || meta.expires || ""; // ISO
  return { uses, max, exp };
}
function isExpired(expIso) {
  if (!expIso) return false;
  const d = new Date(expIso);
  return !isNaN(d.getTime()) && Date.now() >= d.getTime();
}
async function casIncrement({ Bucket, Key, meta, etag }) {
  const uses = Number(meta.uses ?? 0);
  const max  = Number(meta.max  ?? MAX_USES);
  const newMeta = {
    ...meta,
    uses: String(uses + 1),
    max:  String(max),
    exp:  meta.exp || "",
  };
  await s3.send(new CopyObjectCommand({
    Bucket,
    Key,
    CopySource: `/${Bucket}/${encodeURIComponent(Key)}`,
    MetadataDirective: "REPLACE",
    Metadata: newMeta,
    CopySourceIfMatch: etag, // CAS guard — fails with 412 if someone won the race
  }));
  return { uses: uses + 1, max };
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }
    if (!BUCKET) return json(500, { error: "Server not configured." });
    if (tooMany(event)) return json(429, { error: "Too many requests. Try again shortly." });

    const isGET  = event.httpMethod === "GET";
    const isPOST = event.httpMethod === "POST";

    // Parse token & peek
    const qs = event.queryStringParameters || {};
    let token = null;
    if (isPOST) {
      try { token = (JSON.parse(event.body || "{}")).token || null; } catch {}
    } else if (isGET) {
      token = qs.token || (event.path || "").split("/").pop(); // allows pretty /download/<token>
    }
    const peek = isGET && (qs.peek === "1" || qs.peek === "true");

    if (!isGET && !isPOST) return json(405, { error: "Method not allowed" });
    if (!token || !isValidUUID(token)) return json(400, { error: "Invalid token format" });

    // Load token JSON (static metadata: expiry, file key)
    const tokenJsonKey = jsonKey(token);
    let record;
    try {
      record = await readJSON({ Bucket: BUCKET, Key: tokenJsonKey });
    } catch (err) {
      console.error("[download-link] Token not found:", token, err.message);
      return json(404, { error: "Token not found or invalid" });
    }

    // Derive expiry ISO from record (your record.expiresAt is epoch ms)
    const expMs  = Number(record.expiresAt || 0);
    const expIso = Number.isFinite(expMs) ? new Date(expMs).toISOString() : "";

    // Ensure state object exists (first access bootstrap)
    const stKey = stateKey(token);
    let state;
    try {
      const { etag, meta } = await headState(BUCKET, stKey);
      state = { etag, ...parseState(meta, MAX_USES) };
    } catch (err) {
      // If missing, create it from record values
      await bootstrapState({ Bucket: BUCKET, Key: stKey, max: MAX_USES, expIso });
      const { etag, meta } = await headState(BUCKET, stKey);
      state = { etag, ...parseState(meta, MAX_USES) };
    }

    // Effective values
    const uses = state.uses;
    const maxUses = state.max || MAX_USES;
    const expiresAtIso = state.exp || expIso || ""; // prefer state.exp if present
    const remaining = Math.max(0, maxUses - uses);
    const expired = isExpired(expiresAtIso);

    // ---- PEEK (non-consuming) ----
    if (peek) {
      const last = remaining === 1 && !expired;
      return json(200, {
        ok: true,
        uses,
        maxUses,
        remaining,
        expiresAt: expiresAtIso || null,
        last,
      });
    }

    // Validate before increment
    if (expired) {
      return json(410, {
        error: "Token expired",
        message: "This download link has expired. Please contact support if you need assistance.",
        uses,
        maxUses,
        remaining: 0,
        expiresAt: expiresAtIso || null,
      });
    }
    if (remaining <= 0) {
      return json(429, {
        error: "Download limit reached",
        uses,
        maxUses,
        remaining: 0,
        message: `You've reached the maximum number of downloads (${maxUses}) for this purchase. Please contact support if you need assistance.`,
      }, { "Retry-After": "86400" });
    }

    // Resolve CSV key
    let fileKey = record.key || CSV_FALLBACK;
    if (!fileKey) {
      try {
        const manifest = await readJSON({ Bucket: BUCKET, Key: MANIFEST_KEY });
        if (manifest && typeof manifest.latest === "string") fileKey = manifest.latest;
      } catch {}
    }
    if (!fileKey) return json(500, { error: "File not configured (no record.key, CSV_OBJECT_KEY, or manifest.latest)." });

    // ---- Atomic consume via CAS (CopyObject If-Match) ----
    const maxRetries = 5;
    let snap = { etag: state.etag, uses, max: maxUses, exp: expiresAtIso };
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const inc = await casIncrement({
          Bucket: BUCKET,
          Key: stKey,
          meta: { uses: String(snap.uses), max: String(snap.max), exp: snap.exp || "" },
          etag: snap.etag,
        });
        // Success → presign S3 object
        const cmd = new GetObjectCommand({
          Bucket: BUCKET,
          Key: fileKey,
          ResponseContentDisposition: 'attachment; filename="vanished-brands.csv"',
          ResponseContentType: "text/csv; charset=utf-8",
          ResponseCacheControl: "no-store",  
        });
        const url = await getSignedUrl(s3, cmd, { expiresIn: DOWNLOAD_TTL });
        const last = inc.uses >= inc.max;

        // POST → JSON (XHR); GET → 302
        if (isPOST) {
          return json(200, {
            url,
            uses: inc.uses,
            maxUses: inc.max,
            expiresAt: expiresAtIso || null,
            last,
          });
        }
        return {
          statusCode: 302,
          headers: {
            ...corsHeaders(),
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            Location: url,
          },
          body: "",
        };

      } catch (err) {
        // CAS failed? Re-head and retry
        const status = err.$metadata?.httpStatusCode;
        const isPrecond = status === 412 || err.name === "PreconditionFailed";
        if (!isPrecond) {
          console.warn("[download-link] Non-precondition error on CAS:", err.name || err, "attempt", attempt + 1);
          throw err;
        }
        // Refresh snapshot
        const { etag, meta } = await headState(BUCKET, stKey);
        const parsed = parseState(meta, MAX_USES);
        const rem = Math.max(0, parsed.max - parsed.uses);
        const expd = isExpired(parsed.exp || expiresAtIso);

        if (expd) {
          return json(410, {
            error: "Token expired",
            message: "This download link has expired. Please contact support if you need assistance.",
            uses: parsed.uses, maxUses: parsed.max, remaining: 0, expiresAt: parsed.exp || expiresAtIso || null,
          });
        }
        if (rem <= 0) {
          return json(429, {
            error: "Download limit reached",
            message: `You've reached the maximum number of downloads (${parsed.max}). Please contact support if you need assistance.`,
            uses: parsed.uses, maxUses: parsed.max, remaining: 0, expiresAt: parsed.exp || expiresAtIso || null,
          });
        }
        snap = { etag, uses: parsed.uses, max: parsed.max, exp: parsed.exp || expiresAtIso };
        await new Promise(r => setTimeout(r, 40 + Math.random() * 140)); // jitter
      }
    }

    return json(409, { error: "Conflict", message: "Please try the download again." });

  } catch (e) {
    console.error("[download-link] Error:", e && e.message ? e.message : e);
    const code = e.$metadata?.httpStatusCode || 500;
    return json(code, { error: "Internal server error" });
  }
};
