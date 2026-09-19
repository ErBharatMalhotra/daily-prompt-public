# Setup — Public Runner + Private Core

— Bharat Malhotra. One-time setup, ~15 minutes.

## 1. Repos

1. **Private core** — push this project's code + `data/` to
   `ErBharatMalhotra/AI-Newsroom` (Private).
2. **Public runner** — push the `newsroom-public/` contents (workflows, README,
   placeholder site) to a new **public** repo, e.g. `ErBharatMalhotra/daily-prompt-public`.

## 2. Fine-grained token (CORE_TOKEN)

GitHub → Settings → Developer settings → Fine-grained tokens → Generate:

- **Repository access:** only `AI-Newsroom` (the private core)
- **Permissions:** Contents → **Read and write**
- Expiry: set a reminder; regenerate before it lapses (or use 90 days + calendar)

Add it in the **public** repo: Settings → Secrets and variables → Actions →
New repository secret → Name: `CORE_TOKEN`.

## 3. LLM keys (public repo secrets)

| Secret | Content |
|---|---|
| `GROQ_KEYS` | comma-separated Groq keys (free console.groq.com) |
| `OPENROUTER_KEYS` | comma-separated OpenRouter keys |
| `GEMINI_KEYS` | comma-separated Gemini keys |
| `TELEGRAM_BOT_TOKEN` | from @BotFather (optional) |
| `TELEGRAM_CHAT_ID` | channel/group id (optional) |

Keys never enter either repo — they are injected as environment variables only
inside the job.

## 4. Cloudflare Pages (site hosting)

Live URL: **https://daily-prompt-do3.pages.dev** (project `daily-prompt`).

Cloudflare Pages is **git-connected** to this repo:

- Dashboard → Workers & Pages → `daily-prompt` → Settings → Build →
  **Git repository → Connect** → pick `daily-prompt-public`, production branch `main`
- Framework: **None**, build command: *(empty)*, output directory: **`site/dist`**

After that every workflow push of `site/dist/` auto-deploys the newspaper —
no tokens, no manual deploys. Manual fallback if ever needed:
`cd newsroom-public/site/dist && npx wrangler pages deploy . --project-name daily-prompt`

## 5. First run

Public repo → Actions → **Daily Edition** → **Run workflow**. Watch it:
clone core → tests → pipeline → push site back. Then check the live site and
`data/today.json` in the core repo.

## 6. Keepalive (important!)

GitHub disables scheduled workflows on public repos after **60 days of repo
inactivity**. The daily workflow commits to the public repo on every run, so the
repo never goes quiet — this is the keepalive by-product. If you ever disable
commits, add a weekly no-op commit workflow instead.

## Troubleshooting

- `Clone private core` fails → token expired or wrong repo permission
- Tests fail → core is broken; CI on the core repo would also be red
- No Telegram message → secrets missing; digest skips silently by design
- Site not updating → check the workflow's last "Push built site" step and
  Cloudflare Pages deployment log
