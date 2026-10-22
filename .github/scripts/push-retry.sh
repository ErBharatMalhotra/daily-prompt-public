#!/usr/bin/env bash
# Push HEAD to origin/<branch>, with retries.
#
# Two failure modes this exists for, both measured in the 2026-10 runs:
#   * GitHub returns a transient 5xx from receive-pack —
#       "! [remote rejected] HEAD -> main (Internal Server Error)"
#     Nothing about the repo is wrong; a second attempt seconds later works.
#     With no retry, one 500 cost a whole scheduled slot.
#   * Two bots push the same JSON DB on overlapping schedules (scrape.yml,
#     scrape-quizzes.yml, evolution.yml), so the second push is a
#     non-fast-forward. Rebasing onto whatever landed in between turns that into
#     a fast-forward instead of a lost batch.
#
# Usage:  bash .github/scripts/push-retry.sh [branch]
# Env:    PUSH_ATTEMPTS   how many attempts before giving up (default 4)
#
# Exit status is the whole point: after the last attempt it exits 1, so a run
# that could not publish is RED instead of silently green (the old inline
# `for i in 1 2 3` loops ended on an echo and reported success).
set -uo pipefail

branch="${1:-main}"
attempts="${PUSH_ATTEMPTS:-4}"
url="$(git remote get-url origin 2>/dev/null || echo unknown)"

for i in $(seq 1 "$attempts"); do
  if git push origin "HEAD:${branch}"; then
    echo "[push] ok: HEAD -> origin/${branch} at ${url} (attempt ${i}/${attempts})"
    exit 0
  fi
  echo "[push] attempt ${i}/${attempts} failed at $(git rev-parse --short HEAD 2>/dev/null || echo '?'); syncing on origin/${branch}"
  if ! git fetch --quiet origin "${branch}"; then
    echo "[push] fetch failed too — GitHub may be down; waiting before the next attempt"
  fi
  if ! git rebase "origin/${branch}" >/dev/null 2>&1; then
    git rebase --abort >/dev/null 2>&1 || true
    echo "[push] rebase did not apply cleanly — keeping local commits and retrying as-is"
  fi
  sleep $(( i * 5 ))
done

echo "::error::push to ${url} (origin/${branch}) failed after ${attempts} attempts — see the git output above"
exit 1
