// netlify/functions/paypal-capture-order.js
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} = require("@aws-sdk/client-s3");
const crypto = require("node:crypto");

/* ---------- Config ---------- */
const PAYPAL_ENV = (process.env.PUBLIC_PAYPAL_ENV || process.env.PAYPAL_ENV || "sandbox").toLowerCase();
const PAYPAL_BASE = PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

const BUCKET  = process.env.S3_BUCKET_NAME;                         // required
const CSV_KEY = process.env.CSV_OBJECT_KEY || "exports/full-dataset.csv"; // default key

/* ---------- Tiny rate limit (per-process best-effort) ---------- */
const buckets = new Map();
const LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 20);
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
function tooMany(event) {
  const h = event.headers || {};
  const ip = h["x-nf-client-connection-ip"]
    || (h["x-forwarded-for"] ? h["x-forwarded-for"].split(",")[0].trim() : null)
    || h["client-ip"] || "unknown";
  const now = Date.now();
  const b = buckets.get(ip) || { count: 0, ts: now };
  if (now - b.ts > WINDOW_MS) { b.count = 0; b.ts = now; }
  b.count += 1; buckets.set(ip, b);
  return b.count > LIMIT;
}

/* ---------- HTTP helpers ---------- */
const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});
const tooManyResp = () => json(429, { error: "Too many requests. Please wait and try again." });

/* ---------- PayPal helpers ---------- */
async function getAccessToken() {
  const id  = process.env.PAYPAL_CLIENT_ID;
  const sec = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !sec) throw new Error("Missing PayPal credentials");
  const r = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${id}:${sec}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal token error ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.access_token;
}

/* ---------- S3 client (region-safe & cached) ---------- */
let _s3 = null;
let _s3Region = null;

function baseCredentials() {
  if (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    };
  }
  return undefined; // use default provider chain
}

/** Create S3 client; auto-correct region using HeadBucket */
async function getS3() {
  if (!BUCKET) throw new Error("Missing S3_BUCKET_NAME");
  const wanted = process.env.S3_REGION || "us-east-1";
  if (!_s3 || _s3Region !== wanted) {
    _s3 = new S3Client({ region: wanted, credentials: baseCredentials() });
    _s3Region = wanted;
  }
  try {
    await _s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return _s3;
  } catch (e) {
    const hdrs = e?.$metadata?.httpHeaders || {};
    const real = hdrs["x-amz-bucket-region"] || hdrs["x-amz-bucket-region".toLowerCase()];
    if (real && real !== _s3Region) {
      _s3 = new S3Client({ region: real, credentials: baseCredentials() });
      _s3Region = real;
      await _s3.send(new HeadBucketCommand({ Bucket: BUCKET })); // verify
      return _s3;
    }
    throw e;
  }
}

/* ---------- S3 persistence helpers ---------- */
async function getExistingOrder(orderID) {
  try {
    const s3 = await getS3();
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `orders/${orderID}.json` }));
    const text = await streamToString(r.Body);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function saveOrder(orderID, row) {
  const s3 = await getS3();
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: `orders/${orderID}.json`,
    Body: JSON.stringify(row),
    ContentType: "application/json; charset=utf-8",
  }));
}

async function mintDownloadToken(orderID) {
  const token = crypto.randomUUID();
  const record = {
    token,
    orderID,
    key: CSV_KEY,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h
  };
  const s3 = await getS3();
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: `tokens/${token}.json`,
    Body: JSON.stringify(record),
    ContentType: "application/json; charset=utf-8",
  }));
  return token;
}

function streamToString(stream) {
  return new Promise((res, rej) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", rej);
  });
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  try {
    if (tooMany(event)) return tooManyResp();
    if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

    if (!BUCKET || !CSV_KEY) {
      return json(500, { error: "Server not configured (S3_BUCKET_NAME / CSV_OBJECT_KEY missing)." });
    }

    const { orderID } = JSON.parse(event.body || "{}");
    if (!orderID) return json(400, { error: "orderID required" });

    // Idempotency: if already captured and token issued, return it
    const existing = await getExistingOrder(orderID);
    if (existing?.status === "COMPLETED" && existing?.token) {
      return json(200, { ok: true, token: existing.token, alreadyProcessed: true });
    }

    // Capture the PayPal order
    const access = await getAccessToken();
    const r = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* keep raw text for logging */ }

    if (!r.ok) {
      // Save diagnostic row; surface generic error to client
      await saveOrder(orderID, {
        orderID,
        status: data?.status || "ERROR",
        stage: "capture_http_error",
        httpStatus: r.status,
        raw: data || text,
        updatedAt: Date.now(),
      });
      return json(502, { ok: false, error: "capture failed" });
    }

    // Determine status from capture response
    const status =
      data?.status ||
      data?.purchase_units?.[0]?.payments?.captures?.[0]?.status ||
      "UNKNOWN";

    if (status !== "COMPLETED") {
      await saveOrder(orderID, {
        orderID,
        status,
        stage: "capture_not_completed",
        raw: data,
        updatedAt: Date.now(),
      });
      return json(400, { ok: false, error: "payment not completed", status });
    }

    // Success → mint single-use token
    const token = await mintDownloadToken(orderID);

    // Minimal order record (redacted)
    const capture = data?.purchase_units?.[0]?.payments?.captures?.[0] || null;
    const amount =
      capture?.amount?.value ||
      data?.purchase_units?.[0]?.amount?.value ||
      null;
    const currency =
      capture?.amount?.currency_code ||
      data?.purchase_units?.[0]?.amount?.currency_code ||
      null;

    const row = {
      orderID,
      status: "COMPLETED",
      token,
      amount,
      currency,
      payer: data?.payer ? {
        payer_id: data.payer?.payer_id,
        email: data.payer?.email_address,
      } : null,
      captureId: capture?.id || null,
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
      raw: {
        id: data?.id,
        intent: data?.intent,
        status: data?.status,
      },
    };
    await saveOrder(orderID, row);

    return json(200, { ok: true, token });
  } catch (e) {
    // Don’t leak internals to client; log server-side instead
    console.error("[paypal-capture-order] error", e);
    return json(500, { ok: false, error: "server error" });
  }
};
