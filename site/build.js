// Static site builder -> site/dist/. Per-article pages, category pages,
// Reader-side translation, client-side search, hero front page, stats dashboard,
// staleness banner, social meta tags and an RSS feed.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readJson, loadGenomes, ROOT, BEATS, BEAT_GROUPS } from "../lib/store.js";
import { esc, slugify, articleHref } from "../lib/slug.js";

const DIST = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "site", "dist");
// "Modern Editorial" skin — single source of truth for all styling
const THEME_CSS = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "theme.css"), "utf8");
const THEME_COLOR = "#121214"; // matches dark-default skin (PWA + mobile chrome bar)
// Glass topbar shared by every page (nav tools + section pills)
const TOPBAR = `<div class="topbar"><div class="topbar-row">
    <a class="brand" href="/">The Daily <span>Prompt</span></a>
    <div class="tools">
      <a href="/search.html">Search</a>
      <a href="/archive.html">Archive</a>
      <a href="/wire.html">Wire</a>
      <a href="/stats.html">Stats</a>
      <a href="/feed.xml" title="RSS">RSS</a>
      <button id="tdp-theme" title="Toggle light/dark" aria-label="Toggle theme">Dark</button>
    </div>
  </div>
  <nav class="catrow">${catGrouped()}</nav></div>`;

// Grouped category nav: six labelled clusters (News | Money | Sports | Culture | Life | Tech)
// so all 17 desks stay scannable. Zero JS — plain links, crawlable.
function catGrouped() {
  return BEAT_GROUPS.map(
    (g) => `<span class="catgrp"><b>${esc(g.label)}</b>${g.beats.map((b) => `<a href="/category/${esc(b)}.html">${esc(b)}</a>`).join("")}</span>`
  ).join("");
}
const SITE_DIR = path.dirname(DIST);
const PUBLIC_BASE = process.env.SITE_BASE_URL || "https://daily-prompt-do3.pages.dev";
const CF_TOKEN = process.env.CF_ANALYTICS_TOKEN || ""; // Cloudflare Web Analytics (optional)

function analyticsSnippet() {
  // Cookieless, privacy-friendly; enabled only when CF_ANALYTICS_TOKEN is set.
  return CF_TOKEN
    ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${esc(CF_TOKEN)}"}'></script>`
    : "";
}

function confirmedBadge(a) {
  const n = a.confirmations || 1;
  if (n <= 1) return "";
  return `<span class="badge conf" title="Reported by ${esc((a.sources || []).join(", "))}">confirmed by ${n} sources</span>`;
}

function readTime(body = "") {
  return Math.max(1, Math.round(String(body).split(/\s+/).filter(Boolean).length / 200));
}

// Quick Bites: short items (≤90 words) get their own badge so small news is
// first-class, not hidden. Defined at module level so cards, pages, wire all agree.
const QUICK_MAX_WORDS = 90;
const isQuick = (a) => String(a.body || "").split(/\s+/).filter(Boolean).length <= QUICK_MAX_WORDS;

function articleCard(a, { link = false } = {}) {
  const badge =
    a.factGate === "pass"
      ? '<span class="badge ok">fact-checked</span>'
      : a.factGate === "flag"
        ? '<span class="badge bad">flagged</span>'
        : "";
  const headline = link
    ? `<h2><a href="${esc(articleHref(a))}">${esc(a.headline)}</a></h2>`
    : `<h2>${esc(a.headline)}</h2>`;
  return `<article class="story">
    <div class="meta">${esc(a.beat.toUpperCase())}${a.brief ? " BRIEF" : ""}${isQuick(a) ? '<span class="badge quick">quick bite</span>' : ""} · ${esc(a.source)} · editor ${a.editorScore ?? "-"}/10 · ${readTime(a.body)} min read ${badge}${confirmedBadge(a)}</div>
    ${headline}
    ${a.body.split("\n").filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("")}
    <p class="src">Source: <a href="${esc(a.sourceLink || a.link)}" rel="noopener">${esc(a.source)}</a> · <a href="${esc(articleHref(a))}">permalink</a> · <a href="/category/${esc(a.beat)}.html">more ${esc(a.beat)}</a></p>
  </article>`;
}

function heroCard(a) {
  return `<article class="story hero">
    <div class="meta">${esc(a.beat.toUpperCase())} · ${esc(a.source)} · editor ${a.editorScore ?? "-"}/10 ${a.factGate === "pass" ? '<span class="badge ok">fact-checked</span>' : ""}${confirmedBadge(a)}</div>
    <h2><a href="${esc(articleHref(a))}">${esc(a.headline)}</a></h2>
    <p class="lede">${esc(String(a.body).split("\n")[0].slice(0, 260))}…</p>
    <p class="src"><a href="${esc(articleHref(a))}">Read full story →</a></p>
  </article>`;
}

