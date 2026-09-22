# The Daily Prompt — An Autonomous AI Newspaper

[![Daily Edition](https://img.shields.io/badge/daily%20edition-06:00%20IST-8b0000)](#workflows)
[![Tests](https://img.shields.io/badge/tests-18%2F18-brightgreen)](.github/workflows/ci.yml)
[![Cost](https://img.shields.io/badge/running%20cost-%E2%82%B90-success)](#design-decisions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Every morning, without any human touching a keyboard, this system reads the news, writes its own newspaper, fact-checks itself against its sources, publishes a website, installs as a phone app, and pushes an alert to its readers.**

Live site: **https://daily-prompt-do3.pages.dev**

---

## What it does (every day at 06:00 IST)

| Step | What happens |
|---|---|
| **1 · Scrape** | 28 RSS sources scanned; stories enter a pool; near-duplicates merge (fuzzy title matching); cross-source confirmations counted |
| **2 · Select** | The most important stories chosen per beat, with cross-edition dedupe |
| **3 · Write** | 8 AI journalists — one per section, each with its own **evolving prompt-genome** — draft original articles |
| **4 · Edit + Fact-gate** | An AI editor scores every draft against its source. Invented quotes or numbers → **quarantined, never published** |
| **5 · Publish** | Static site rebuilds (per-article pages, categories, search, sitemap, OG cards, JSON-LD) |
| **6 · Distribute** | Telegram digest to the channel + **web push alert** to PWA subscribers |
| **7 · Observe** | Run telemetry published on `/stats.html`; a dead-man switch alerts the owner if anything fails |

## Screenshots

| Front page (dark editorial) | Stats telemetry |
|---|---|
| ![Front page](site/dist/og/home.png) | *see the live site — `/stats.html`* |

*The front page renders the glass nav, hero card, section columns and pipeline explainer — best viewed live.*

## Feature list

**Newsroom**
- Original article generation (not summarisation) with per-beat journalist agents
- Hallucination **publish gate** with quarantine archive (prevention, not post-hoc detection)
- Fuzzy dedupe + cross-source confirmation badges ("confirmed by 2 sources")
- Weekly **self-evolution**: weakest journalist's prompt-genome mutates; challenger runs A/B against champion; winner promoted on score evidence
- Multi-provider LLM chain with circuit breakers (Groq → Gemini → OpenRouter), shared daily budget, per-call fallback

**Site (static, fast, SEO-complete)**
- "Modern Editorial" skin: dark-default design tokens, glass sticky nav, serif headlines (Source Serif 4) + Inter body, light-mode toggle (localStorage, FOUC-safe)
- Per-article pages with reading time, editor score, fact-check badge
- Category pages for all 8 roster beats (empty sections render a friendly note — never 404)
- Client-side search, date navigation, full archive by edition
- **OG/social cards** generated per article/category at build time (Pillow); sitemap.xml, robots.txt, JSON-LD (NewsArticle + WebSite/SearchAction)
- Custom 404, Ethics & Corrections page
- Hindi translator-guide page (see i18n below)

**PWA (installable app)**
- Manifest with app shortcuts (Hindi / Search / Stats), share target, iOS splash screens
- Service worker: offline reading (network-first pages, cache-first assets)
- **Web push notifications** — standard VAPID, subscriptions in Cloudflare KV, sent from CI; dead endpoints auto-pruned. No FCM project, no paid service.
- Dark editorial icons/splash matching the site theme

**Reader personalisation (zero backend, zero PII)**
- Language memory (Google Translate choice persists across pages)
- Follow sections → "Your news" block
- Save-for-later bookmarks
- All in localStorage; no accounts, no cookies
- The only measurement is a **first-party, cookieless page counter** (aggregate counts per path in KV; nothing per-visitor is stored, Do Not Track honoured) surfaced on `/stats.html`

**Internationalisation (zero-cost philosophy)**
- Reader-side translation: Google Translate element (30+ languages incl. all scheduled Indian languages) + Chrome built-in AI on-device hints
- LLM-translated Hindi edition toggleable via `HINDI_EDITION` secret (currently off — translator-first strategy)

**Reliability**
- Dead-man switch: staleness guard + Telegram alert on failure (last step in every workflow)
- Keepalive commits: editions/genomes/quarantine persisted to git (git-as-database)
- Sanity test suite gates every run (18 tests)

## Architecture

```
                    ┌──────────────────────────────┐
                    │  PRIVATE CORE REPO (source)  │
                    │  engine/ lib/ site/ tests/   │
                    └──────────────┬───────────────┘
                                   │ cloned at run time (fine-grained token, read-only)
                                   ▼
┌────────────────────────────────────────────────────────────────┐
│  PUBLIC RUNNER REPO (this repo)                                 │
│  GitHub Actions: daily.yml · evolve.yml · ci.yml · push-test.yml │
│  secrets never leave the job; only built site/dist/ is committed │
└───────────────┬───────────────────────────────┬─────────────────┘
                │ push site/dist/               │ keepalive commit (data/)
                ▼                               ▼
   ┌──────────────────────┐        ┌──────────────────────┐
   │ Cloudflare Pages     │        │ Private core (git DB) │
   │ + _worker.js (KV API)│        └──────────────────────┘
   │ → live newspaper     │
   └──────────┬───────────┘
              ▼
   Readers: web · PWA app · web push · Telegram digest
```

## Workflows

| Workflow | Schedule | Purpose |
|---|---|---|
| `daily.yml` | 06:00 IST + manual | full pipeline + site build + Telegram digest + web push |
| `evolve.yml` | Monday 08:30 IST | genome evolution (mutate weakest beat, start A/B experiments) |
| `ci.yml` | pushes/PRs | sanity tests + privacy gate |
| `push-test.yml` | manual | fire a test web push to all subscribers |

## Design decisions (the "why")

| Decision | Reason |
|---|---|
| Git as database | free, auditable, diff-able history of every edition and genome |
| Public runner + private core | CI logs must never leak prompts/keys; runner minutes are free on public repos |
| Static site | ₹0 hosting, instant loads, trivially cacheable, offline-capable |
| Prevention-first fact gate | AI misinformation handled *before* publish — detection-only tools act too late |
| Reader-side translation | unlimited languages at zero compute; server translation only where quality is contractual |
| Web Push over FCM | standard VAPID = no vendor lock, no Firebase project, KV + CI is the whole stack |
| localStorage personalisation | GDPR-free by construction: nothing about the reader ever leaves the reader |

## Privacy & ethics

- Every article is labelled AI-generated and links to its original source
- Quarantined drafts are never published; telemetry is public
- Corrections policy: archives are immutable, corrections ship in later editions
- No reader data is collected anywhere (see `/ethics.html`)

## Repository layout (this repo)

```
.github/workflows/   daily · evolve · ci · push-test
scripts/             privacy gate · web-push sender
site/dist/           the built newspaper (auto-committed by daily run)
SETUP.md             how to run your own copy
```

The engine source lives in a private repo; only its build output is published here.

## Author

Bharat Malhotra · BCA (CDOE), GLA University · Enrollment 2323000453

*Major project, Semester VI (2024–27 batch) — supervised by Ms. Sakshi Aggarwal, Assistant Professor.*
