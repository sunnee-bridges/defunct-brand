export const slugify = (s = "") =>
  s.toLowerCase()
   .replace(/&/g, " and ")
   .replace(/[/]+/g, " ")          // "Retail/Entertainment" -> "Retail Entertainment"
   .replace(/[^a-z0-9]+/g, "-")    // non-alphanum -> hyphen
   .replace(/(^-|-$)/g, "")        // trim ends
   .replace(/--+/g, "-");          // collapse
