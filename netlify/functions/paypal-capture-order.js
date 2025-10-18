// netlify/functions/paypal-create-order.js
const PAYPAL_ENV = (process.env.PUBLIC_PAYPAL_ENV || process.env.PAYPAL_ENV || "sandbox").toLowerCase();
const BASE = PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

/* --- tiny throttle to avoid abuse --- */
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
const tooManyResp = () => json(429, { error: "Too many requests. Try again shortly." });

/* --- helpers --- */
const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

async function getAccessToken() {
  const id  = process.env.PAYPAL_CLIENT_ID;
  const sec = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !sec) throw new Error("Missing PayPal credentials");
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${id}:${sec}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!r.ok) throw new Error(`PayPal token error ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.access_token;
}

// derive return/cancel URLs from request
function getOrigin(event) {
  const h = event.headers || {};
  const proto = (h["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host  = (h["x-forwarded-host"]  || h["host"] || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

exports.handler = async (event) => {
  try {
    if (tooMany(event)) return tooManyResp();

    // Accept both GET and POST so PayPal or any prefetch doesn't 405.
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return json(200, { ok: true, ping: true }); // harmless fallback
    }

    const origin    = getOrigin(event);
    const returnUrl = `${origin}/buy`;   // after approval
    const cancelUrl = `${origin}/data`;  // if user cancels

    const access = await getAccessToken();

    // set your price + description here
    const purchase_units = [{
      amount: { currency_code: "USD", value: "9.00" },
      description: "Vanished Brands CSV"
    }];

    const r = await fetch(`${BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${access}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units,
        application_context: {
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          brand_name: "Vanished Brands",
          return_url: returnUrl,
          cancel_url: cancelUrl
        }
      })
    });

    const data = await r.json();
    if (!r.ok || !data?.id) return json(500, { error: data || "create order failed" });
    return json(200, { id: data.id });
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
};
