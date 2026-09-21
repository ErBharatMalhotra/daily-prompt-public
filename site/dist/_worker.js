/* _worker.js — Cloudflare Pages advanced-mode worker for The Daily Prompt.
 * Serves every static asset from the Pages deployment unchanged, and adds a
 * tiny JSON API on /api/* for web push:
 *   POST /api/push/subscribe  {endpoint, keys:{p256dh,auth}}  -> saves sub (KV)
 *   GET  /api/push/subs?admin=KEY     -> live subscription count
 *   DELETE /api/push/dead?admin=KEY   -> clears dead/pruned endpoint records
 *   GET  /api/push/vapid      -> the VAPID public key (no secret material)
 * Push sending lives in the CI workflow (scripts/push-notify.mjs, public
 * repo) so the daily edition triggers the notification without any always-on
 * server. KV stores one record per subscription with lastSeen for pruning.
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
    return json({ publicKey: env.VAPID_PUBLIC_B64URL || "" });
  }

  if (request.method === "POST" && route === "subscribe") {
    if (!env.SUBS) return json({ ok: false, error: "storage not bound" }, 500);
    const body = await readBody(request);
    const endpoint = body && typeof body.endpoint === "string" ? body.endpoint : "";
    const keys = body && body.keys;
    if (!endpoint.startsWith("https://") || !keys || !keys.p256dh || !keys.auth) {
      return json({ ok: false, error: "invalid subscription" }, 400);
    }
    const id = encodeURIComponent(endpoint).slice(0, 220);
    const record = {
      endpoint,
      p256dh: String(keys.p256dh).slice(0, 200),
      auth: String(keys.auth).slice(0, 200),
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    };
    await env.SUBS.put("sub:" + id, JSON.stringify(record));
    return json({ ok: true });
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
    // CI sender reports 404/410 endpoints here after a push wave.
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
