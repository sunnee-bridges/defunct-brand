// netlify/functions/paypal-create-order.js
const PAYPAL_ENV = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
const BASE = PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

/* ------------ tiny helpers ------------ */
function json(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function getOrigin(event) {
  // Prefer explicit base if provided (useful on Netlify previews/custom domains)
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");

  const h = event.headers || {};
  const proto = (h["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host  = (h["x-forwarded-host"]  || h["host"] || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

/* ------------ best-effort rate limit ------------ */
const buckets = new Map(); // ip -> {count, ts}
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
const tooManyResp = () =>
  json(429, { error: "Too many requests. Try again shortly." });

/* ------------ PayPal OAuth ------------ */
async function getAccessToken() {
  const id  = process.env.PAYPAL_CLIENT_ID;
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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal token error ${res.status}: ${text}`);
  }
  const j = await res.json();
  return j.access_token;
}

/* ------------ Handler ------------ */
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    // (Optional) quick CORS preflight ok if you ever call cross-origin
    return {
      statusCode: 204,
      headers: { "Access-Control-Allow-Methods": "POST, OPTIONS" },
    };
  }
  if (tooMany(event)) return tooManyResp();
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  try {
    // derive base URLs
    const origin    = getOrigin(event);
    const returnUrl = `${origin}/buy`;   // where PayPal returns after approval
    const cancelUrl = `${origin}/data`;  // where PayPal returns if buyer cancels

    // price/currency/brand from env (change in Netlify UI without code edits)
    const PRICE   = (process.env.PRICE_USD || process.env.PAYPAL_PRICE || "9.00").trim();
    const CURRENCY = (process.env.PAYPAL_CURRENCY || "USD").trim().toUpperCase();
    const BRAND    = process.env.SITE_BRAND_NAME || "Vanished Brands";

    // Optional: metadata from client (e.g., source, plan) — no security reliance
    let meta = {};
    try { meta = JSON.parse(event.body || "{}") || {}; } catch {}
    const referenceId = meta.reference_id || "vb-csv";
    const description = meta.description || "Vanished Brands CSV";

    // OAuth
    const access = await getAccessToken();

    // Create order
    const r = await fetch(`${BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: referenceId,
            description,
            amount: { currency_code: CURRENCY, value: PRICE },
          },
        ],
        application_context: {
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          brand_name: BRAND,
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      // surface PayPal error payload for easier debugging
      return json(502, { error: "paypal_create_failed", status: r.status, details: data });
    }

    // Minimal response: the order ID for the client to approve
    return json(200, { id: data.id });
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
};
