// netlify/functions/paypal-capture-order.js
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,  // Add this
} = require("@aws-sdk/client-s3");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

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
  console.log('[getS3] Starting...');
  if (!BUCKET) throw new Error("Missing S3_BUCKET_NAME");
  
  const wanted = process.env.S3_REGION || "us-east-1";
  console.log('[getS3] Wanted region:', wanted);
  console.log('[getS3] Current _s3Region:', _s3Region);
  
  if (!_s3 || _s3Region !== wanted) {
    console.log('[getS3] Creating new S3 client');
    _s3 = new S3Client({ region: wanted, credentials: baseCredentials() });
    _s3Region = wanted;
  }
  
  try {
    console.log('[getS3] Sending HeadBucketCommand for bucket:', BUCKET);
    await _s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log('[getS3] HeadBucket succeeded, returning client');
    return _s3;
  } catch (e) {
    console.error('[getS3] HeadBucket failed:', e.message);
    console.error('[getS3] Error code:', e.code);
    console.error('[getS3] Error name:', e.name);
    
    const hdrs = e?.$metadata?.httpHeaders || {};
    const real = hdrs["x-amz-bucket-region"] || hdrs["x-amz-bucket-region".toLowerCase()];
    
    if (real && real !== _s3Region) {
      console.log('[getS3] Detected different region:', real, 'vs', _s3Region);
      _s3 = new S3Client({ region: real, credentials: baseCredentials() });
      _s3Region = real;
      await _s3.send(new HeadBucketCommand({ Bucket: BUCKET })); // verify
      console.log('[getS3] Region corrected, returning client');
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
  console.log('[saveOrder] Saving order:', orderID);
  const s3 = await getS3();
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: `orders/${orderID}.json`,
    Body: JSON.stringify(row),
    ContentType: "application/json; charset=utf-8",
  }));
  console.log('[saveOrder] Order saved successfully');
}

