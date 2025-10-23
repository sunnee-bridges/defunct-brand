// netlify/functions/paypal-create-order.js

const PAYPAL_ENV = (process.env.PUBLIC_PAYPAL_ENV || process.env.PAYPAL_ENV || "sandbox").toLowerCase();
const BASE = PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

/* ---------- Pricing (server-authoritative) ----------
 * PRICE_USD controls what PayPal shows.
 * If not set:
 *   - sandbox defaults to 0.01 (cheap testing)
 *   - live    defaults to 9.00
 * Optional: PRICE_CURRENCY (defaults to USD)
 */
const DEFAULT_PRICE = PAYPAL_ENV === "live" ? "9.00" : "0.01";
const RAW_PRICE = (process.env.PRICE_USD || DEFAULT_PRICE).trim();
const PRICE = normalizePrice(RAW_PRICE);            // always "x.xx"
const CURRENCY = (process.env.PRICE_CURRENCY || "USD").trim().toUpperCase();

/* ---------- Tiny throttle (best-effort per process) ---------- */
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

const json = (status, body) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

function getOrigin(event) {
  const h = event.headers || {};
  const proto = (h["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host  = (h["x-forwarded-host"]  || h["host"] || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

/* ---------- PayPal helper ---------- */
async function getAccessToken() {
  const id  = process.env.PAYPAL_CLIENT_ID;
  const sec = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !sec) throw new Error("Missing PayPal credentials");
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
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

/* ---------- Price normalizer / guardrails ---------- */
function normalizePrice(v) {
  // accept "1", "1.5", "1.50", "  0.01  "
  let n = Number(String(v).trim());
  if (!Number.isFinite(n)) n = Number(DEFAULT_PRICE);
  // Enforce 0.01 minimum (PayPal requires positive amounts)
  if (n < 0.01) n = 0.01;
  return n.toFixed(2);
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  try {
    if (tooMany(event)) return json(429, { error: "Too many requests. Try again shortly." });

    // Accept GET or POST
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const origin    = getOrigin(event);
    const returnUrl = `${origin}/buy`;   // after approval (we use JS capture, but keep these as a fallback)
    const cancelUrl = `${origin}/data`;  // if user cancels

    // Build the purchase units from our server-side price
    const purchase_units = [{
      amount: { currency_code: CURRENCY, value: PRICE },
      description: "Vanished Brands CSV",
    }];

    const access = await getAccessToken();
    const r = await fetch(`${BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${access}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units,
        application_context: {
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          brand_name: "Vanished Brands",
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.id) {
      console.error("[create-order] non-OK", r.status, data);
      return json(502, { error: "create order failed" });
    }

    // Include price/currency/env in the response for easy debugging from the browser
    return json(200, {
      id: data.id,
      price: PRICE,
      currency: CURRENCY,
      env: PAYPAL_ENV,
    });
  } catch (e) {
    console.error("[create-order] error", e);
    return json(500, { error: String(e?.message || e) });
  }
};