function articlePage(a, editionDate) {
  return page(
    `${a.headline} — The Daily Prompt`,
    `<p class="crumb"><a href="/">← Front page</a> · <a href="/archive.html">Archive</a> · <a href="/category/${esc(a.beat)}.html">${esc(a.beat)}</a></p>
     <article class="story single">
       <div class="meta">${esc(a.beat.toUpperCase())} · ${esc(a.source)} · ${esc(editionDate)} · editor ${a.editorScore ?? "-"}/10 · ${readTime(a.body)} min read ${a.factGate === "pass" ? '<span class="badge ok">fact-checked</span>' : ""}${isQuick(a) ? '<span class="badge quick">quick bite</span>' : ""}${confirmedBadge(a)}</div>
       <h1>${esc(a.headline)}</h1>
       ${a.tags?.length ? `<div class="tags">${a.tags.map((t) => `<span>#${esc(t)}</span>`).join(" ")}</div>` : ""}
       ${a.body.split("\n").filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("")}
       ${a.editorCritique ? `<p class="critique">Editor's note: ${esc(a.editorCritique)}</p>` : ""}
       <p class="src">This article is AI-generated and fact-gated. Original reporting: <a href="${esc(a.sourceLink || a.link)}" rel="noopener">${esc(a.source)}</a></p>
       <div class="sharebar" data-href="${esc(articleHref(a))}" data-title="${esc(a.headline)}"><b>Share:</b>
         <a class="sh-wa" target="_blank" rel="noopener">WhatsApp</a> ·
         <a class="sh-tg" target="_blank" rel="noopener">Telegram</a> ·
         <a class="sh-x" target="_blank" rel="noopener">X</a> ·
         <a href="#" class="sh-copy">Copy link</a> ·
         <a href="#" class="sh-save" data-id="${esc(articleHref(a))}">Save for later</a>
       </div>`,
    {
      description: String(a.body || "").slice(0, 150),
      permalink: articleHref(a),
      ogImage: a.ogCard || "/og/home.png",
      jsonLd: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        headline: a.headline,
        description: String(a.body || "").slice(0, 200),
        datePublished: a.date,
        image: [ogUrl(a.ogCard || "/og/home.png")],
        author: { "@type": "Organization", name: "The Daily Prompt AI Newsroom" },
        publisher: { "@type": "Organization", name: "The Daily Prompt" },
        isBasedOn: a.sourceLink || a.link,
        articleSection: a.beat,
        url: `${PUBLIC_BASE}/${articleHref(a)}`,
      }),
    }
  );
}

function leaderboard(genomes) {
  return Object.values(genomes)
    .map((g) => {
      const h = g.scoreHistory || [];
      const avg = h.length ? (h.reduce((s, x) => s + x.score, 0) / h.length).toFixed(1) : "-";
      const exp = g.experiment?.challenger ? " · A/B running" : "";
      return `<tr><td>${esc(g.beat)}</td><td>v${g.version}</td><td>${avg}</td><td>${h.length} editions${exp}</td></tr>`;
    })
    .join("");
}

async function readerTelemetryRows() {
  // Live first-party reader counts (aggregated only, no per-visitor data exists).
  try {
    const admin = process.env.PUSH_ADMIN_KEY || "";
    if (!admin) return "";
    const r = await fetch(`${PUBLIC_BASE}/api/analytics/summary?admin=${encodeURIComponent(admin)}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return "";
    const d = await r.json();
    if (!d.ok) return "";
    const top = (d.top || []).map(([p, n]) => `<tr><td>${esc(p)}</td><td>${n} views</td></tr>`).join("");
    const refRows = (d.referrers || []).map(([h, n]) => `<tr><td>${esc(h)}</td><td>${n}</td></tr>`).join("");
    return `<h3>Reader telemetry (first-party, cookieless)</h3>
     <table><tr><th>Total page views</th><td>${d.totalViews || 0}</td></tr>
     <tr><th>Viewing days</th><td>${d.days || 0}</td></tr></table>
     ${top ? `<h4>Most read</h4><table>${top}</table>` : ""}
     ${refRows ? `<h4>Traffic sources</h4><table>${refRows}</table>` : ""}
     <p class="src">Counts are aggregated per path in KV; no cookies, no identifiers, nothing per-visitor is ever stored, and Do Not Track is honoured.</p>`;
  } catch { return ""; }
}

