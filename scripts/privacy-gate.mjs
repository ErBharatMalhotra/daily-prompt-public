#!/usr/bin/env node
// privacy-gate.mjs — fail CI if anything from the private core (or secrets)
// is about to be published in this public repo.
// BNA pattern: public repo must never contain core code, .env, or key material.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ALLOWED = new Set([
  "node_modules", ".git", ".github", "site", "scripts", "docs",
]);

const KEY_PATTERNS = [
  [/gsk_[A-Za-z0-9]{20,}/, "Groq key"],
  [/sk-or-v1-[A-Za-z0-9]{20,}/, "OpenRouter key"],
  [/AIza[A-Za-z0-9_\-]{30,}/, "Gemini key"],
  [/ghp_[A-Za-z0-9]{30,}/, "GitHub PAT"],
  [/github_pat_[A-Za-z0-9_]{30,}/, "GitHub fine-grained PAT"],
  [/BOT_TOKEN\s*=\s*[A-Za-z0-9:_\-]{20,}/, "Telegram bot token"],
  [/-----BEGIN (RSA |EC )?PRIVATE KEY-----/, "private key"],
];

// Files that must never exist in the public repo
const FORBIDDEN_FILES = [".env", "sources.private.json"];

let problems = [];

// 1. forbidden files
for (const f of FORBIDDEN_FILES) {
  if (fs.existsSync(path.join(ROOT, f))) {
    problems.push(`forbidden file present: ${f}`);
  }
}

// 2. no core/ directory committed (it is cloned at runtime only)
if (fs.existsSync(path.join(ROOT, "core"))) {
  problems.push("core/ directory committed — private code leaked");
}

// 3. secret-shaped strings in text files
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (ALLOWED.has(entry.name) && entry.isDirectory()) {
      if (entry.name === "site" || entry.name === "scripts" || entry.name === "docs" || entry.name === ".github") {
        // scan these too, but skip dist? dist is built output — scan it, cheap
      }
      yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      yield path.join(dir, entry.name);
    }
  }
}

let scanned = 0;
for (const file of walk(ROOT)) {
  const ext = path.extname(file).toLowerCase();
  if (![".md", ".yml", ".yaml", ".json", ".js", ".mjs", ".html", ".txt", ".css"].includes(ext)) continue;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  scanned++;
  for (const [re, label] of KEY_PATTERNS) {
    if (re.test(text)) {
      problems.push(`${label} pattern found in ${path.relative(ROOT, file)}`);
    }
  }
}

if (problems.length) {
  console.error("PRIVACY GATE FAILED:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`privacy gate ok (${scanned} files scanned, no secrets, no core leakage)`);
