/* service worker — offline support + web push for The Daily Prompt.
 * Strategy:
 *   - navigation requests: network-first, cache fallback (offline reading)
 *   - static assets: stale-while-revalidate
 *   - push events: notification with the new edition / article, click -> open
 *   - onactivate: clear legacy caches from the pre-push version string
 * Version bump invalidates old caches.
 */
const VERSION = "tdp-v3-install";
const CORE = ["/", "/index.html", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.disable(); } catch {}
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // never touch google translate etc.
  if (e.request.method !== "GET") return;

  // pages: network first, fall back to cache (offline reading)
  if (e.request.mode === "navigate" || e.request.headers.get("accept")?.includes("text/html")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then((m) => m || caches.match("/index.html")))
    );
    return;
  }

  // same-origin assets: cache first, refresh in background
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        })
    )
  );
});

/* ---------------- web push ---------------- */

function notifyTitle(payload) {
  const n = payload.headline ? String(payload.headline) : "New edition is out";
  return n.length > 110 ? n.slice(0, 107) + "…" : n;
}

self.addEventListener("push", (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch { payload = { headline: e.data ? e.data.text() : "" }; }
  const title = `${payload.beat ? payload.beat.toUpperCase() + " · " : ""}${notifyTitle(payload)}`;
  e.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "Today's edition was written, edited and fact-gated by the AI newsroom.",
      icon: payload.icon || "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: payload.tag || "daily-prompt-edition",
      renotify: false,
      data: { url: payload.url || "/?source=push" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        try {
          const u = new URL(client.url);
          if (u.origin === self.location.origin) {
            await client.focus();
            if (u.pathname + u.search !== target) client.navigate && client.navigate(target);
            return;
          }
        } catch {}
      }
      await self.clients.openWindow(target);
    })()
  );
});

self.addEventListener("notificationclose", (e) => {
  // reserved for future read-rate telemetry; intentionally no-op
});

self.addEventListener("pushsubscriptionchange", (e) => {
  // The old subscription is dead; the browser may give a new one. Report the
  // dead endpoint so the nightly prune can clean the KV record.
  e.waitUntil(
    (async () => {
      try {
        const old = e.oldSubscription && e.oldSubscription.endpoint;
        if (!old) return;
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: old, dead: true }),
        }).catch(() => {});
      } catch {}
    })()
  );
});
