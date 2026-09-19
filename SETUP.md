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

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → **Connect to Git**
2. Pick the **public** repo, framework: **None**, build command: *(empty)*,
   output directory: `site/dist`
3. Deploy. Every workflow push to `site/dist/` auto-redeploys the newspaper.

(GitHub Pages alternative: Settings → Pages → deploy from `main` branch,
folder `/site/dist`.)

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