async function mintDownloadToken(orderID) {
  console.log('[mintDownloadToken] === START ===');
  console.log('[mintDownloadToken] orderID:', orderID);
  console.log('[mintDownloadToken] BUCKET:', BUCKET);
  console.log('[mintDownloadToken] CSV_KEY:', CSV_KEY);
  
  const token = crypto.randomUUID();
  const now = Date.now();
  console.log('[mintDownloadToken] Generated token:', token);
  console.log('[mintDownloadToken] Timestamp (ms):', now);
  console.log('[mintDownloadToken] Timestamp (ISO):', new Date(now).toISOString());
  
  const record = {
    token,
    orderID,
    key: CSV_KEY,
    createdAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000,
  };
  
  const tokenKey = `tokens/${token}.json`;
  console.log('[mintDownloadToken] Will write to key:', tokenKey);
  console.log('[mintDownloadToken] Record:', JSON.stringify(record));
  
  try {
    console.log('[mintDownloadToken] Calling getS3()...');
    const s3 = await getS3();
    console.log('[mintDownloadToken] S3 client obtained');
    console.log('[mintDownloadToken] Region:', _s3Region);
    
    console.log('[mintDownloadToken] Creating PutObjectCommand...');
    const putCommand = new PutObjectCommand({
      Bucket: BUCKET,
      Key: tokenKey,
      Body: JSON.stringify(record),
      ContentType: "application/json; charset=utf-8",
    });
    
    console.log('[mintDownloadToken] Sending PutObjectCommand to S3...');
    const putResult = await s3.send(putCommand);
    console.log('[mintDownloadToken] S3 PutObject response:', JSON.stringify(putResult));
    console.log('[mintDownloadToken] PutObject ETag:', putResult.ETag);
    
    // Immediately verify the object was written with correct timestamp
    console.log('[mintDownloadToken] Verifying object with HeadObjectCommand...');
    const headCommand = new HeadObjectCommand({
      Bucket: BUCKET,
      Key: tokenKey,
    });
    
    const headResult = await s3.send(headCommand);
    console.log('[mintDownloadToken] HeadObject response:', JSON.stringify(headResult, null, 2));
    console.log('[mintDownloadToken] Verified ETag:', headResult.ETag);
    console.log('[mintDownloadToken] Verified ContentLength:', headResult.ContentLength);
    console.log('[mintDownloadToken] Verified LastModified:', headResult.LastModified);
    console.log('[mintDownloadToken] Verified LastModified (ISO):', headResult.LastModified?.toISOString());
    
    // NEW: List all objects in tokens/ folder
    console.log('[mintDownloadToken] Listing all objects in tokens/ folder...');
    const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: 'tokens/',
      MaxKeys: 10
    });
    
    const listResult = await s3.send(listCommand);
    console.log('[mintDownloadToken] Number of objects in tokens/:', listResult.KeyCount);
    console.log('[mintDownloadToken] Objects found:', JSON.stringify(listResult.Contents, null, 2));
    
    // NEW: Try to read the object back immediately
    console.log('[mintDownloadToken] Attempting to read object back...');
    const getCommand = new GetObjectCommand({
      Bucket: BUCKET,
      Key: tokenKey,
    });
    
    const getResult = await s3.send(getCommand);
    const bodyText = await streamToString(getResult.Body);
    console.log('[mintDownloadToken] Read back body:', bodyText);
    console.log('[mintDownloadToken] Body matches original:', bodyText === JSON.stringify(record));
    
    // Compare timestamps
    const s3Timestamp = headResult.LastModified?.getTime();
    const createdTimestamp = record.createdAt;
    const timeDiff = s3Timestamp ? Math.abs(s3Timestamp - createdTimestamp) : null;
    
    console.log('[mintDownloadToken] Timestamp comparison:');
    console.log('[mintDownloadToken]   Created at (ms):', createdTimestamp);
    console.log('[mintDownloadToken]   Created at (ISO):', new Date(createdTimestamp).toISOString());
    console.log('[mintDownloadToken]   S3 LastModified (ms):', s3Timestamp);
    console.log('[mintDownloadToken]   S3 LastModified (ISO):', headResult.LastModified?.toISOString());
    console.log('[mintDownloadToken]   Time difference (ms):', timeDiff);
    console.log('[mintDownloadToken]   Time difference (seconds):', timeDiff ? (timeDiff / 1000).toFixed(2) : 'N/A');
    
    if (timeDiff && timeDiff > 60000) {
      console.warn('[mintDownloadToken] ⚠️  WARNING: Significant timestamp mismatch detected!');
      console.warn('[mintDownloadToken]   Expected:', new Date(createdTimestamp).toISOString());
      console.warn('[mintDownloadToken]   Got from S3:', headResult.LastModified?.toISOString());
      console.warn('[mintDownloadToken]   Difference:', (timeDiff / 1000 / 60).toFixed(2), 'minutes');
    } else {
      console.log('[mintDownloadToken] ✓ Timestamp verification passed (within 1 minute tolerance)');
    }
    
    console.log('[mintDownloadToken] === SUCCESS ===');
    
    return token;
  } catch (error) {
    console.error('[mintDownloadToken] === ERROR ===');
    console.error('[mintDownloadToken] Error type:', error.constructor.name);
    console.error('[mintDownloadToken] Error message:', error.message);
    console.error('[mintDownloadToken] Error code:', error.code);
    console.error('[mintDownloadToken] Error name:', error.name);
    console.error('[mintDownloadToken] HTTP status:', error.$metadata?.httpStatusCode);
    console.error('[mintDownloadToken] Request ID:', error.$metadata?.requestId);
    console.error('[mintDownloadToken] Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    throw error;
  }
}

function streamToString(stream) {
  return new Promise((res, rej) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", rej);
  });
}

