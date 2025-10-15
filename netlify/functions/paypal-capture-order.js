// netlify/functions/paypal-capture-order.js

const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("node:crypto");

const PAYPAL_ENV = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
const BASE = PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

// --- best-effort in-memory rate limit (per process) ---
const buckets = new Map(); // { ip -> { count, ts } }
const LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 20);           // requests per window
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000); // window length ms

function tooMany(event) {
  const h = event.headers || {};
  const ip =
    h["x-nf-client-connection-ip"] ||
    (h["x-forwarded-for"] ? h["x-forwarded-for"].split(",")[0].trim() : null) ||
    h["client-ip"] ||
    "unknown";

  const now = Date.now();
  const b = buckets.get(ip) || { count: 0, ts: now };
  if (now - b.ts > WINDOW_MS) { b.count = 0; b.ts = now; }
  b.count += 1;
  buckets.set(ip, b);

  return b.count > LIMIT;
}

function tooManyResp() {
  return {
    statusCode: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(Math.ceil(WINDOW_MS / 1000)),
    },
    body: JSON.stringify({ error: "Too many requests. Please wait a minute and try again." }),
  };
}

// --- tiny helpers ---
function json(status, body) {
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

function streamToString(stream) {
  return new Promise((res, rej) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", rej);
  });
}

// --- PayPal helper ---
async function getAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const sec = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !sec) throw new Error("Missing PayPal credentials");
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${id}:${sec}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal token error ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.access_token;
}

// --- S3 client ---
const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY)
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined,
});

const BUCKET = process.env.S3_BUCKET_NAME;
const CSV_KEY = process.env.CSV_OBJECT_KEY || "exports/full-dataset.csv";

// --- persistence helpers (S3) ---
async function getExistingOrder(orderID) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `orders/${orderID}.json` }));
    const text = await streamToString(r.Body);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function saveOrderRow(orderID, row) {
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
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24h
    key: CSV_KEY,
    orderID,
  };
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: `tokens/${token}.json`,
    Body: JSON.stringify(record),
    ContentType: "application/json; charset=utf-8",
  }));
  return token;
}

// --- Handler ---
exports.handler = async (event) => {
  if (tooMany(event)) return tooManyResp();

  try {
    if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
    const { orderID } = JSON.parse(event.body || "{}");
    if (!orderID) return json(400, { error: "orderID required" });

    // ---- IDEMPOTENCY CHECK ---------------------------------------------------
    const existing = await getExistingOrder(orderID);
    if (existing && existing.status === "COMPLETED" && existing.token) {
      // Already processed; return the same token
      return json(200, { ok: true, token: existing.token, alreadyProcessed: true });
    }

    // ---- CAPTURE -------------------------------------------------------------
    const access = await getAccessToken();
    const res = await fetch(`${BASE}/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${access}`, "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (!res.ok) {
      // Persist a failed snapshot for support/debug
      await saveOrderRow(orderID, {
        orderID,
        status: data?.status || "ERROR",
        stage: "capture_error",
        note: "Non-OK capture response",
        raw: data,
        updatedAt: Date.now(),
      });
      return json(500, { error: data });
    }

    const status = data.status || (data.purchase_units?.[0]?.payments?.captures?.[0]?.status);
    if (status !== "COMPLETED") {
      await saveOrderRow(orderID, {
        orderID,
        status: status || "UNKNOWN",
        stage: "capture_not_completed",
        raw: data,
        updatedAt: Date.now(),
      });
      return json(400, { error: "Payment not completed", status });
    }

    // ---- SUCCESS: mint single-use token -------------------------------------
    const token = await mintDownloadToken(orderID);

    // Friendly fields to store (avoid huge payloads if you prefer)
    const capture =
      data?.purchase_units?.[0]?.payments?.captures?.[0] || null;
    const amount =
      capture?.amount?.value || data?.purchase_units?.[0]?.amount?.value || null;
    const currency =
      capture?.amount?.currency_code || data?.purchase_units?.[0]?.amount?.currency_code || null;

    const orderRow = {
      orderID,
      status: "COMPLETED",
      token,                     // for resend / support
      amount,
      currency,
      payer: data?.payer || null,
      captureId: capture?.id || null,
      updatedAt: Date.now(),
      createdAt: existing?.createdAt || Date.now(),
      // Optionally keep a trimmed raw, or remove entirely if you prefer
      raw: {
        id: data?.id,
        intent: data?.intent,
        status: data?.status,
        payer: data?.payer ? { payer_id: data.payer?.payer_id, email: data.payer?.email_address } : null,
      },
    };

    await saveOrderRow(orderID, orderRow);

    return json(200, { ok: true, token });
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
};
