// netlify/functions/admin-remint-token.js
/* eslint-disable node/no-unsupported-features/es-syntax */
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} = require("@aws-sdk/client-s3");
const crypto = require("node:crypto");

/* ---------- Config ---------- */
const REGION = process.env.S3_REGION || "us-east-1";
const BUCKET = process.env.S3_BUCKET_NAME;                              // required
const CSV_FALLBACK = process.env.CSV_OBJECT_KEY || "exports/brands-latest.csv";
const ADMIN_SECRET = process.env.ADMIN_REMINT_SECRET;                    // required
const TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_MS || 86_400_000);     // default 24h
const MAX_USES     = Number(process.env.MAX_REDEMPTIONS || process.env.MAX_TOKEN_USES || 3);

const TOKENS_JSON_PREFIX  = process.env.TOKENS_JSON_PREFIX  || "tokens/";        // tokens/<uuid>.json
const TOKENS_STATE_PREFIX = process.env.TOKENS_STATE_PREFIX || "tokens-state/";  // tokens-state/<uuid>
const ORDERS_PREFIX       = process.env.ORDERS_PREFIX       || "orders/";        // orders/<orderID>.json

/* ---------- S3 client ---------- */
const s3 = new S3Client({
  region: REGION,
  credentials: (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY)
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined,
});

/* ---------- Helpers ---------- */
const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

function isValidOrderId(id) {
  // PayPal order IDs vary; accept reasonable ASCII without spaces
  return typeof id === "string" && id.length >= 6 && id.length <= 64 && /^[A-Za-z0-9_-]+$/.test(id);
}

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

const tokenJsonKey  = (token) => `${TOKENS_JSON_PREFIX}${token}.json`;
const tokenStateKey = (token) => `${TOKENS_STATE_PREFIX}${token}`;
const orderKey      = (orderID) => `${ORDERS_PREFIX}${orderID}.json`;

/** Create a fresh token JSON and tokens-state object */
async function mintToken({ orderID, fileKey, ttlMs, maxUses }) {
  const token = crypto.randomUUID();
  const now   = Date.now();
  const expMs = now + ttlMs;
  const expIso = new Date(expMs).toISOString();

  // Immutable token JSON (no useCount here)
  const record = {
    token,
    orderID,
    key: fileKey,
    createdAt: now,
    expiresAt: expMs, // epoch ms
  };
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: tokenJsonKey(token),
    Body: JSON.stringify(record),
    ContentType: "application/json; charset=utf-8",
  }));

  // Pre-create state object used by downloader (uses/max/exp in metadata)
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: tokenStateKey(token),
    Body: "",
    Metadata: {
      uses: "0",
      max:  String(maxUses),
      exp:  expIso,
    },
    ContentType: "application/octet-stream",
  }));

  return { token, expIso };
}

/** Best-effort revoke of a prior token by expiring its state metadata */
async function revokeOldToken(oldToken) {
  if (!oldToken) return false;
  try {
    // Read existing state
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: tokenStateKey(oldToken) }));
    const etag = (head.ETag || "").replace(/"/g, "");
    const meta = head.Metadata || {};
    const newMeta = {
      ...meta,
      // expire immediately
      exp: new Date(Date.now() - 1000).toISOString(),
      // (optionally) force zero remaining by setting max=uses
      max: meta.uses || meta.max || "0",
    };
    await s3.send(new CopyObjectCommand({
      Bucket: BUCKET,
      Key: tokenStateKey(oldToken),
      CopySource: `/${BUCKET}/${encodeURIComponent(tokenStateKey(oldToken))}`,
      MetadataDirective: "REPLACE",
      Metadata: newMeta,
      CopySourceIfMatch: etag,
    }));
    return true;
  } catch (e) {
    // Missing state or no permission — ignore; downloader will still respect time/uses
    return false;
  }
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
    if (!BUCKET) return json(500, { error: "Server not configured (S3_BUCKET_NAME missing)." });
    if (!ADMIN_SECRET) return json(500, { error: "Server not configured (ADMIN_REMINT_SECRET missing)." });

    // Auth
    const hdrSecret = event.headers?.["x-admin-secret"] || event.headers?.["X-Admin-Secret"] || event.headers?.["x-Admin-Secret"];
    if (!hdrSecret || hdrSecret !== ADMIN_SECRET) return json(403, { error: "Forbidden" });

    // Parse body
    let orderID = null;
    try { orderID = (JSON.parse(event.body || "{}")).orderID || null; } catch {}
    if (!isValidOrderId(orderID)) return json(400, { error: "orderID required/invalid" });

    // Load order
    let order;
    try {
      order = await readJSON({ Bucket: BUCKET, Key: orderKey(orderID) });
    } catch (e) {
      return json(404, { error: "order not found" });
    }

    // Validate order status
    const status = order?.status || order?.raw?.status || "UNKNOWN";
    if (status !== "COMPLETED") {
      return json(400, { error: "order not completed", status });
    }

    // Determine file key (prefer explicit in order; else fallback)
    const fileKey = order?.key || CSV_FALLBACK;

    // Revoke prior token (best effort)
    const previousToken = order?.token || null;
    const revoked = await revokeOldToken(previousToken);

    // Mint new token
    const { token, expIso } = await mintToken({
      orderID,
      fileKey,
      ttlMs: TOKEN_TTL_MS,
      maxUses: MAX_USES,
    });

    // (Optional) update order record with new token indicator — not required for functionality.
    // If you want a history, you could write an "order-updates/" event instead of mutating orders/.
    // Keeping orders immutable avoids churn; so we skip it here.

    // Concise log (no URL)
    const tail = token.slice(-6);
    console.info(`[admin-remint] order=${orderID} token=*${tail} exp=${expIso} max=${MAX_USES} revokedOld=${Boolean(revoked)}`);

    return json(200, {
      ok: true,
      token,
      expiresAt: expIso,
      maxUses: MAX_USES,
      key: fileKey,
    });
  } catch (e) {
    console.error("[admin-remint] ERROR:", e && e.message ? e.message : e);
    return json(500, { error: "server error" });
  }
};
