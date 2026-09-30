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
    return env.ASSETS.fetch(request);
  },
};
