#!/usr/bin/env bash
# session-start-webview-sweep.sh
# SessionStart hook: keeps the local, branch-scoped webview verification scratch tidy.
#   1. ensures `.webview-scripts/` is gitignored (so scratch is never committed)
#   2. removes `.webview-scripts/<branch-slug>/` folders whose git branch is gone
#      (merged/deleted) — the feature's scratch dies with its branch.
#
# Scope: ONLY runs when `.webview-scripts/` already exists in the project (so it
# never touches projects that don't use it). `_shared/` is always preserved.
# Non-blocking — always exit 0. Never touches committed files.
#
# Opt-out: touch ~/.webview-test-no-session-check
#
# (browser-verifier의 session-start-verify-sweep.sh와 동일 방식 — 폴더만 .webview-scripts/)

set -eu

[ -f "$HOME/.webview-test-no-session-check" ] && exit 0

# Project root: prefer Claude's env, fall back to git toplevel from cwd.
DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$ROOT" ] || exit 0                       # not a git repo → nothing to do

SCRATCH="$ROOT/.webview-scripts"
[ -d "$SCRATCH" ] || exit 0                     # project doesn't use scratch → skip

# 1) ensure gitignore entry (idempotent). Only touch .gitignore when scratch exists.
GI="$ROOT/.gitignore"
if ! { [ -f "$GI" ] && grep -qxF ".webview-scripts/" "$GI"; }; then
  printf '\n# webview-test local scratch (branch-scoped verification scripts)\n.webview-scripts/\n' >> "$GI"
fi

# 2) sweep dead-branch folders.
# Live branch names, slugified the same way writers name folders ('/' → '-').
LIVE="$(git -C "$ROOT" for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null | sed 's#/#-#g')"
[ -n "$LIVE" ] || exit 0                        # no branches / detached weirdness → don't risk deleting

for d in "$SCRATCH"/*/; do
  [ -d "$d" ] || continue                       # no subdirs → glob stayed literal
  name="$(basename "$d")"
  [ "$name" = "_shared" ] && continue           # shared helpers never swept
  if ! printf '%s\n' "$LIVE" | grep -qxF "$name"; then
    # defensive: path must be inside .webview-scripts before rm
    case "$d" in
      "$SCRATCH"/*) rm -rf "$d" && echo "[webview-test] swept scratch for deleted branch: $name" >&2 ;;
    esac
  fi
done

exit 0
