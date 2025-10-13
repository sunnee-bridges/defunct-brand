// netlify/functions/brands-get.js
const path = require("node:path");
const fs = require("node:fs/promises");

exports.handler = async (event) => {
  try {
    const slug = (event.queryStringParameters && event.queryStringParameters.slug) || "";
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return json(400, { error: "valid slug required" });
    }
    const file = path.join(process.cwd(), "content", "brands", `${slug}.public.json`);
    const raw = await fs.readFile(file, "utf8");
    const data = JSON.parse(raw);

    // Only expose public fields
    const out = {
      brand: data.brand,
      slug: data.slug,
      category: data.category,
      country: data.country,
      active: data.active,
      fate: data.fate ?? null,
      summary: data.summary ?? "",
      notable_products: Array.isArray(data.notable_products) ? data.notable_products : [],
      links: { wikipedia: data?.links?.wikipedia ?? null }
    };

    return json(200, out);
  } catch (e) {
    // If file missing or bad JSON, return 404
    return json(404, { error: "Brand not found" });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}
