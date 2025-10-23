// netlify/functions/paypal-webhook.js
// Verify PayPal webhooks, dedupe by event.id, persist a compact reconciliation

const { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

/* ---------- Config ---------- */
const PAYPAL_ENV = (process.env.PAYPAL_ENV || "sandbox").toLowerCase(); // set to 'live' in prod
const BASE = PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID; // must be LIVE webhook id in prod

const BUCKET = process.env.S3_BUCKET_NAME;
const REGION = process.env.S3_REGION || "us-east-1"; // prefer S3_REGION over AWS_REGION

/* ---------- S3 ---------- */
const s3 = new S3Client({
  region: REGION,
  credentials: (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY)
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined,
});

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/* ---------- Helpers ---------- */
function getHeader(h, name) {
  // Netlify lowercases headers; be defensive anyway
  const k = name.toLowerCase();
  for (const key in h) if (key.toLowerCase() === k) return h[key];
  return undefined;
}

async function getAccessToken() {
  const id  = process.env.PAYPAL_CLIENT_ID;
  const sec = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !sec) throw new Error("Missing PayPal credentials");
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${sec}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal token error ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.access_token;
}

async function verifySignature(rawBody, headers) {
  const transmission_id   = getHeader(headers, "paypal-transmission-id");
  const transmission_time = getHeader(headers, "paypal-transmission-time");
  const cert_url          = getHeader(headers, "paypal-cert-url");
  const auth_algo         = getHeader(headers, "paypal-auth-algo");
  const transmission_sig  = getHeader(headers, "paypal-transmission-sig");

  if (!WEBHOOK_ID) throw new Error("Missing PAYPAL_WEBHOOK_ID");
  if (!transmission_id || !transmission_time || !cert_url || !auth_algo || !transmission_sig) {
    throw new Error("Missing PayPal verification headers");
  }

  const access = await getAccessToken();
  const res = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      transmission_id,
      transmission_time,
      cert_url,
      auth_algo,
      transmission_sig,
      webhook_id: WEBHOOK_ID,
      webhook_event: JSON.parse(rawBody),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`verify ${res.status}: ${JSON.stringify(data)}`);
  return data.verification_status === "SUCCESS";
}

async function eventAlreadyProcessed(eventId) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: `webhooks/${eventId}.json` }));
    return true;
  } catch {
    return false;
  }
}

async function markEventProcessed(eventId, evt) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: `webhooks/${eventId}.json`,
    Body: JSON.stringify({ storedAt: new Date().toISOString(), env: PAYPAL_ENV, id: eventId, type: evt.event_type }),
    ContentType: "application/json; charset=utf-8",
  }));
}

async function getOrder(orderID) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `orders/${orderID}.json` }));
    const buf = await r.Body.transformToByteArray();
    return JSON.parse(Buffer.from(buf).toString("utf8"));
  } catch { return null; }
}

async function putOrder(orderID, row) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: `orders/${orderID}.json`,
    Body: JSON.stringify(row),
    ContentType: "application/json; charset=utf-8",
  }));
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
    if (!BUCKET) return json(500, { error: "Missing S3_BUCKET_NAME" });

    // Raw body (handle base64)
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : (event.body || "");
    if (!rawBody) return json(400, { error: "Empty webhook body" });

    // 1) Verify signature with PayPal
    const ok = await verifySignature(rawBody, event.headers || {});
    if (!ok) {
      console.warn("[webhook] signature verification failed");
      return json(400, { error: "invalid signature" });
    }

    // 2) Parse payload and de-dupe on event.id (idempotency)
    const payload = JSON.parse(rawBody);
    const eventId = payload.id;
    if (!eventId) return json(400, { error: "missing event id" });

    if (await eventAlreadyProcessed(eventId)) {
      // Already handled—return 200 so PayPal stops retrying
      return json(200, { ok: true, duplicate: true });
    }

    // 3) Reconcile a minimal order snapshot (best-effort)
    const type = payload.event_type;
    const resource = payload.resource || {};
    const orderID =
      resource.id ||
      resource?.supplementary_data?.related_ids?.order_id ||
      resource?.purchase_units?.[0]?.reference_id ||
      null;

    if (orderID) {
      const prev = (await getOrder(orderID)) || { orderID, createdAt: Date.now() };
      const capture = (resource.payments?.captures?.[0]) || resource;
      const next = {
        ...prev,
        lastEvent: type,
        webhookSeen: Date.now(),
        status: resource.status || prev.status || undefined,
        captureId: capture?.id || prev.captureId || null,
      };
      await putOrder(orderID, next);
      console.log("Webhook reconciled order:", orderID, type);
    } else {
      console.warn("Webhook without resolvable orderID:", type);
    }

    // 4) Mark this event id as processed (idempotency)
    await markEventProcessed(eventId, payload);

    // 5) Always 200 after successful verification/processing
    return json(200, { ok: true });
  } catch (e) {
    console.error("Webhook error:", e);
    // Non-200 will cause PayPal to retry; that’s fine if verification/processing failed
    return json(500, { error: "server error" });
  }
};
