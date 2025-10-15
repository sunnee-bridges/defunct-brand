// netlify/functions/download-link.js
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// --- best-effort in-memory rate limit (per process) ---
const buckets = new Map(); // { ip -> { count, ts } }
const LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 20);           // requests per window
const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000); // window length (ms)

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

// --- S3 client ---
const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
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

exports.handler = async (event) => {
  if (tooMany(event)) return tooManyResp();

  try {
    if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
    const { token } = JSON.parse(event.body || "{}");
    if (!token) return json(400, { error: "token required" });

    const Bucket = process.env.S3_BUCKET_NAME;
    const tokenKey = `tokens/${token}.json`;

    const r = await s3.send(new GetObjectCommand({ Bucket, Key: tokenKey }));
    const record = JSON.parse(await streamToString(r.Body));

    if (Date.now() > record.expiresAt) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: tokenKey }));
      return json(410, { error: "token expired" });
    }

    // single-use: delete token immediately
    // (If you want to keep tokens during testing, set KEEP_TOKENS=1 and guard this delete.)
    if (process.env.KEEP_TOKENS !== "1") {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: tokenKey }));
    }

    const Key = record.key || process.env.CSV_OBJECT_KEY;
    const cmd = new GetObjectCommand({
      Bucket, Key,
      ResponseContentDisposition: 'attachment; filename="vanished-brands.csv"',
      ResponseContentType: "text/csv; charset=utf-8",
    });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 15 });

    return json(200, { url });
  } catch (e) {
    return json(500, { error: String(e?.message || e) });
  }
};

function json(status, body){
  return { statusCode: status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}
