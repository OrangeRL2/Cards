#!/usr/bin/env bash
set -euo pipefail

FORCE=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--force]" >&2
  exit 2
fi

PATH="/usr/local/bin:/usr/bin:/bin"

HOME_DIR="$HOME"
BOT="$HOME_DIR/4newCards/Cards"
SSH_KEY="$HOME_DIR/ssh-key-2025-10-19.key"

REMOTE_USER="opc"
REMOTE_HOST="152.69.195.48"
REMOTE_BASE="/home/opc/guess-updater"
REMOTE_DATA="/usr/share/nginx/html/images/guess/data"
REMOTE_HOLODORI="/usr/share/nginx/html/images/HOLODORI"

LOCAL_DATA="$BOT/images/guess/data"
LOCAL_HOLODORI="$BOT/assets/images/HOLODORI"
ORGANIZED="$HOME_DIR/testholo/organized-card-images"

STATE_DIR="$BOT/.guess-updater"
CATALOG="$STATE_DIR/octo_list.json"
OLD_CATALOG="$STATE_DIR/octo_list.previous.json"
LOG="$STATE_DIR/update.log"

CARD_UPDATER="$BOT/update_holodori_cards_auto.py"

# Guess DB used for songs/cards.json.
if [[ -d "$HOME_DIR/testholo/holodori-db-eng-diff/.git" ]]; then
  EN_DB="$HOME_DIR/testholo/holodori-db-eng-diff"
elif [[ -d "$HOME_DIR/holodori/holodori-db-eng-diff/.git" ]]; then
  EN_DB="$HOME_DIR/holodori/holodori-db-eng-diff"
elif [[ -d "$HOME_DIR/holodori-db-eng-diff/.git" ]]; then
  EN_DB="$HOME_DIR/holodori-db-eng-diff"
else
  echo "[guess-controller] Could not find holodori-db-eng-diff." >&2
  exit 1
fi

# Card organizer DB.
if [[ -d "$HOME_DIR/testholo/holodori-db-jpn-diff/.git" ]]; then
  JP_DB="$HOME_DIR/testholo/holodori-db-jpn-diff"
elif [[ -d "$HOME_DIR/holodori-db-jpn-diff/.git" ]]; then
  JP_DB="$HOME_DIR/holodori-db-jpn-diff"
else
  echo "[guess-controller] Could not find holodori-db-jpn-diff." >&2
  exit 1
fi

# Prefer the venv belonging to the card updater's tool checkout.
if [[ -x "$HOME_DIR/testholo/holodori-asset-tools/.venv/bin/python" ]]; then
  CARD_PY="$HOME_DIR/testholo/holodori-asset-tools/.venv/bin/python"
  CARD_TOOL_BIN="$HOME_DIR/testholo/holodori-asset-tools/.venv/bin"
elif [[ -x "$HOME_DIR/holodori-asset-tools/.venv/bin/python" ]]; then
  CARD_PY="$HOME_DIR/holodori-asset-tools/.venv/bin/python"
  CARD_TOOL_BIN="$HOME_DIR/holodori-asset-tools/.venv/bin"
else
  echo "[guess-controller] Could not find Holodori Python venv." >&2
  exit 1
fi

if [[ -x "$HOME_DIR/holodori-asset-tools/.venv/bin/holodori" ]]; then
  CATALOG_HOLODORI="$HOME_DIR/holodori-asset-tools/.venv/bin/holodori"
elif [[ -x "$HOME_DIR/testholo/holodori-asset-tools/.venv/bin/holodori" ]]; then
  CATALOG_HOLODORI="$HOME_DIR/testholo/holodori-asset-tools/.venv/bin/holodori"
else
  echo "[guess-controller] Could not find holodori CLI." >&2
  exit 1
fi

mkdir -p "$STATE_DIR" "$LOCAL_DATA" "$LOCAL_HOLODORI"
touch "$LOG"
exec > >(tee -a "$LOG") 2>&1

echo
echo "============================================================"
echo "[guess-controller] $(date --iso-8601=seconds)"
echo "============================================================"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "[guess-controller] Missing SSH key: $SSH_KEY" >&2
  exit 1
fi

if [[ ! -f "$CARD_UPDATER" ]]; then
  echo "[guess-controller] Missing card updater: $CARD_UPDATER" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "[guess-controller] rsync is not installed locally." >&2
  echo "Install once with: sudo apt install -y rsync" >&2
  exit 1
fi

chmod 600 "$SSH_KEY" 2>/dev/null || true

echo "[guess-controller] Checking English DB..."
git -C "$EN_DB" fetch origin
EN_LOCAL="$(git -C "$EN_DB" rev-parse HEAD)"
EN_REMOTE="$(git -C "$EN_DB" rev-parse '@{u}')"
EN_CHANGED=0
[[ "$EN_LOCAL" != "$EN_REMOTE" ]] && EN_CHANGED=1

