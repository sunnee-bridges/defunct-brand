// netlify/functions/paypal-create-order.js

const PAYPAL_ENV = (process.env.PAYPAL_ENV || "sandbox").toLowerCase();
const BASE = PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

// --- best-effort in-memory rate limit (per process) ---
const buckets = new Map(); // { ip -> { count, ts } }
const LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 20);       // requests per window
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000); // window length

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

// --- Handler ---
exports.handler = async (event) => {
  if (tooMany(event)) return tooManyResp();

  try {
    const access = await getAccessToken();

    // set your price here
    const purchase_units = [{
      amount: { currency_code: "USD", value: "9.00" },
      description: "Vanished Brands CSV",
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
        },
      }),
    });

    const data = await r.json();
    if (!r.ok) return json(500, { error: data });
    return json(200, { id: data.id });
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
};

function json(status, body) {
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
