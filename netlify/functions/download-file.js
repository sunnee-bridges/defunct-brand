// netlify/functions/download-file.js
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

/* ---------- Config ---------- */
const REGION        = process.env.S3_REGION || process.env.AWS_REGION || "us-east-1";
const BUCKET        = process.env.S3_BUCKET_NAME;                         // required
const CSV_FALLBACK  = process.env.CSV_OBJECT_KEY || "exports/brands-latest.csv";
const MANIFEST_KEY  = process.env.S3_MANIFEST_KEY || "exports/manifest.json";
const DOWNLOAD_TTL  = Number(process.env.DOWNLOAD_TTL_SECONDS || 900);    // 15m
const MAX_USES      = Number(process.env.MAX_TOKEN_USES || 3);

/* ---------- S3 ---------- */
const s3 = new S3Client({
  region: REGION,
  credentials: (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY)
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined, // use default provider chain on Netlify if present
});

function streamToString(stream) {
  return new Promise((res, rej) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", rej);
  });
}

async function readJSON(Bucket, Key) {
  const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
  return JSON.parse(await streamToString(r.Body));
}

async function writeJSON(Bucket, Key, data) {
  await s3.send(new PutObjectCommand({
    Bucket,
    Key,
    Body: JSON.stringify(data),
    ContentType: "application/json; charset=utf-8",
  }));
}

/* ---------- Helpers ---------- */
const json = (status, body) => ({
  statusCode: status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  },
  body: JSON.stringify(body),
});

function isValidUUID(t) {
  return typeof t === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" } };
    if (!BUCKET) return json(500, { error: "Server not configured." });

    // token from path via redirect rule: /download/:token -> ...?token=:token
    const token = event.queryStringParameters?.token || "";
    if (!isValidUUID(token)) return json(400, { error: "Invalid token format" });

    // 1) Load token record
    const tokenKey = `tokens/${token}.json`;
    let record;
    try {
      record = await readJSON(BUCKET, tokenKey);
    } catch {
      return json(404, { error: "Token not found or invalid" });
    }

    // 2) Expiry
    const now = Date.now();
    const expiresAt = Number(record.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || now > (expiresAt + 5000)) {
      return json(410, { error: "Token expired" });
    }

    // 3) Usage limit
    const current = record.useCount || 0;
    if (current >= MAX_USES) {
      return json(429, {
        error: "Download limit reached",
        uses: current,
        maxUses: MAX_USES,
      });
    }

    // 4) Increment and persist usage (best-effort)
    const next = current + 1;
    record.useCount = next;
    record.lastUsedAt = now;
    if (!record.usedAt) record.usedAt = now;
    try {
      await writeJSON(BUCKET, tokenKey, record);
    } catch {
      // non-fatal; continue
    }

    // 5) Which CSV?
    let Key = record.key || CSV_FALLBACK;
    if (!Key) {
      try {
        const manifest = await readJSON(BUCKET, MANIFEST_KEY);
        if (manifest && typeof manifest.latest === "string") Key = manifest.latest;
      } catch {}
    }
    if (!Key) return json(500, { error: "File not configured" });

    // 6) Presign and redirect
    const cmd = new GetObjectCommand({
      Bucket: BUCKET,
      Key,
      ResponseContentDisposition: 'attachment; filename="vanished-brands.csv"',
      ResponseContentType: "text/csv; charset=utf-8",
    });
    const url = await getSignedUrl(s3, cmd, { expiresIn: DOWNLOAD_TTL });

    // Optional: add a tiny hint when it’s the last allowed download
    const isLast = next >= MAX_USES;

    return {
      statusCode: 302,
      headers: {
        Location: url,
        "Cache-Control": "no-store",
        // Lightweight, privacy-safe signal headers (optional)
        "X-Download-Uses": String(next),
        "X-Download-Max": String(MAX_USES),
        "X-Download-Last": isLast ? "true" : "false",
      },
      body: "",
    };
  } catch (e) {
    console.error("[download-file] Error:", e?.message || e);
    return json(500, { error: "Internal server error" });
  }
};
