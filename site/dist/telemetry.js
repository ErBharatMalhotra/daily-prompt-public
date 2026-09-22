/* telemetry.js — first-party, cookieless page counter for The Daily Prompt.
 * Design rules (privacy-first, matching the ethics page):
 *   - No third-party scripts, no cookies, no identifiers, no fingerprints.
 *   - Sends ONLY the page path + referrer to our own /api/analytics/collect,
 *     where counts are aggregated in KV. Nothing per-visitor is stored.
 *   - Respects Do Not Track: sends nothing when DNT is enabled.
 *   - Errors are silent — measurement must never break reading.
 */
(function () {
  "use strict";
  try {
    var dnt = navigator.doNotTrack || window.doNotTrack || "";
    if (dnt === "1" || dnt === "yes") return;
    var host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1" || location.protocol === "file:") return;
    // Search results carry per-reader queries — collapse them to one bucket.
    var p = location.pathname === "/search.html" ? "/search" : location.pathname;
    var payload = JSON.stringify({ p: p, r: document.referrer || "" });
    var url = "/api/analytics/collect";
    if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }))) return;
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
      credentials: "omit",
    }).catch(function () {});
  } catch (_) {}
})();
