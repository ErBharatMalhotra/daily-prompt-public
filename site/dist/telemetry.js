/* telemetry.js — RETIRED 2026-09-30.
 * The first-party beacon (/api/analytics/collect → KV counters) is gone: it
 * wrote one KV record per page view and exhausted the Workers KV free tier
 * (1,000 writes/day, account-wide). Reader analytics now live in Cloudflare
 * Web Analytics (dashboard, cookieless, zero writes to our infrastructure).
 * This file stays as a no-op so cached HTML that still references
 * /telemetry.js keeps working until the next build sweeps it out.
 */
(function () {});
