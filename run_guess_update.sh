#!/usr/bin/env bash
set -euo pipefail

BASE="/home/opc/guess-updater"
DB="$BASE/holodori-db-eng-diff"
PY="$BASE/.venv/bin/python"
UPDATER="$BASE/update_guess_all.py"

# Make venv-installed commands such as `holodori` available even when this
# script is launched through a non-interactive SSH/systemd session.
export PATH="$BASE/.venv/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

FORCE=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

cd "$DB"
git fetch origin

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse '@{u}')"

if [[ "$FORCE" -eq 0 && "$LOCAL" == "$REMOTE" ]]; then
  echo "[guess-update] No DB update. Nothing to do."
  exit 0
fi

if [[ "$LOCAL" != "$REMOTE" ]]; then
  echo "[guess-update] DB changed: $LOCAL -> $REMOTE"
  git pull --ff-only
else
  echo "[guess-update] Forced check; DB commit unchanged."
fi

exec "$PY" "$UPDATER"