async function statsPage() {
  const readerRows = await readerTelemetryRows();
  const meta = readJson("run_meta.json", null);
  const q = readJson(`quarantine/${meta?.date || "NA"}.json`, []).filter((e) => e?.reason !== "test");
  const prov = meta?.providers
    ? Object.entries(meta.providers)
        .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v} successful calls</td></tr>`)
        .join("")
    : "";
  // Quota health: per model-slot telemetry (v3 rotation). Each Gemini flash
  // model has its own daily bucket, so a "day 429" here means that bucket is
  // empty until the provider's reset — visible before it bites.
  const slotRows = meta?.llm?.slots || {};
  const slotFails = meta?.llm?.fails || {};
  const quotaRows = Object.keys(slotRows).length + Object.keys(slotFails).length
    ? Object.entries(slotRows)
        .map(([slot, ok]) => {
          const f = slotFails[slot] || {};
          const health = f.day429 ? "daily quota out" : f.minute429 ? "rate-limited (recovers)" : "healthy";
          return `<tr><td>${esc(slot)}</td><td>${ok} ok</td><td>${f.minute429 || 0} min-429</td><td>${f.day429 || 0} day-429</td><td>${esc(health)}</td></tr>`;
        })
        .join("")
    : "";
  const rows = meta
    ? `<tr><td>Edition date</td><td>${esc(meta.date)}</td></tr>
       <tr><td>Articles published</td><td>${meta.published} / ${meta.total}</td></tr>
       <tr><td>Quarantined (fact-gate)</td><td>${q.length}</td></tr>
       <tr><td>LLM calls used</td><td>${meta.llm.calls} of ${meta.llm.budget} budget</td></tr>
       <tr><td>Provider usage</td><td>${prov ? `<table>${prov}</table>` : "single provider"}</td></tr>
       <tr><td>Pipeline duration</td><td>${Math.round(meta.durationMs / 1000)}s</td></tr>
       <tr><td>Finished at (UTC)</td><td>${esc(meta.finishedAt)}</td></tr>`
    : `<tr><td colspan="2">No run metadata yet — first daily run pending.</td></tr>`;
  return page(
    "Newsroom Stats — The Daily Prompt",
    `<header><h1>Newsroom Stats</h1><p>Self-monitoring: every daily run reports its own telemetry here.</p></header>
     <h3>Latest run</h3>
     <table>${rows}</table>
     ${quotaRows ? `<h3>Quota health (model slots)</h3><table><tr><th>Slot</th><th>OK</th><th>Min-429</th><th>Day-429</th><th>Status</th></tr>${quotaRows}</table>` : ""}
     <h3>Journalist leaderboard</h3>
     <table><tr><th>Journalist</th><th>Genome</th><th>Avg editor score</th><th>Editions</th></tr>${leaderboard(loadGenomes())}</table>
     <p class="src">Run metadata is written by the pipeline (<code>run_meta.json</code>) after every edition; this page is rebuilt with it.</p>${readerRows}`
  );
}

// Dead-man switch banner on the front page.
function stalenessBanner() {
  const hb = readJson("last_success.json", null);
  if (!hb || !hb.at) return "";
  const days = Math.floor((Date.now() - new Date(hb.at).getTime()) / 86400000);
  if (days < 2) return "";
  return `<div class="stale">Notice: last successful edition was <b>${days} days</b> ago — the newsroom may be stalled (quota, feeds or credentials). Runs continue automatically.</div>`;
}

// iOS home-screen splash screens (Apple needs explicit per-device sizes).
function iOSLinkSprite() {
  const splash = (dw, dh, dpr, href, orient) =>
    `<link rel="apple-touch-startup-image" media="(device-width: ${dw}px) and (device-height: ${dh}px) and (-webkit-device-pixel-ratio: ${dpr})${orient ? ` and (orientation: ${orient})` : ""}" href="${href}">`;
  return [
    splash(390, 844, 3, "/icons/splash-1170x2532.png"),      // iPhone 12/13/14
    splash(375, 812, 3, "/icons/splash-1125x2436.png"),      // iPhone X/11 Pro
    splash(768, 1024, 2, "/icons/splash-1536x2048.png", "portrait"), // iPad
    splash(1024, 768, 2, "/icons/splash-2048x1536.png", "landscape"),
  ].join("\n");
}

function ogUrl(src) {
  const p = src.startsWith("http") ? src : src.startsWith("/") ? src.slice(1) : src;
  return `${PUBLIC_BASE}/${p}`;
}

function page(title, body, { description = "An autonomous AI newspaper: scraped, written, edited and fact-gated by evolving AI journalists.", permalink = "", lang = "en", ogImage = "/og/home.png", jsonLd = "" } = {}) {
  const url = permalink ? `${PUBLIC_BASE}/${permalink}` : PUBLIC_BASE;
  return `<!doctype html><html lang="${lang}" data-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="The Daily Prompt">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(ogUrl(ogImage))}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(ogUrl(ogImage))}">
