// scripts/process-images.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const ex = promisify(execFile);

// Adjust if you store originals elsewhere
const IN  = "assets/articles";
const OUT = "public/images/articles";

// Variants you want to emit (name, width×height, crop = ^ + extent)
const VARIANTS = [
  { dir: "hero",  size: "2000x1200" }, // article header
  { dir: "card",  size: "800x500"   }, // blog index card
  { dir: "thumb", size: "400x400"   }, // square thumb
  { dir: "og",    size: "1200x630"  }, // social share
];

await Promise.all(VARIANTS.map(v => mkdir(path.join(OUT, v.dir), { recursive: true })));

const files = (await readdir(IN)).filter(f => /\.(jpe?g|png)$/i.test(f));

for (const f of files) {
  const src  = path.join(IN, f);
  const base = f.replace(/\.[^.]+$/, ""); // filename without extension

  for (const v of VARIANTS) {
    const dst = path.join(OUT, v.dir, `${base}.webp`);
    // Center-crop to exact size, strip metadata, sensible quality
    await ex("magick", [
      src,
      "-resize", `${v.size}^`,
      "-gravity", "center",
      "-extent",  v.size,
      "-strip",
      "-quality", "82",
      dst,
    ]);
    console.log("Built", dst);
  }
}

console.log("✅ Images processed.");