echo "[guess-controller] Checking Japanese card DB..."
git -C "$JP_DB" fetch origin
JP_LOCAL="$(git -C "$JP_DB" rev-parse HEAD)"
JP_REMOTE="$(git -C "$JP_DB" rev-parse '@{u}')"
JP_CHANGED=0
[[ "$JP_LOCAL" != "$JP_REMOTE" ]] && JP_CHANGED=1

echo "[guess-controller] Refreshing Holodori catalog..."
rm -f "$OLD_CATALOG"
if [[ -f "$CATALOG" ]]; then
  mv "$CATALOG" "$OLD_CATALOG"
fi

"$CATALOG_HOLODORI" download /tmp/holodori-catalog-refresh \
  --filter '^THIS_MATCHES_NOTHING$' \
  --catalog "$CATALOG"

if [[ ! -s "$CATALOG" ]]; then
  echo "[guess-controller] Fresh catalog was not created." >&2
  if [[ -f "$OLD_CATALOG" ]]; then
    mv "$OLD_CATALOG" "$CATALOG"
  fi
  exit 1
fi

CATALOG_CHANGED=1
if [[ -f "$OLD_CATALOG" ]]; then
  OLD_SUM="$(sha256sum "$OLD_CATALOG" | awk '{print $1}')"
  NEW_SUM="$(sha256sum "$CATALOG" | awk '{print $1}')"
  [[ "$OLD_SUM" == "$NEW_SUM" ]] && CATALOG_CHANGED=0
fi

echo "[guess-controller] Changes: EN_DB=$EN_CHANGED JP_DB=$JP_CHANGED CATALOG=$CATALOG_CHANGED FORCE=$FORCE"

if [[ "$EN_CHANGED" -eq 0 && "$JP_CHANGED" -eq 0 && "$CATALOG_CHANGED" -eq 0 && "$FORCE" -eq 0 ]]; then
  echo "[guess-controller] Nothing changed. Done."
  exit 0
fi

if [[ "$EN_CHANGED" -eq 1 ]]; then
  echo "[guess-controller] Updating English DB..."
  git -C "$EN_DB" pull --ff-only
fi

echo "[guess-controller] Updating/organizing local Holodori cards..."
export PATH="$CARD_TOOL_BIN:/usr/local/bin:/usr/bin:/bin"
"$CARD_PY" "$CARD_UPDATER"

echo "[guess-controller] Syncing ★★★ / ★★★★ / ★★★★★ into local bot..."
for rarity in "★★★" "★★★★" "★★★★★"; do
  mkdir -p "$LOCAL_HOLODORI/$rarity"
  rsync -a --delete "$ORGANIZED/$rarity/" "$LOCAL_HOLODORI/$rarity/"
done

echo "[guess-controller] Ensuring remote HOLODORI directories exist..."
ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=20 \
  "$REMOTE_USER@$REMOTE_HOST" \
  "mkdir -p '$REMOTE_HOLODORI/★★★' '$REMOTE_HOLODORI/★★★★' '$REMOTE_HOLODORI/★★★★★'"

echo "[guess-controller] Syncing HOLODORI card folders to OPC..."
rsync -az --delete \
  -e "ssh -i $SSH_KEY -o BatchMode=yes -o ConnectTimeout=20" \
  "$LOCAL_HOLODORI/" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_HOLODORI/"

echo "[guess-controller] Sending fresh catalog to OPC..."
scp -q -i "$SSH_KEY" \
  -o BatchMode=yes \
  -o ConnectTimeout=20 \
  "$CATALOG" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_BASE/octo_list.json"

echo "[guess-controller] Running OPC Guess updater..."
ssh -i "$SSH_KEY" \
  -o BatchMode=yes \
  -o ConnectTimeout=20 \
  "$REMOTE_USER@$REMOTE_HOST" \
  "cd '$REMOTE_BASE' && ./run_guess_update.sh --force"

echo "[guess-controller] Fixing Guess web permissions..."
ssh -i "$SSH_KEY" \
  -o BatchMode=yes \
  -o ConnectTimeout=20 \
  "$REMOTE_USER@$REMOTE_HOST" \
  "find '/usr/share/nginx/html/images/guess' -type d -exec chmod 755 {} + && find '/usr/share/nginx/html/images/guess' -type f -exec chmod 644 {} +"

echo "[guess-controller] Copying fresh Guess JSON manifests back to bot..."
scp -q -i "$SSH_KEY" \
  -o BatchMode=yes \
  -o ConnectTimeout=20 \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DATA/songs.json" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DATA/cards.json" \
  "$LOCAL_DATA/"

echo "[guess-controller] Finished successfully."
echo "[guess-controller] Local HOLODORI counts:"
for rarity in "★★★" "★★★★" "★★★★★"; do
  printf "  %s: " "$rarity"
  find "$LOCAL_HOLODORI/$rarity" -maxdepth 1 -type f -name '*.png' | wc -l
done
echo "[guess-controller] Local Guess manifests:"
ls -lh "$LOCAL_DATA/songs.json" "$LOCAL_DATA/cards.json"
