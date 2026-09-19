# The Daily Prompt — AI Newsroom (Public)

> This is the **public runner repo** for my BCA major project. It holds the
> GitHub Actions workflows and the **built newspaper** (`site/dist/`). All source
> code, data and archives live in my private core repo.

**Read the newspaper:** `site/dist/index.html` — rendered automatically after every
daily run (Cloudflare Pages / GitHub Pages serves this folder).

## How it works

```
GitHub Actions (public repo, this repo)
  1. clone private core  (fine-grained CORE_TOKEN, read)
  2. npm test            (sanity gate)
  3. scrape -> run -> build:site -> digest   (inside core)
  4. push site/dist/ back to this repo       (deployment = push)
  5. push new editions/genomes back to core  (git-as-database)
```

The core never appears in this repo — only its built output. Secrets stay in this
repo's Actions secrets; the core receives keys only as process environment inside
the job.

## Workflows

| Workflow | Schedule | What it does |
|---|---|---|
| `daily.yml` | 06:00 IST daily + manual | scrape → write → edit → fact-gate → site → telegram |
| `evolve.yml` | Monday 08:30 IST | weekly journalist-prompt evolution + report |
| `ci.yml` | every push/PR | sanity suite + privacy gate |

## Author

Bharat Malhotra · BCA (CDOE), GLA University
