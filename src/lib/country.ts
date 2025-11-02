export const COUNTRY_LABEL: Record<string, string> = {
  BS: "Bahamas",
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  DE: "Germany",
  FR: "France",
  // add as needed…
};

export const countryLabel = (code?: string) =>
  COUNTRY_LABEL[String(code || "").toUpperCase()] || code || "";
