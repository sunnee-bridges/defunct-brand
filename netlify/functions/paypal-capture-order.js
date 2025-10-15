// netlify/functions/paypal-capture-order.js

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} = require("@aws-sdk/client-s3");
const crypto = require("node:crypto");

/* ---------------- PayPal setup ---------------- */
const PAYPAL_ENV = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
const BASE =
  PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

/* ---------------- Rate limit (best-effort) ---------------- */
const buckets = new Map(); // { ip -> { count, ts } }
const LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 20);
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);

function tooMany(event) {
  const h = event.headers || {};
  const ip =
    h["x-nf-client-connection-ip"] ||
    (h["x-forwarded-for"] ? h["x-forwarded-for"].split(",")[0].trim() : null) ||
    h["client-ip"] ||
    "unknown";
  const now = Date.now();
  const b = buckets.get(ip) || { count: 0, ts: now };
  if (now - b.ts > WINDOW_MS) {
    b.count = 0;
    b.ts = now;
  }
  b.count += 1;
  buckets.set(ip, b);
  return b.count > LIMIT;
}

function tooManyResp() {
  return json(429, {
    error: "Too many requests. Please wait a minute and try again.",
  });
}

/* ---------------- Tiny helpers ---------------- */
function json(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function streamToString(stream) {
  return new Promise((res, rej) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", rej);
  });
}

/* ---------------- PayPal helper ---------------- */
async function getAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const sec = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !sec) throw new Error("Missing PayPal credentials");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${sec}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok)
    throw new Error(`PayPal token error ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.access_token;
}

/* ---------------- S3 client (region-safe) ---------------- */
// Use S3_REGION (since AWS_REGION is reserved in Netlify UI)
const BUCKET = process.env.S3_BUCKET_NAME;
const CSV_KEY = process.env.CSV_OBJECT_KEY || "exports/full-dataset.csv";

let _s3 = null;
let _s3Region = null;

function baseCredentials() {
  // Explicit creds if provided; else default provider chain
  if (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    };
  }
  return undefined;
}

/**
 * Build (and cache) an S3 client. Probe the bucket with HeadBucket.
 * If AWS replies with x-amz-bucket-region, rebuild client with that region.
 */
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
    const real =
      hdrs["x-amz-bucket-region"] || hdrs["x-amz-bucket-region".toLowerCase()];
    if (real && real !== _s3Region) {
      _s3 = new S3Client({ region: real, credentials: baseCredentials() });
      _s3Region = real;
      // Verify once more; throw if still failing
      await _s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
      return _s3;
    }
    throw e;
  }
}

/* ---------------- persistence helpers (S3) ---------------- */
async function getExistingOrder(orderID) {
  try {
    const s3 = await getS3();
    const r = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: `orders/${orderID}.json` })
    );
    const text = await streamToString(r.Body);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function saveOrderRow(orderID, row) {
  const s3 = await getS3();
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `orders/${orderID}.json`,
      Body: JSON.stringify(row),
      ContentType: "application/json; charset=utf-8",
    })
  );
}

async function mintDownloadToken(orderID) {
  const token = crypto.randomUUID();
  const record = {
    token,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h
    key: CSV_KEY,
    orderID,
  };
  const s3 = await getS3();
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `tokens/${token}.json`,
      Body: JSON.stringify(record),
      ContentType: "application/json; charset=utf-8",
    })
  );
  return token;
}

/* ---------------- Handler ---------------- */
exports.handler = async (event) => {
  if (tooMany(event)) return tooManyResp();

  try {
    if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
    const { orderID } = JSON.parse(event.body || "{}");
    if (!orderID) return json(400, { error: "orderID required" });
    if (!BUCKET || !CSV_KEY)
      return json(500, { error: "Missing S3_BUCKET_NAME or CSV_OBJECT_KEY" });

    // Idempotency: already processed?
    const existing = await getExistingOrder(orderID);
    if (existing && existing.status === "COMPLETED" && existing.token) {
      return json(200, {
        ok: true,
        token: existing.token,
        alreadyProcessed: true,
      });
    }

    // Capture
    const access = await getAccessToken();
    const res = await fetch(`${BASE}/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* keep raw text for errors */ }

    if (!res.ok) {
      await saveOrderRow(orderID, {
        orderID,
        status: data?.status || "ERROR",
        stage: "capture_error",
        note: "Non-OK capture response",
        raw: data || text,
        updatedAt: Date.now(),
      });
      return json(502, { ok: false, error: "PayPal capture failed", status: res.status, details: data || text });
    }

    const status =
      data?.status ||
      data?.purchase_units?.[0]?.payments?.captures?.[0]?.status ||
      "UNKNOWN";

    if (status !== "COMPLETED") {
      await saveOrderRow(orderID, {
        orderID,
        status: status || "UNKNOWN",
        stage: "capture_not_completed",
        raw: data,
        updatedAt: Date.now(),
      });
      return json(400, { ok: false, error: "Payment not completed", status });
    }

    // SUCCESS → token
    const token = await mintDownloadToken(orderID);

    // Trimmed order row
    const capture = data?.purchase_units?.[0]?.payments?.captures?.[0] || null;
    const amount =
      capture?.amount?.value ||
      data?.purchase_units?.[0]?.amount?.value ||
      null;
    const currency =
      capture?.amount?.currency_code ||
      data?.purchase_units?.[0]?.amount?.currency_code ||
      null;

    const orderRow = {
      orderID,
      status: "COMPLETED",
      token,
      amount,
      currency,
      payer: data?.payer || null,
      captureId: capture?.id || null,
      updatedAt: Date.now(),
      createdAt: existing?.createdAt || Date.now(),
      raw: {
        id: data?.id,
        intent: data?.intent,
        status: data?.status,
        payer: data?.payer
          ? { payer_id: data.payer?.payer_id, email: data.payer?.email_address }
          : null,
      },
    };

    await saveOrderRow(orderID, orderRow);
    return json(200, { ok: true, token });
  } catch (e) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
};
