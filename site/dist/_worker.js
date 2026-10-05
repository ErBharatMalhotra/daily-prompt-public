/* _worker.js — Cloudflare Pages advanced-mode worker for The Daily Prompt.
 * Serves every static asset from the Pages deployment unchanged, and keeps a
 * small ADMIN-ONLY JSON API on /api/push/* for web-push maintenance:
 *   GET    /api/push/vapid              -> VAPID public key ("" = intake closed)
 *   GET    /api/push/list?admin=KEY     -> live subscriptions (CI push sender)
 *   POST   /api/push/markdead?admin=KEY -> CI reports 404/410 endpoints
 *   DELETE /api/push/dead?admin=KEY     -> prune dead/pruned records
 *   DELETE /api/push/subscribe          -> browser self-cleanup (pushsubscriptionchange)
 *
 * 2026-09-30: reader analytics moved to Cloudflare Web Analytics (dashboard).
 * The old open /api/analytics/collect beacon wrote one KV counter per page
 * view and exhausted the Workers KV free tier (1,000 writes/day, ACCOUNT-WIDE
 * — the flood briefly blocked every KV namespace, including the console).
 * Public KV writes are gone now: POST /api/push/subscribe (new-subscriber
 * intake) is closed too — sending to existing subscribers still works, and
 * existing devices can still unsubscribe/clean up.
 */
/* ---------- Daily Edition bundles ----------
 * Old days ship as two files each (/bundles/<date>.<hash>.pages + .media)
 * instead of three files per article - the hedge for the Cloudflare Pages
 * 20,000-file cap. Assets are served first and bundles are consulted only
 * when the file is missing, or when ?bundle=1 forces the path (the
 * verification switch; forced reads stay byte-pure and noindex). Any bundle
 * problem falls through to the original 404, so this can never make a
 * working URL worse.
 * Phase 2 (BUNDLES_KEEP_FILES=0): packed days lose their originals, so old
 * URLs are served from these slices. Cloudflare injects its Web Analytics
 * beacon into asset-served HTML but not into worker-built responses, so the
 * worker appends the same snippet to canonical (non-forced) page reads.
 *   GET/HEAD /article/YYYY-MM-DD/<slug>[.html]  -> .pages slice
 *   GET/HEAD /img|og/YYYY-MM-DD/<file>          -> .media slice
 */
const BUNDLE_MANIFEST_TTL = 60; // seconds; month manifest rechecked every minute
const BUNDLE_PART_TTL = 31536000; // hash-named parts are immutable

// Cloudflare Pages injects this exact 214-byte snippet into HTML served from
// static assets, but not into worker-built responses. Once packed days lose
// their originals (BUNDLES_KEEP_FILES=0) the worker is the only server left,
// so it appends the same snippet; otherwise old-day pageviews would silently
// stop counting. The token is public (it ships in every asset-served page);
// if it ever changes, re-derive this string from any live page body.
const CF_BEACON_TOKEN = "63dedef04275425fb2df17087a59bae0";
export const PAGES_ANALYTICS_SNIPPET = `<!-- Cloudflare Pages Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${CF_BEACON_TOKEN}"}'></script><!-- Cloudflare Pages Analytics -->`;
const PAGES_ANALYTICS_BYTES = new TextEncoder().encode(PAGES_ANALYTICS_SNIPPET);

function pageWithAnalytics(buf) {
  // latin1 keeps char == byte, so string indices address the ArrayBuffer 1:1.
  const text = new TextDecoder("latin1").decode(buf);
  if (text.includes("cloudflareinsights.com/beacon.min.js")) return buf; // never inject twice
  const at = text.lastIndexOf("</body>");
  if (at < 0) return buf; // unrecognised page shape: ship it untouched
  const out = new Uint8Array(buf.byteLength + PAGES_ANALYTICS_BYTES.length);
  out.set(new Uint8Array(buf.slice(0, at)), 0);
  out.set(PAGES_ANALYTICS_BYTES, at);
  out.set(new Uint8Array(buf.slice(at)), at + PAGES_ANALYTICS_BYTES.length);
  return out;
}

function bundleCache() {
  try {
    return typeof caches !== "undefined" && caches.default ? caches.default : null;
  } catch {
    return null;
  }
}

