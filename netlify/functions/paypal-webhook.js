// netlify/functions/paypal-webhook.js
// Verifies PayPal webhooks and writes a small reconciliation note to S3 orders/<orderID>.json

const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");

// ---- Config / helpers ----
const PAYPAL_ENV = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
const BASE = PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY)
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined,
});
const BUCKET = process.env.S3_BUCKET_NAME;

// Read a Node stream to string
function streamToString(stream) {
  return new Promise((res, rej) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", rej);
  });
}

async function getOrder(orderID) {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `orders/${orderID}.json` }));
    const text = await streamToString(r.Body);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function putOrder(orderID, row) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: `orders/${orderID}.json`,
    Body: JSON.stringify(row),
    ContentType: "application/json; charset=utf-8",
  }));
}

async function getAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
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

function json(status, body) {
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// ---- Netlify handler ----
exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
    if (!WEBHOOK_ID) return json(500, { error: "Missing PAYPAL_WEBHOOK_ID" });
    if (!BUCKET) return json(500, { error: "Missing S3_BUCKET_NAME" });

    // PayPal sends lowercase headers via Netlify
    const h = event.headers || {};
    const body = event.body ? JSON.parse(event.body) : null;
    if (!body) return json(400, { error: "Empty webhook body" });

    // Verify signature with PayPal
    const access = await getAccessToken();
    const verifyRes = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        auth_algo: h["paypal-auth-algo"],
        cert_url: h["paypal-cert-url"],
        transmission_id: h["paypal-transmission-id"],
        transmission_sig: h["paypal-transmission-sig"],
        transmission_time: h["paypal-transmission-time"],
        webhook_id: WEBHOOK_ID,
        webhook_event: body,
      }),
    });
    const verify = await verifyRes.json();

    // Log verification to function logs
    console.log("Webhook verify:", verify.verification_status, body.event_type);

    if (verify.verification_status !== "SUCCESS") {
      return json(400, { error: "Bad signature", detail: verify });
    }

    // Reconcile minimal order info (best-effort)
    const eventType = body.event_type;
    // order id can live in different places depending on event
    const orderID =
      body.resource?.id ||
      body.resource?.supplementary_data?.related_ids?.order_id ||
      body.resource?.purchase_units?.[0]?.payments?.captures?.[0]?.supplementary_data?.related_ids?.order_id ||
      null;

    if (orderID) {
      const prev = (await getOrder(orderID)) || { orderID, createdAt: Date.now() };
      const next = {
        ...prev,
        lastEvent: eventType,
        webhookSeen: Date.now(),
        // capture helpful breadcrumbs; avoid huge payloads
        captureId: body.resource?.id || prev.captureId || null,
        status: body.resource?.status || prev.status || undefined,
      };
      await putOrder(orderID, next);
      console.log("Webhook reconciled order:", orderID, eventType);
    } else {
      console.warn("Webhook without resolvable orderID:", body.event_type);
    }

    return json(200, { ok: true });
  } catch (e) {
    console.error("Webhook error:", e);
    return json(500, { error: String(e?.message || e) });
  }
};
