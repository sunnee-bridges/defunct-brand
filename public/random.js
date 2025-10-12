(() => {
  let slugs = null;

  async function ensureSlugs() {
    if (Array.isArray(slugs) && slugs.length) return slugs;
    try {
      const r = await fetch("/brand-slugs.json", { cache: "force-cache" });
      if (r.ok) {
        const arr = await r.json();
        if (Array.isArray(arr) && arr.length) {
          slugs = arr;
          return slugs;
        }
      }
    } catch {}
    // Fallback: read inline data (if the layout provided it)
    const inline = document.getElementById("brand-slugs-inline");
    if (inline?.textContent) {
      try {
        const arr = JSON.parse(inline.textContent);
        if (Array.isArray(arr) && arr.length) {
          slugs = arr;
          return slugs;
        }
      } catch {}
    }
    slugs = [];
    return slugs;
  }

  async function goRandom(e) {
    e?.preventDefault?.();
    const list = await ensureSlugs();
    if (!list.length) return;
    const pick = list[Math.floor(Math.random() * list.length)];
    location.assign(`/brand/${pick}/`);
  }

  // Delegate to any element with [data-random]
  document.addEventListener("click", (ev) => {
    const t = ev.target?.closest?.("[data-random]");
    if (t) goRandom(ev);
  });

  // Optional: expose for console testing
  window.__goRandomBrand = goRandom;
})();
