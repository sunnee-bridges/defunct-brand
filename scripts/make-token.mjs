import crypto from "node:crypto";

const SECRET = process.env.DATA_DOWNLOAD_SECRET || "change-me";
const email = process.argv[2] || "buyer@example.com";
const version = process.argv[3] || new Date().toISOString().slice(0,10).replace(/-/g,""); // YYYYMMDD
const ttlMinutes = +(process.argv[4] || 60); // link valid for 60 minutes

const payload = {
  e: email,
  v: version,
  x: Math.floor(Date.now()/1000) + ttlMinutes*60
};
const p64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
const sig = crypto.createHmac("sha256", SECRET).update(p64).digest("base64url");
const token = `${p64}.${sig}`;
console.log(`/data/download?token=${token}`);
