// netlify/functions/admin-remint-token.js
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("node:crypto");

/* ------------ Config ------------ */
const REGION       = process.env.S3_REGION || process.env.AWS_REGION || "us-east-1";
const BUCKET       = process.env.S3_BUCKET_NAME;
const CSV_FALLBACK = process.env.CSV_OBJECT_KEY || "exports/brands-latest.csv";
const MANIFEST_KEY = process.env.S3_MANIFEST_KEY || "exports/manifest.json";

const DEFAULT_TTL_HOURS = Number(process.env.REMINT_TTL_HOURS || 24);
const MAX_USES          = Number(process.env.MAX_TOKEN_USES || 3);

const ADMIN_SECRET = process.env.ADMIN_REMINT_SECRET; // required

/* ------------ S3 client ------------ */
const s3 = new S3Client({
  region: REGION,
  credentials: (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY)
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined,
});

/* ------------ helpers ------------ */
function corsHeaders() {
  // keep this private; only your curl / admin panel should call it
  return {
    "Access-Control-Allow-Origin": "https://vanishedbrands.com", // tighten as needed
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Admin-Secret",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };
}
const json = (status, body) => ({ statusCode: status, headers: corsHeaders(), body: JSON.stringify(body) });

function streamToString(stream) {
  return new Promise((res, rej) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", rej);
  });
}

async function readJSON(Key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key }));
  return JSON.parse(await streamToString(r.Body));
}

async function writeJSON(Key, data) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key,
    Body: JSON.stringify(data),
    ContentType: "application/json; charset=utf-8",
  }));
}

/** Resolve CSV key: order record may not include a `key`, so use fallback or manifest.latest */
async function resolveCsvKey() {
  if (CSV_FALLBACK) return CSV_FALLBACK;
  try {
    const manifest = await readJSON(MANIFEST_KEY);
    if (manifest && typeof manifest.latest === "string") return manifest.latest;
  } catch {}
  return "exports/brands-latest.csv";
}

/* ------------ handler ------------ */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(204, {});
    if (event.httpMethod !== "POST")   return json(405, { error: "POST only" });

    if (!BUCKET)       return json(500, { error: "Server missing S3_BUCKET_NAME" });
    if (!ADMIN_SECRET) return json(500, { error: "Server missing ADMIN_REMINT_SECRET" });

    // Auth: require header
    const hdr = event.headers || {};
    const provided = hdr["x-admin-secret"] || hdr["X-Admin-Secret"] || hdr["x-admin-secret".toLowerCase()];
    if (provided !== ADMIN_SECRET) return json(401, { error: "Unauthorized" });

    // Input
    let body = {};
    try { body = JSON.parse(event.body || "{}"); } catch {}
    const orderID = (body.orderID || "").trim();
    const ttlHours = Number.isFinite(Number(body.ttlHours)) ? Number(body.ttlHours) : DEFAULT_TTL_HOURS;
    const maxUses  = Number.isFinite(Number(body.maxUses))  ? Number(body.maxUses)  : MAX_USES;

    if (!orderID) return json(400, { error: "orderID required" });

    // Load order
    const orderKey = `orders/${orderID}.json`;
    let order;
    try {
      order = await readJSON(orderKey);
    } catch (e) {
      return json(404, { error: "Order not found", orderID });
    }

    if (!order || (order.status !== "COMPLETED" && order.status !== "completed")) {
      return json(409, { error: "Order is not COMPLETED", status: order?.status || "UNKNOWN" });
    }

    // Determine which CSV to serve
    const csvKey = order.key || await resolveCsvKey();

    // Create a fresh token
    const token = crypto.randomUUID();
    const now   = Date.now();
    const record = {
      token,
      orderID,
      key: csvKey,
      createdAt: now,
      expiresAt: now + ttlHours * 60 * 60 * 1000,
      useCount: 0,
      maxUses,
      reason: "admin-remint",
    };

    await writeJSON(`tokens/${token}.json`, record);

    // (Optional) annotate order with lastRemintedAt / lastToken for audit
    try {
      const patched = {
        ...order,
        lastRemintedAt: now,
        lastToken: token,
      };
      await writeJSON(orderKey, patched);
    } catch { /* ignore audit failures */ }

    return json(200, { ok: true, token, expiresAt: new Date(record.expiresAt).toISOString(), maxUses, key: csvKey });
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
};
