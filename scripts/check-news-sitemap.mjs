// check-news-sitemap.mjs — prove the news-sitemap logic emits valid XML.
// Mirrors the exact generation block from site/build.js with sample data,
// because lib/ and data/ are not present in the public repo to run a full build.
const PUBLIC_BASE = "https://news.bharatdn.com";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const articleHref = (a) => `article/${a.date}/${a.headline.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

const allPublished = [
  { headline: "Fresh & bold: today's top story", date: new Date().toISOString().slice(0, 10), published: true },
  { headline: "Yesterday's story", date: new Date(Date.now() - 864e5).toISOString().slice(0, 10), published: true },
  { headline: "Three days old — must be dropped", date: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10), published: true },
  { headline: null, date: "2026-10-01", published: true },
];

const newsCutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
const recent = allPublished
  .filter((a) => a.headline && a.date)
  .filter((a) => new Date(`${a.date}T00:00:00Z`) >= newsCutoff)
  .slice(0, 1000);

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${recent
  .map(
    (a) => `  <url><loc>${PUBLIC_BASE}/${articleHref(a)}</loc>
    <news:news><news:publication><news:name>The Daily Prompt</news:name><news:language>en</news:language></news:publication>
    <news:publication_date>${new Date(`${a.date}T08:00:00+05:30`).toISOString()}</news:publication_date>
    <news:title>${esc(a.headline)}</news:title></news:news></url>`
  )
  .join("\n")}
</urlset>`;

console.log(xml);
console.log("\n--- checks ---");
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
console.log("urls in window:", locs.length, "(expect 2 — the 3-day-old one dropped)");
console.log("has news namespace:", xml.includes('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"'));
console.log("publication_date ISO8601:", /<news:publication_date>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z<\/news:publication_date>/.test(xml));
console.log("ampersand escaped in title:", xml.includes("Fresh &amp; bold"));
console.log("no raw & outside entity:", !/<news:title>[^<]*&(?!amp;)/.test(xml));
const bad = locs.filter((u) => !u.startsWith(PUBLIC_BASE + "/article/"));
console.log("all locs absolute + article path:", bad.length === 0, bad);