/* ---------- Purchase Logging ---------- */
async function logPurchase(data, event) {
  try {
    const h = event.headers || {};
    const ip = h["x-nf-client-connection-ip"]
      || (h["x-forwarded-for"] ? h["x-forwarded-for"].split(",")[0].trim() : null)
      || h["client-ip"]
      || "unknown";
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      environment: PAYPAL_ENV,
      orderId: data.orderID,
      transactionId: data.captureId,
      payerEmail: data.payer?.email || null,
      payerId: data.payer?.payer_id || null,
      amount: data.amount,
      currency: data.currency,
      status: data.status,
      token: data.token,
      tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      ipAddress: ip,
      userAgent: h["user-agent"] || "unknown",
    };

    // Log to console (captured by Netlify logs)
    console.log("=== PURCHASE COMPLETED ===");
    console.log(JSON.stringify(logEntry, null, 2));
    console.log("==========================");

    // Optionally log to S3 for long-term storage
    if (process.env.ENABLE_S3_PURCHASE_LOGS === "true") {
      const s3 = await getS3();
      const logKey = `purchase-logs/${new Date().toISOString().split('T')[0]}/${data.orderID}.json`;
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: logKey,
        Body: JSON.stringify(logEntry, null, 2),
        ContentType: "application/json; charset=utf-8",
      }));
    }

    // Optionally log to local file (useful for local dev)
    if (process.env.NODE_ENV === "development" || process.env.ENABLE_FILE_LOGGING === "true") {
      const logDir = path.join(process.cwd(), "data");
      const logFile = path.join(logDir, "purchases.jsonl");
      
      try {
        await fs.mkdir(logDir, { recursive: true });
        await fs.appendFile(logFile, JSON.stringify(logEntry) + "\n");
      } catch (err) {
        console.error("Failed to write to local log file:", err.message);
      }
    }
  } catch (err) {
    // Don't fail the purchase if logging fails
    console.error("Purchase logging failed:", err.message);
  }
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  try {
    console.log('[handler] Function invoked');
    
    if (tooMany(event)) return tooManyResp();
    if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

    if (!BUCKET || !CSV_KEY) {
      return json(500, { error: "Server not configured (S3_BUCKET_NAME / CSV_OBJECT_KEY missing)." });
    }

    const { orderID } = JSON.parse(event.body || "{}");
    if (!orderID) return json(400, { error: "orderID required" });
    
    console.log('[handler] Processing orderID:', orderID);

    // Idempotency: if already captured and token issued, return it
    const existing = await getExistingOrder(orderID);
    if (existing?.status === "COMPLETED" && existing?.token) {
      console.log(`[handler] Order ${orderID} already processed, returning existing token`);
      return json(200, { ok: true, token: existing.token, alreadyProcessed: true });
    }

    // Capture the PayPal order
    console.log('[handler] Capturing PayPal order...');
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
      console.error(`[handler] PayPal capture failed for order ${orderID}:`, r.status, text);
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

    console.log('[handler] Capture status:', status);

    if (status !== "COMPLETED") {
      console.warn(`[handler] Order ${orderID} capture status is ${status}, not COMPLETED`);
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
    console.log('[handler] About to mint download token for orderID:', orderID);
    let token;
    try {
      token = await mintDownloadToken(orderID);
      console.log('[handler] Token minted successfully:', token);
    } catch (tokenError) {
      console.error('[handler] Failed to mint token:', tokenError);
      throw tokenError;
    }

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
    
    console.log('[handler] Saving order record...');
    await saveOrder(orderID, row);

    // Log the successful purchase
    console.log('[handler] Logging purchase...');
    await logPurchase(row, event);

    console.log('[handler] Returning success response');
    return json(200, { ok: true, token });
  } catch (e) {
    // Don't leak internals to client; log server-side instead
    console.error("[handler] FATAL ERROR:", e);
    console.error("[handler] Error stack:", e.stack);
    return json(500, { ok: false, error: "server error" });
  }
};