async function bundleAsset(env, pathname, ttl) {
  const key = new Request(`https://bundle.internal${pathname}`, { method: "GET" });
  const cache = bundleCache();
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  const res = await env.ASSETS.fetch(key);
  if (!res || !res.ok) return null;
  const out = new Response(res.body, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") || "application/octet-stream",
      "cache-control": `public, max-age=${ttl}`,
    },
  });
  if (cache) {
    try {
      await cache.put(key, out.clone());
    } catch {}
  }
  return out;
}

function slicePageBytes(buf, want) {
  // latin1 keeps char == byte, so string indices address the ArrayBuffer 1:1
  const text = new TextDecoder("latin1").decode(buf);
  const marker = `@@PAGE ${want}\n`;
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const from = start + marker.length;
  const end = text.indexOf("\n@@END\n", from);
  if (end < 0) return null;
  return { bytes: buf.slice(from, end), length: end - from };
}

function sliceAssetBytes(buf, want) {
  const u8 = new Uint8Array(buf);
  if (u8.length < 8 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "TDP1") return null;
  const hlen = (u8[4] | (u8[5] << 8) | (u8[6] << 16) | (u8[7] << 24)) >>> 0;
  const hEnd = 8 + hlen;
  if (hEnd > u8.length) return null;
  let head;
  try {
    head = JSON.parse(new TextDecoder().decode(u8.subarray(8, hEnd)));
  } catch {
    return null;
  }
  const a = (head.assets || []).find((x) => x.p === want);
  if (!a) return null;
  const from = hEnd + a.o;
  const to = from + a.l;
  if (to > u8.length) return null;
  return { bytes: buf.slice(from, to), length: a.l, type: a.t || "application/octet-stream" };
}

async function fromBundle(request, env, url, forced) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const m = url.pathname.match(/^\/(article|img|og)\/(\d{4}-\d{2}-\d{2})\/(.+)$/);
  if (!m) return null;
  const kind = m[1] === "article" ? "pages" : "media";
  let name = m[3];
  if (name.endsWith("/")) name = name.slice(0, -1);
  if (kind === "pages" && !name.endsWith(".html")) name += ".html";
  if (kind === "media" && name.includes("/")) return null;
  const date = m[2];
  const manRes = await bundleAsset(env, `/bundles/m-${date.slice(0, 7)}.json`, BUNDLE_MANIFEST_TTL);
  if (!manRes) return null;
  let man;
  try {
    man = await manRes.json();
  } catch {
    return null;
  }
  const day = man && man.days && man.days[date];
  if (!day) return null;
  const parts = kind === "pages" ? day.pages : day.media;
  if (!Array.isArray(parts) || !parts.length) return null;
  const want = `${m[1]}/${date}/${name}`;
  const extra = forced ? { "x-robots-tag": "noindex" } : {}; // only the debug path is non-canonical
  for (const part of parts) {
    const res = await bundleAsset(env, `/bundles/${part}`, BUNDLE_PART_TTL);
    if (!res) continue;
    const buf = await res.arrayBuffer();
    if (kind === "pages") {
      const hit = slicePageBytes(buf, want);
      if (hit) {
        // Forced reads stay byte-pure (that is the verification contract);
        // canonical reads carry the same beacon the edge injects.
        const body = forced ? hit.bytes : pageWithAnalytics(hit.bytes);
        return new Response(request.method === "HEAD" ? null : body, {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=600",
            "content-length": String(body.byteLength),
            ...extra,
          },
        });
      }
    } else {
      const hit = sliceAssetBytes(buf, want);
      if (hit) {
        return new Response(request.method === "HEAD" ? null : hit.bytes, {
          status: 200,
          headers: {
            "content-type": hit.type,
            "cache-control": "public, max-age=86400, immutable",
            "content-length": String(hit.length),
            ...extra,
          },
        });
      }
    }
  }
  return null;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

