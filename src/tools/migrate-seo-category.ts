// tools/migrate-seo-category.ts
import fs from "node:fs";
import path from "node:path";

const map: Record<string,string> = {
  "Retail": "retail",
  "Retail/Entertainment": "retail-entertainment",
  "Food & Beverage": "food-beverage",
  "Food/CPG": "food-beverage",
  "Food/Breakfast cereal": "food-beverage",
  "Beverages/Soft Drinks": "food-beverage",
  "Beverages/Non-alcoholic": "food-beverage",
  "Beverages/Alcohol": "alcoholic-beverages",
  "Consumer electronics": "consumer-electronics",
  "Computers": "computers-hardware",
  "Mobile devices": "mobile-wearables",
  "Wearables": "mobile-wearables",
  "Software/Internet": "software-internet",
  "E-commerce": "software-internet",
  "Video game consoles": "video-games-consoles",
  "Video games": "video-games-consoles",
  "Airline": "airlines-aviation",
  "Automotive": "automotive",
  "Finance/Cryptocurrency": "finance-payments",
  "Finance/Payments": "finance-payments",
  "Healthcare/Diagnostics": "healthcare-diagnostics",
  "Retail/Photography": "retail",
  "Retail/Home Goods": "retail",
  "Beverage/Promotions": "food-beverage"
};

const dir = path.resolve("src/content/brands");
for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith(".json")) continue;
  const p = path.join(dir, file);
  const data = JSON.parse(fs.readFileSync(p, "utf8"));

  if (!data.seo_category) {
    const raw = String(data.category || "").trim();
    const normalized = map[raw] || map[raw.replace(/[-–—]/g,"-")] || null;
    if (normalized) {
      data.seo_category = normalized;
      fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
      console.log("Updated", file, "→", normalized);
    } else {
      console.warn("Unmapped category:", raw, "in", file);
    }
  }
}
