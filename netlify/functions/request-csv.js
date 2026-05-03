// netlify/functions/request-csv.js
// Accepts a POST with { email }, mints a signed download token, sends it via Resend.
const crypto = require("crypto");

const SECRET   = process.env.DATA_DOWNLOAD_SECRET || "change-me";
const RESEND_KEY = process.env.RESEND_API_KEY || "";
const FROM     = process.env.RESEND_FROM || "data@vanishedbrands.com";
const SITE_URL = (process.env.SITE_URL || "https://vanishedbrands.com").replace(/\/$/, "");
const TTL_HOURS = 48;

function mintToken(email) {
  const x = Math.floor(Date.now() / 1000) + TTL_HOURS * 3600;
  const p = Buffer.from(JSON.stringify({ e: email, x })).toString("base64url");
  const s = crypto.createHmac("sha256", SECRET).update(p).digest("base64url");
  return `${p}.${s}`;
}

function validEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return resp(405, { error: "Method not allowed" });

  let email;
  try {
    email = String(JSON.parse(event.body || "{}").email || "").trim().toLowerCase();
  } catch {
    return resp(400, { error: "Invalid request body." });
  }

  if (!validEmail(email)) return resp(400, { error: "Please enter a valid email address." });
  if (!RESEND_KEY)        return resp(500, { error: "Email service not configured." });

  const token = mintToken(email);
  const downloadUrl = `${SITE_URL}/data/download?token=${encodeURIComponent(token)}`;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: FROM,
      to: email,
      subject: "Your Vanished Brands dataset download",
      html: `
        <p>Thanks for your interest in the Vanished Brands CSV dataset.</p>
        <p><a href="${downloadUrl}" style="font-weight:bold">Click here to download the full CSV</a></p>
        <p style="color:#6b7280;font-size:13px;">
          This link expires in ${TTL_HOURS} hours.<br>
          For commercial licensing, reply to this email.
        </p>
        <p style="color:#9ca3af;font-size:12px;">— Vanished Brands &middot; vanishedbrands.com</p>
      `,
      text: [
        "Thanks for your interest in the Vanished Brands CSV dataset.",
        "",
        `Download link (expires in ${TTL_HOURS} hours):`,
        downloadUrl,
        "",
        "For commercial licensing, reply to this email.",
        "— Vanished Brands · vanishedbrands.com"
      ].join("\n")
    })
  });

  if (!emailRes.ok) {
    const body = await emailRes.text().catch(() => "");
    console.error("Resend error:", emailRes.status, body);
    return resp(500, { error: "Failed to send email. Please try again." });
  }

  console.log(`[request-csv] link sent to ${email}`);
  return resp(200, { ok: true });
};

function resp(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}
