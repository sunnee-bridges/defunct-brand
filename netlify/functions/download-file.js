// netlify/functions/download-file.js
const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

/* ---------- Config ---------- */
const REGION        = process.env.S3_REGION || "us-east-1";
const BUCKET        = process.env.S3_BUCKET_NAME;
const MANIFEST_KEY  = process.env.S3_MANIFEST_KEY || "exports/manifest.json";
const CSV_FALLBACK  = process.env.CSV_OBJECT_KEY || "exports/brands-latest.csv";
const DOWNLOAD_TTL  = Number(process.env.DOWNLOAD_TTL_SECONDS || 900);
const MAX_USES      = Number(process.env.MAX_TOKEN_USES || 3);

/* ---------- Utils ---------- */
const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
});
const json = (s, b) => ({ statusCode: s, headers: cors(), body: JSON.stringify(b) });

const isUUID = (t) =>
  typeof t === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);

function extractToken(event) {
  // 1) query string
  let t = event?.queryStringParameters?.token;
  if (t) return t;

  // 2) path /download/<uuid>
  const path = event?.path || "";
  let m = path.match(/\/download\/([0-9a-f-]{36})(?:$|[/?#])/i);
  if (m && m[1]) return m[1];

  // 3) rawUrl (some frameworks)
  const raw = event?.rawUrl || "";
  m = raw.match(/\/download\/([0-9a-f-]{36})(?:$|[/?#])/i);
  if (m && m[1]) return m[1];

  // 4) POST body fallback
  try {
    const body = JSON.parse(event?.body || "{}");
    if (body?.token) return body.token;
  } catch {}

  return null;
}

/* ---------- S3 ---------- */
const s3 = new S3Client({
  region: REGION,
  credentials: (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY)
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined,
});

function streamToString(stream) {
  return new Promise((res, rej) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(Buffer.from(c)));
    stream.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", rej);
  });
}
async function readJSON({ Bucket, Key }) {
  const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
  return JSON.parse(await streamToString(r.Body));
}
async function writeJSON({ Bucket, Key, data }) {
  await s3.send(new PutObjectCommand({
    Bucket, Key,
    Body: JSON.stringify(data),
    ContentType: "application/json; charset=utf-8",
  }));
}

/* ---------- Handler ---------- */
exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") return json(204, {});
    if (!BUCKET) return json(500, { error: "Server not configured." });

    // Accept GET (via redirect) and POST (JSON flow)
    if (!["GET", "POST"].includes(event.httpMethod)) {
      return json(405, { error: "Method not allowed" });
    }

    // --- get token from query/path/body ---
    const token = extractToken(event);
    if (!isUUID(token)) {
      return json(400, { error: "Invalid token format" });
    }

    // --- load token record ---
    const tokenKey = `tokens/${token}.json`;
    let record;
    try {
      record = await readJSON({ Bucket: BUCKET, Key: tokenKey });
    } catch {
      return json(404, { error: "Token not found or invalid" });
    }

    // --- expiry ---
    const now = Date.now();
    const expiresAt = Number(record.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || now > (expiresAt + 5000)) {
      return json(410, { error: "Token expired" });
    }

    // --- usage limit ---
    const count = record.useCount || 0;
    if (count >= MAX_USES) {
      return json(429, {
        error: "Download limit reached",
        uses: count,
        maxUses: MAX_USES,
      });
    }

    // --- increment & persist ---
    record.useCount = count + 1;
    record.usedAt ??= now;
    record.lastUsedAt = now;
    try { await writeJSON({ Bucket: BUCKET, Key: tokenKey, data: record }); } catch {}

    // --- resolve file key ---
    let Key = record.key || CSV_FALLBACK;
    if (!Key) {
      try {
        const manifest = await readJSON({ Bucket: BUCKET, Key: MANIFEST_KEY });
        if (manifest?.latest) Key = manifest.latest;
      } catch {}
    }
    if (!Key) return json(500, { error: "File not configured." });

    // --- sign & respond ---
    const cmd = new GetObjectCommand({
      Bucket: BUCKET,
      Key,
      ResponseContentDisposition: 'attachment; filename="vanished-brands.csv"',
      ResponseContentType: "text/csv; charset=utf-8",
    });
    const url = await getSignedUrl(s3, cmd, { expiresIn: DOWNLOAD_TTL });

    // For GET requests, you can 302 redirect so it downloads immediately.
    if (event.httpMethod === "GET") {
      return {
        statusCode: 302,
        headers: { Location: url, "Cache-Control": "no-store" },
        body: "",
      };
    }

    // For POST (JSON flow), return the URL
    return json(200, { url, uses: record.useCount, maxUses: MAX_USES, last: record.useCount >= MAX_USES });
  } catch (e) {
    console.error("[download-file] Error:", e?.message || e);
    return json(500, { error: "Internal server error" });
  }
};