function adminOk(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get("admin") || request.headers.get("x-admin-key") || "";
  const expected = env.PUSH_ADMIN_KEY || "";
  if (!expected || key.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) diff |= key.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function handlePush(request, env) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/push\/?/, "");

  if (request.method === "GET" && route === "vapid") {
    // Empty key = the bell UI on the client silently stays off (intake closed).
    return json({ publicKey: "" });
  }

  if (request.method === "POST" && route === "subscribe") {
    // Intake closed (2026-09-30): this was one of only two public, unauthenticated
    // KV write paths on the site (the other was the analytics beacon).
    return json({ ok: false, error: "subscribe intake closed" }, 503);
  }

  if (request.method === "GET" && route === "subs") {
    if (!adminOk(request, env)) return json({ ok: false, error: "forbidden" }, 403);
    let count = 0;
    if (env.SUBS) {
      const keys = await env.SUBS.list({ prefix: "sub:" });
      for (const k of keys.keys) count++; // list pages at 1000; plenty for a newspaper
    }
    return json({ ok: true, count });
  }

  if (request.method === "GET" && route === "list") {
    // Admin: dump live subscriptions for the CI push sender (no CF creds needed).
    if (!adminOk(request, env)) return json({ ok: false, error: "forbidden" }, 403);
    const subs = [];
    if (env.SUBS) {
      let cursor;
      do {
        const page = await env.SUBS.list({ prefix: "sub:", cursor });
        for (const k of page.keys) {
          const raw = await env.SUBS.get(k.name);
          if (!raw) continue;
          try {
            const rec = JSON.parse(raw);
            if (rec && rec.endpoint && !rec.dead && rec.p256dh && rec.auth) {
              subs.push({ endpoint: rec.endpoint, p256dh: rec.p256dh, auth: rec.auth });
            }
          } catch {}
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
    }
    return json({ ok: true, subs });
  }

  if (request.method === "POST" && route === "markdead") {
    // CI sender reports 404/410 endpoints here after a push wave (admin-keyed).
    if (!adminOk(request, env)) return json({ ok: false, error: "forbidden" }, 403);
    const body = await readBody(request);
    const endpoint = body && typeof body.endpoint === "string" ? body.endpoint : "";
    if (!endpoint.startsWith("https://")) return json({ ok: false, error: "invalid" }, 400);
    if (env.SUBS) {
      const id = encodeURIComponent(endpoint).slice(0, 220);
      const raw = await env.SUBS.get("sub:" + id);
      if (raw) {
        try { const rec = JSON.parse(raw); rec.dead = true; await env.SUBS.put("sub:" + id, JSON.stringify(rec)); } catch {}
      }
    }
    return json({ ok: true });
  }

  if (request.method === "DELETE" && route === "subscribe") {
    // Browser reported a dead/expired subscription (pushsubscriptionchange).
    // Kept open so existing devices can clean up, but it can no longer create
    // records — it only flips already-stored ones to dead.
    if (!env.SUBS) return json({ ok: false, error: "storage not bound" }, 500);
    const body = await readBody(request);
    const endpoint = body && typeof body.endpoint === "string" ? body.endpoint : "";
    if (!endpoint.startsWith("https://")) return json({ ok: false, error: "invalid" }, 400);
    const id = encodeURIComponent(endpoint).slice(0, 220);
    const raw = await env.SUBS.get("sub:" + id);
    if (raw) {
      try { const rec = JSON.parse(raw); rec.dead = true; await env.SUBS.put("sub:" + id, JSON.stringify(rec)); } catch {}
    }
    return json({ ok: true });
  }

  if (request.method === "DELETE" && route === "dead") {
    if (!adminOk(request, env)) return json({ ok: false, error: "forbidden" }, 403);
    let removed = 0;
    if (env.SUBS) {
      const keys = await env.SUBS.list({ prefix: "sub:" });
      for (const k of keys.keys) {
        const raw = await env.SUBS.get(k.name);
        if (!raw) continue;
        try {
          const rec = JSON.parse(raw);
          if (rec && (rec.dead === true || rec.pruned === true)) { await env.SUBS.delete(k.name); removed++; }
        } catch { await env.SUBS.delete(k.name); removed++; }
      }
    }
    return json({ ok: true, removed });
  }

  return json({ ok: false, error: "not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/push/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,DELETE", "access-control-allow-headers": "content-type,x-admin-key" } });
      }
      try {
        return await handlePush(request, env);
      } catch (err) {
        return json({ ok: false, error: "internal" }, 500);
      }
    }
    // Advanced-mode Pages: static assets come from the ASSETS binding
    // (plain fetch() does NOT reach the asset server here).
    const forced = url.searchParams.get("bundle") === "1";
    if (forced) {
      // Verification path: serve the bundle slice even while originals exist.
      try {
        const hit = await fromBundle(request, env, url, true);
        if (hit) return hit;
      } catch {}
      return env.ASSETS.fetch(request);
    }
    const res = await env.ASSETS.fetch(request);
    if (res.status !== 404) return res;
    if (request.method === "GET" || request.method === "HEAD") {
      try {
        const hit = await fromBundle(request, env, url, false);
        if (hit) return hit;
      } catch {}
    }
    return res;
  },
};
