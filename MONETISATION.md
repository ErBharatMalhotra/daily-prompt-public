# Monetisation — The Daily Prompt (news.bharatdn.com)

— Bharat Malhotra. Status: **pre-application** (compliance work done, application pending).

## Where this fits

The news site lives on the subdomain **news.bharatdn.com** (Cloudflare Pages,
built daily by CI). AdSense applies at the **root-domain level**: since 2023
subdomains cannot be added individually — verifying and approving
`bharatdn.com` covers its subdomains automatically. Compliance, however, is
enforced per-subdomain, so this site is kept review-ready on its own:

- **/about** — what the newsroom is, how a story is made, who operates it
- **/privacy** — no-accounts/no-cookies policy + the required advertising
  disclosure (Google AdSense, third-party vendor cookies incl. the DART
  cookie, opt-out via Google Ads Settings)
- **/contact** — `news@bharatdn.com`, corrections, tips, takedown route
- **/ethics** — AI transparency, fact-gate, corrections policy (pre-existing)
- Footer on every page links all four; all four are in `sitemap.xml`

The AI-generated disclosure is **kept deliberately** — transparency is not a
policy violation. Google's spam policy targets *scaled content abuse*
(generat­ed pages made to manipulate rankings, no user value), not
AI-assisted content that is original, source-linked and fact-gated, which is
exactly what this newsroom produces. Removing the disclosure would also gut
the project's central theme (verifiable autonomous journalism), so it stays.

## Quality-first mode (live)

Since the site is also an earning platform, the pipeline runs quality-first:
`DAILY_ARTICLES: 10` + `BRIEFS_PER_RUN: 8` (was 30/40) and a publish floor
(`MIN_EDITOR_SCORE: 6`) — weak drafts are held back, not shown, even when the
fact-gate passes. Brief candidates need a ≥300-char summary (thin-content
guard). Quotas may exhaust; weak pages will not ship. The News Wire page
(outbound headline directory, no original content) carries `noindex, follow`
and is excluded from the sitemap — useful to readers, invisible to indexing.

## Checklist

| Step | Status |
|---|---|
| Canonical/sitemap/OG on `news.bharatdn.com` (`SITE_BASE` secret) | done |
| About / Privacy / Contact pages + footer links + sitemap entries | done |
| `news@bharatdn.com` mailbox reachable | owner action |
| Search Console: verify subdomain, submit `sitemap.xml`, let pages index | owner action |
| Apply at **bharatdn.com** (root), not the subdomain | owner action |
| After approval: `ads.txt` with the publisher ID at the **root domain** (subdomains inherit when referenced from root per Google's ads.txt FAQ) | owner action |
| Ad units placed so they never mimic content elements (fact-check badges etc.) | owner action |
| Subdomain audit of bharatdn.com (no parked/empty subdomains at review time) | owner action, ongoing |

## Report hook

For the major-project report this becomes the **sustainability** angle:
zero-paid-infra newsroom + ad revenue model — reuse this file's checklist as
the section outline when the report is next updated.
