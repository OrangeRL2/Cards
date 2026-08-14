#!/usr/bin/env bash
set -euo pipefail

echo "== Onee-Chan bot environment setup =="

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This setup script currently supports Debian/Ubuntu/WSL environments using apt."
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

echo
echo "[1/5] Installing system dependencies..."
$SUDO apt-get update
$SUDO apt-get install -y \
  ffmpeg \
  build-essential \
  python3 \
  make \
  g++

echo
echo "[2/5] Checking Node.js and npm..."
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed."
  echo "Install the Node.js version used by the bot, then run this script again."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is not installed."
  exit 1
fi

echo "Node: $(node --version)"
echo "npm:  $(npm --version)"
echo "ffmpeg: $(ffmpeg -version | head -n 1)"

echo
echo "[3/5] Installing Node dependencies..."
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo
echo "[4/5] Verifying required runtime modules..."
node -e "require('sharp'); console.log('sharp: OK')"

echo
echo "[5/5] Verifying Guess audio support..."
node - <<'NODE'
const { spawnSync } = require('node:child_process');

const result = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
if (result.status !== 0) {
  console.error('ffmpeg: FAILED');
  process.exit(1);
}
console.log('ffmpeg: OK');
NODE

echo
echo "======================================"
echo "Setup complete."
echo
echo "You can now run:"
echo "  node deploy-commands.js"
echo "  node index.js"
echo