${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ""}
<meta name="theme-color" content="${THEME_COLOR}">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
${iOSLinkSprite()}
<link rel="icon" type="image/png" href="/icons/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap" rel="stylesheet">
<script>(function(){try{var t=localStorage.getItem('tdp.theme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}})();</script>
<script src="/pwa.js" defer></script>
<script src="/push.js" defer></script>
<script src="/telemetry.js" defer></script>
<script src="/translator.js" defer></script>
<script src="/personalize.js" defer></script>
<script>
function googleTranslateElementInit() {
  new google.translate.TranslateElement({
    pageLanguage: '${lang}',
    includedLanguages: 'as,bn,brx,doi,gu,hi,kn,ks,mai,mni-Mtei,mr,ne,or,pa,sa,sat,sd,ta,te,ur,en,ar,zh-CN,es,fr,de,ja,ru,pt,id,tr,fa,sw',
    layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
    autoDisplay: false
  }, 'google_translate_element');
}
</script>
<script src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script>
${analyticsSnippet()}
<style>${THEME_CSS}</style></head><body>${TOPBAR}<div class="gtr"><span>Read in your language:</span><div id="google_translate_element"></div></div><div class="wrap">${body}
<footer>The Daily Prompt · every article is AI-generated and fact-gated against its source · <a href="/stats.html">newsroom stats</a> · <a href="/ethics.html">ethics</a> · <a href="/feed.xml">RSS</a></footer>
</div></body></html>`;
}

function feedXml(editions) {
  const items = editions
    .flatMap((ed) => ed.articles.map((a) => ({ ...a, ed: ed.date })))
    .slice(0, 30)
    .map(
      (a) => `<item><title>${esc(a.headline)}</title>
<link>${PUBLIC_BASE}/${articleHref(a)}</link>
<guid>${PUBLIC_BASE}/${articleHref(a)}</guid>
<pubDate>${new Date(a.date || a.ed).toUTCString()}</pubDate>
<description>${esc(String(a.body || "").slice(0, 300))}</description></item>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>The Daily Prompt</title>
<link>${PUBLIC_BASE}</link>
<description>An autonomous AI newspaper — scraped, written, edited and fact-gated by evolving AI journalists.</description>
${items}
</channel></rss>`;
}

export async function build() {
  // Clean rebuild: stale pages from older editions must never linger.
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  // reader-side translation widget (Layer 3 of the i18n stack)
  fs.copyFileSync(path.join(SITE_DIR, "assets", "translator.js"), path.join(DIST, "translator.js"));
  // reader preferences: language memory + beat follows (localStorage)
  fs.copyFileSync(path.join(SITE_DIR, "assets", "personalize.js"), path.join(DIST, "personalize.js"));
  // PWA: installable app (manifest + offline service worker + install banner)
  fs.copyFileSync(path.join(SITE_DIR, "assets", "manifest.json"), path.join(DIST, "manifest.json"));
  fs.copyFileSync(path.join(SITE_DIR, "assets", "sw.js"), path.join(DIST, "sw.js"));
  fs.copyFileSync(path.join(SITE_DIR, "assets", "pwa.js"), path.join(DIST, "pwa.js"));
  // web push opt-in (bell in the masthead nav) + share-target landing page
  fs.copyFileSync(path.join(SITE_DIR, "assets", "push.js"), path.join(DIST, "push.js"));
  fs.copyFileSync(path.join(SITE_DIR, "assets", "telemetry.js"), path.join(DIST, "telemetry.js"));
  fs.copyFileSync(path.join(SITE_DIR, "assets", "share.html"), path.join(DIST, "share.html"));
  // Pages advanced-mode worker: static serving + /api/push/* (subscriptions KV)
  fs.copyFileSync(path.join(ROOT, "_worker.js"), path.join(DIST, "_worker.js"));
  fs.mkdirSync(path.join(DIST, "icons"), { recursive: true });
  for (const icon of fs.readdirSync(path.join(SITE_DIR, "assets", "icons"))) {
    fs.copyFileSync(path.join(SITE_DIR, "assets", "icons", icon), path.join(DIST, "icons", icon));
  }
  const edition = readJson("today.json", { date: "—", articles: [] });
  const published = edition.articles.filter((a) => a.published);

  // All editions (latest first) for categories, search, date nav, hindi.
  const archDir = path.join(ROOT, "data", "archive");
  const editions = [];
  if (fs.existsSync(archDir)) {
    for (const f of fs.readdirSync(archDir).filter((f) => f.endsWith(".json")).sort().reverse()) {
      try {
        editions.push(JSON.parse(fs.readFileSync(path.join(archDir, f), "utf8")));
      } catch {
        /* skip corrupt */
      }
    }
  }
  if (!editions.some((e) => e.date === edition.date)) editions.unshift(edition);
  const allPublished = editions.flatMap((ed) => (ed.articles || []).filter((a) => a.published).map((a) => ({ ...a })));

  // ---------- front page: hero + today + sections + recent + explore ----------
  fs.mkdirSync(path.join(DIST, "article"), { recursive: true });
  const dates = editions.map((e) => e.date).filter(Boolean).sort();
  const prev = dates[dates.indexOf(edition.date) - 1];
  const dateNav = prev
    ? `<div class="dates"><span>← <a href="/archive/${esc(prev)}.html">${esc(prev)}</a></span><span>${esc(edition.date)}</span><span></span></div>`
    : "";
  const [top, ...rest] = published;
  const banner = stalenessBanner();

  const beats = [...new Set(allPublished.map((a) => a.beat))];

  // Newspaper "Sections": latest 3 headlines per beat, across ALL editions.
  const sectionCols = beats
    .map((beat) => {
      const stories = allPublished.filter((a) => a.beat === beat).slice(0, 3);
      if (!stories.length) return "";
      return `<div class="col"><h3><a href="/category/${esc(beat)}.html">${esc(beat)}</a></h3><ul>${stories
        .map(
          (a) =>
            `<li><a href="/${esc(articleHref(a))}">${esc(a.headline)}</a><br><small>${esc(a.date)} · ${esc(a.source)}</small></li>`
        )
        .join("")}</ul></div>`;
    })
    .join("");

  // "Recently published": brief headlines from older editions.
  const briefs = allPublished
    .filter((a) => a.date !== edition.date)
    .slice(0, 14)
    .map(
      (a) =>
        `<li><a href="/${esc(articleHref(a))}">${esc(a.headline)}</a> <small>· ${esc(a.beat)} · ${esc(a.date)}</small></li>`
    )
    .join("");

  // ---------- News Wire (zero-LLM wire service) ----------
  // Every fresh, deduped pool story the paper did not write up — plain linked
  // headlines straight from the scrape pool. Zero LLM cost; stories worth
  // depth are candidates for tomorrow's full articles.
  const writtenLinks = new Set(allPublished.map((a) => String(a.sourceLink || a.link)));
  const wireCutoff = Date.now() - 48 * 3600 * 1000;
  const wirePool = (readJson("stories.json", { stories: [] }).stories || [])
    .filter((s) => !writtenLinks.has(String(s.link)) && new Date(s.published || 0).getTime() > wireCutoff)
    .sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  const wireTotal = wirePool.length;
  const ago = (iso) => {
    const h = Math.max(0, Math.round((Date.now() - new Date(iso || 0).getTime()) / 3600000));
    return h >= 24 ? `${Math.round(h / 24)}d ago` : `${h}h ago`;
  };
  const wireForBeat = (beat, n = 12) => {
    const list = wirePool.filter((s) => s.beat === beat).slice(0, n);
    return list.length
      ? list
          .map(
            (s) =>
              `<li><a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.title)}</a> <small>· ${esc(s.sourceName)} · ${ago(s.published)}</small></li>`
          )
          .join("")
      : "";
  };
  const wirePreview = wirePool
    .slice(0, 10)
    .map(
      (s) =>
        `<li><a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.title)}</a> <small>· ${esc(s.beat)} · ${esc(s.sourceName)} · ${ago(s.published)}</small></li>`
    )
    .join("");

  // ---------- Trending Now: pool stories confirmed by 2+ independent sources ----------
  const trending = wirePool
    .filter((s) => (s.confirmations || 1) >= 2)
    .slice(0, 10);

  // ---------- Night Round: positive + funny + offbeat, the wind-down read ----------
  const nightStories = allPublished.filter((a) =>
    ["positive", "funny", "entertainment"].includes(a.beat)
  );
  const nightWire = [...wirePool]
    .filter((s) => ["positive", "funny", "entertainment"].includes(s.beat))
    .sort((a, b) => (b.confirmations || 1) - (a.confirmations || 1))
    .slice(0, 15);
  const nightBody = `${
    nightStories.length
      ? `<h2 class="sec">Tonight's gentle reads</h2>${nightStories.map((a) => articleCard(a, { link: true })).join("")}`
      : ""
  }${
    nightWire.length
      ? `<h2 class="sec">Lighter headlines from the wire</h2><ul class="brief">${nightWire
          .map(
            (s) =>
              `<li><a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.title)}</a> <small>· ${esc(s.beat)} · ${esc(s.sourceName)}</small></li>`
          )
          .join("")}</ul>`
      : ""
  }${
    !nightStories.length && !nightWire.length
      ? `<p class="src">The Night Round fills up as the positive, funny and entertainment desks publish. Check back after the evening edition.</p>`
      : ""
  }`;
  fs.writeFileSync(
    path.join(DIST, "night.html"),
    page(
      "Night Round — The Daily Prompt",
      `<header><h1>Night Round</h1><p>The wind-down edition: good news, odd-but-true and light reads — gathered from today's desks. A calm end to the news day.</p></header>
       <nav class="catrow">${catGrouped()}</nav>
       ${nightBody}`
    )
  );

  // OG card paths assigned up-front so article/category pages carry their own card.
  for (const a of allPublished) a.ogCard = `og/${a.date}/${slugify(a.headline)}.png`;

  const srcCount = (JSON.parse(fs.readFileSync(path.join(ROOT, "sources.json"), "utf8")).sources || []).length;
  const journalistCount = BEATS.length; // active journalist roster (retired genomes excluded)
  const aboutHtml = `<div class="pipeline">
    <div class="pstep"><span class="num">STEP 1</span><span class="ico">&sect;</span><b>Scrape</b><p>${srcCount} RSS sources scanned every morning. Fresh stories enter the pool, near-duplicates merge, cross-source confirmations are counted.</p></div>
    <span class="parrow">→</span>
    <div class="pstep"><span class="num">STEP 2</span><span class="ico">&para;</span><b>Write</b><p>${journalistCount} AI journalists — one per section, each with an evolving prompt-genome — draft the day's most important stories.</p></div>
    <span class="parrow">→</span>
    <div class="pstep"><span class="num">STEP 3</span><span class="ico">&sect;&sect;</span><b>Fact-gate</b><p>An AI editor scores every draft strictly against its source. Invented quotes or numbers? The story is quarantined, never published.</p></div>
    <span class="parrow">→</span>
    <div class="pstep"><span class="num">STEP 4</span><span class="ico">&para;&para;</span><b>Publish</b><p>The site rebuilds itself, the Telegram digest ships, archives update — zero human intervention.</p></div>
  </div>
  <p class="about-note">Fully autonomous on GitHub Actions: journalists <b>evolve weekly</b> (A/B-tested genome mutations) and a <b>dead-man switch</b> alerts the owner if any run fails. Every number is verifiable in <a href="/stats.html">public telemetry</a>.</p>`;

  const explore = `<div class="tiles">
    <a class="tile" href="/wire.html"><b>Wire</b>${wireTotal} headlines</a>
    <a class="tile" href="/night.html"><b>Night Round</b>good news & odd</a>
    <a class="tile" href="/archive.html"><b>Archive</b>${editions.length} editions</a>
    <a class="tile" href="/search.html"><b>Search</b>all ${allPublished.length} stories</a>
    <a class="tile" href="/stats.html"><b>Stats</b>newsroom telemetry</a>
    <a class="tile" href="/feed.xml"><b>RSS</b>subscribe free</a>
    <a class="tile" href="/ethics.html"><b>Ethics</b>&amp; corrections</a>
  </div>`;

  const home = page(
    `The Daily Prompt — ${edition.date}`,
    `<header class="mast"><h1><a href="/">The Daily Prompt</a></h1><p>An autonomous AI newspaper · Edition ${esc(edition.date)}</p>
       <div class="masthead-stats"><span>${editions.length} editions</span><span>${allPublished.length} stories</span><span>${BEATS.length} sections</span></div>
       </header>
     ${banner}${dateNav}
     ${top ? heroCard(top) : "<p>No stories published today. Check quarantine.</p>"}
     ${rest.map((a) => articleCard(a, { link: true })).join("")}
     ${trending.length ? `<h2 class="sec">Trending now</h2><ul class="brief">${trending.map((s) => `<li><a href="${esc(s.link)}" target="_blank" rel="noopener">${esc(s.title)}</a> <small>· confirmed by ${s.confirmations || 1} sources · ${esc(s.beat)}</small></li>`).join("")}</ul>` : ""}
     ${sectionCols ? `<h2 class="sec">Sections</h2><div class="cols">${sectionCols}</div>` : ""}
     ${briefs ? `<h2 class="sec">Recently published</h2><ul class="brief">${briefs}</ul>` : ""}
     ${wirePreview ? `<h2 class="sec">News Wire</h2><ul class="brief">${wirePreview}</ul><p><a href="/wire.html">Full wire — ${wireTotal} headlines →</a></p>` : ""}
     <h2 class="sec">How this newsroom works</h2>${aboutHtml}
     <h2 class="sec">Explore the newsroom</h2>${explore}`
  );
  fs.writeFileSync(path.join(DIST, "index.html"), home);

  // Website + SearchAction JSON-LD on the front page
  const homeLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "The Daily Prompt",
    url: PUBLIC_BASE,
    description: "An autonomous AI newspaper — scraped, written, edited and fact-gated by evolving AI journalists.",
    potentialAction: {
      "@type": "SearchAction",
      target: `${PUBLIC_BASE}/search.html?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  });
  fs.writeFileSync(path.join(DIST, "index.html"), home.replace("</head>", `<script type="application/ld+json">${homeLd}</script></head>`));

  // per-article pages
  for (const a of allPublished) {
    const dir = path.join(DIST, "article", a.date || "unknown");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${slugify(a.headline)}.html`), articlePage(a, a.date));
  }

  // ---------- category pages (all roster beats — empty sections never 404) ----------
  fs.mkdirSync(path.join(DIST, "category"), { recursive: true });
  for (const beat of [...new Set([...BEATS, ...beats])]) {
    const stories = allPublished.filter((a) => a.beat === beat);
    const empty = stories.length
      ? ""
      : `<p class="src">No stories yet in this section — the daily pool decides what gets written. Check back tomorrow.</p>`;
    const desks = BEAT_GROUPS.filter((g) => g.beats.includes(beat))[0];
    const groupLabel = desks ? desks.label : "News";
    const siblings = desks ? desks.beats.filter((b) => b !== beat) : [];
    const sisterLinks = siblings.length
      ? `<p class="src">More in ${esc(groupLabel)}: ${siblings.map((b) => `<a href="/category/${esc(b)}.html">${esc(b)}</a>`).join(" · ")}</p>`
      : "";
    const naukriLink =
      beat === "education"
        ? `<div class="tile" style="max-width:640px;margin:14px auto"><b>Looking for a job?</b>Sarkari naukri & private job alerts live on our sister project — <a href="https://bharat-naukri-alert.pages.dev/" target="_blank" rel="noopener">Bharat Naukri Alert →</a></div>`
        : "";
    const body = `<header><h1>${esc(beat.toUpperCase())}</h1><p>${stories.length} stories across all editions</p></header>
      ${empty}${stories.map((a) => articleCard(a, { link: true })).join("")}
      ${naukriLink}${sisterLinks}
      ${wireForBeat(beat) ? `<h2 class="sec">More from the wire</h2><ul class="brief">${wireForBeat(beat)}</ul>` : ""}`;
    fs.writeFileSync(path.join(DIST, "category", `${beat}.html`), page(`The Daily Prompt — ${beat}`, body));
  }

  // Hindi edition removed — readers translate on-device with the browser's
  // built-in translator (site/assets/translator.js). Clear stale /hi/ pages.
  fs.rmSync(path.join(DIST, "hi"), { recursive: true, force: true });

  // ---------- search ----------
  const searchIndex = allPublished.map((a) => ({
    href: `/${articleHref(a)}`,
    headline: a.headline,
    beat: a.beat,
    date: a.date,
    snippet: String(a.body || "").slice(0, 140),
  }));
  fs.writeFileSync(path.join(DIST, "search-index.json"), JSON.stringify(searchIndex));
  fs.writeFileSync(
    path.join(DIST, "search.html"),
    page(
      "Search — The Daily Prompt",
      `<header><h1>Search</h1><p>All published stories, searchable.</p></header>
       <input id="q" type="search" placeholder="Type to search headlines and stories…" autofocus>
       <div id="hits"></div>
       <script>
       const IDX = ${JSON.stringify(searchIndex)};
       const q = document.getElementById('q'), hits = document.getElementById('hits');
       function render() {
         const t = q.value.trim().toLowerCase();
         if (!t) { hits.innerHTML = ''; return; }
         const m = IDX.filter(x => (x.headline + ' ' + x.snippet + ' ' + x.beat).toLowerCase().includes(t)).slice(0, 30);
         hits.innerHTML = m.map(x => '<div class="hit"><a href="' + x.href + '">' + x.headline + '</a><br><small>' + x.beat + ' · ' + x.date + ' — ' + x.snippet + '…</small></div>').join('') || '<p>No matches.</p>';
       }
       q.addEventListener('input', render);
       </script>`
    )
  );

  // ---------- archive ----------
  fs.mkdirSync(path.join(DIST, "archive"), { recursive: true });
  let archList = "";
  for (const ed of editions) {
    if (!ed.date) continue;
    archList += `<li><a href="archive/${esc(ed.date)}.html">${esc(ed.date)}</a></li>`;
    const arts = (ed.articles || []).filter((a) => a.published);
    fs.writeFileSync(
      path.join(DIST, "archive", `${ed.date}.html`),
      page(
        `The Daily Prompt — ${ed.date}`,
        `<header><h1>Edition ${esc(ed.date)}</h1></header>${arts.length ? arts.map((a) => articleCard(a, { link: true })).join("") : "<p>No stories published in this edition.</p>"}`
      )
    );
  }
  fs.writeFileSync(
    path.join(DIST, "archive.html"),
    page("Archive — The Daily Prompt", `<header><h1>Archive</h1></header><ul>${archList}</ul>`)
  );

  fs.writeFileSync(path.join(DIST, "stats.html"), await statsPage());
  fs.writeFileSync(path.join(DIST, "feed.xml"), feedXml(editions));

  // ---------- OG/social cards (Python/Pillow, deterministic) ----------
  const cardJobs = [
    { path: "og/home.png", headline: `Today's edition — ${allPublished.length} stories, written by evolving AI journalists`, beat: "national", source: "daily-prompt newsroom" },
  ];
  for (const beat of beats) {
    const latest = allPublished.find((a) => a.beat === beat);
    cardJobs.push({ path: `og/category-${beat}.png`, headline: latest ? latest.headline : `${beat} section — stories from the daily pool`, beat, source: "section front" });
  }
  for (const a of allPublished) {
    cardJobs.push({ path: a.ogCard, headline: a.headline, beat: a.beat, source: a.source });
  }
  try {
    const py = spawnSync("python", [path.join(ROOT, "report_assets", "cards_driver.py")], {
      input: JSON.stringify({ outDir: path.relative(ROOT, DIST), cards: cardJobs }),
      encoding: "utf8",
      timeout: 120000,
    });
    if (py.status !== 0) console.log(`[site] og cards skipped: ${(py.stderr || py.stdout || "").slice(0, 120)}`);
    else console.log(`[site] ${String(py.stdout).trim().split("\n").pop()}`);
  } catch (e) {
    console.log(`[site] og cards skipped: ${String(e).slice(0, 120)}`);
  }

  // ---------- News Wire page ----------
  // Columns follow the pool: every beat that actually has wire stories today
  // (all 17 desks appear as their feeds fill in).
  const wireBeatList = [...new Set([...BEATS, ...wirePool.map((s) => s.beat)])];
  const wireCols = wireBeatList.map(
    (b) =>
      wireForBeat(b, 20)
        ? `<div class="col"><h3>${esc(b)} <small>(${wirePool.filter((s) => s.beat === b).length})</small></h3><ul class="brief">${wireForBeat(b, 20)}</ul></div>`
        : ""
  ).join("");
  const srcCount2 = (JSON.parse(fs.readFileSync(path.join(ROOT, "sources.json"), "utf8")).sources || []).length;
  fs.writeFileSync(
    path.join(DIST, "wire.html"),
    page(
      "News Wire — The Daily Prompt",
      `<header><h1>News Wire</h1><p>${wireTotal} fresh headlines from ${srcCount2} sources, straight from the wire — no rewriting, zero cost. Stories worth depth become full articles in the next edition.</p></header>
       <nav class="catrow">${catGrouped()}</nav>
       <div class="cols">${wireCols}</div>`
    )
  );

  // ---------- sitemap + robots ----------
  const urls = [
    "",
    "archive.html",
    "search.html",
    "stats.html",
    "wire.html",
    "night.html",
    "ethics.html",
    "hi/",
    ...beats.map((b) => `category/${b}.html`),
    ...editions.filter((e) => e.date).map((e) => `archive/${e.date}.html`),
    ...allPublished.map((a) => articleHref(a)),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${PUBLIC_BASE}/${u}</loc>${u.startsWith("archive/") ? `<lastmod>${u.slice(8, 18)}</lastmod>` : ""}</url>`).join("\n")}
</urlset>`;
  fs.writeFileSync(path.join(DIST, "sitemap.xml"), sitemap);
  fs.writeFileSync(
    path.join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${PUBLIC_BASE}/sitemap.xml\n`
  );

  // ---------- custom 404 ----------
  fs.writeFileSync(
    path.join(DIST, "404.html"),
    page(
      "Page not found — The Daily Prompt",
      `<header><h1>404 — Story not found</h1><p>Even autonomous newsrooms have blank columns sometimes.</p></header>
       <p>This page does not exist (or the story was never published — our fact-gate is strict).</p>
       <p><a href="/">← Today's front page</a> · <a href="/archive.html">Archive</a> · <a href="/search.html">Search all stories</a></p>`
    )
  );

  // ---------- ethics & corrections ----------
  fs.writeFileSync(
    path.join(DIST, "ethics.html"),
    page(
      "Ethics & Corrections — The Daily Prompt",
      `<header><h1>Ethics &amp; Corrections</h1><p>How an AI newsroom holds itself accountable.</p></header>
       <article class="story single">
       <h2>Transparency</h2>
       <p>Every article on this site is generated by AI. Each page labels its beat, source, editor score and reading time. The full pipeline telemetry — runs, LLM calls, provider usage, quarantines — is public on the <a href="/stats.html">stats page</a>.</p>
       <h2>The fact-gate</h2>
       <p>Before publication, an AI editor scores every draft strictly against its original source. Drafts containing invented quotes, numbers or events are <b>quarantined and never published</b>. Quarantine records are kept and visible in the run telemetry.</p>
       <h2>Corrections policy</h2>
       <p>Errors that slip through are corrected in place and the correction is noted in the article's editor note. Because every edition is archived by date, the historical record is never silently rewritten — a correction in tomorrow's edition does not erase yesterday's page.</p>
       <h2>Human oversight</h2>
       <p>The newsroom runs autonomously, but the owner (a human) receives a Telegram alert for every failed run, and can disable any feature via configuration. Every published article links to the original reporting it is based on.</p>
       <h2>Privacy</h2>
       <p>Reader personalisation (language memory, followed sections, saved stories) lives entirely in the reader's own browser via localStorage. No accounts, no tracking cookies. The only measurement is a first-party, cookieless page counter that stores aggregate counts per path, honours Do Not Track, and never stores anything per-visitor.</p>
       </article>`
    )
  );

  console.log(
    `[site] built ${allPublished.length} article pages, ${beats.length} categories, search (${searchIndex.length} docs) -> site/dist/`
  );
}

if (process.argv[1] && process.argv[1].endsWith("build.js")) build();
