// src/pages/data/download.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SECRET = process.env.DATA_DOWNLOAD_SECRET || "change-me";
const DATA_DIR = path.join(process.cwd(), "public", "data");

// Verify compact token: base64url(payload).base64url(sig)
// payload is JSON: { e: email, v: version, x: epochSeconds }
function verifyToken(t: string) {
  try {
    const [p64, s64] = t.split(".");
    if (!p64 || !s64) return null;
    const payload = JSON.parse(Buffer.from(p64, "base64url").toString("utf8"));
    const h = crypto.createHmac("sha256", SECRET).update(p64).digest("base64url");
    if (h !== s64) return null;
    if (typeof payload.x !== "number" || Date.now()/1000 > payload.x) return null; // expired
    return payload as { e: string; v: string; x: number };
  } catch { return null; }
}

// Append buyer watermark row + README note
function watermarkCsv(csv: string, email: string, version: string) {
  const stamp = new Date().toISOString();
  const fp = crypto.createHash("sha1").update(`${email}.${version}.${stamp}`).digest("hex").slice(0,10);
  const lines = csv.trimEnd().split(/\r?\n/);
  // ensure header has our metadata columns; if not, add
  if (!/dataset_version/i.test(lines[0])) {
    lines[0] += ",last_updated,dataset_version";
    const today = new Date().toISOString().slice(0,10);
    for (let i=1;i<lines.length;i++) lines[i] += `,${today},${version}`;
  }
  lines.push(`__WATERMARK__,,,,,,,,,,${stamp},${version},"${email.replace(/"/g,'""')}","${fp}"`);
  return lines.join("\n") + "\n";
}

export async function GET({ request }: { request: Request }) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    const payload = verifyToken(token);
    if (!payload) return new Response("Invalid or expired link", { status: 401 });

    const csvPath = path.join(DATA_DIR, `brands-${payload.v}.csv`);
    if (!fs.existsSync(csvPath)) return new Response("Dataset not found", { status: 404 });

    const raw = fs.readFileSync(csvPath, "utf8");
    const stamped = watermarkCsv(raw, payload.e, payload.v);

    return new Response(stamped, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="brands-${payload.v}.csv"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (e) {
    return new Response("Server error", { status: 500 });
  }
}
