#!/usr/bin/env bash
set -euo pipefail

ROOT="./assets/images/oshi"
mkdir -p "$ROOT"

OSHIS=(
miko suisei sora roboco azki aki matsuri haato fubuki mel choco subaru aqua shion ayame okayu mio korone
pekora rushia flare marine noel kanata watame coco towa luna polka nene botan aloe lamy koyori chloe
laplus lui iroha raden ao kanade ririka hajime riona su chihaya niko vivi risu moona iofi anya reine
ollie kaela zeta kobo amelia calli ina gura kiara baelz irys kronii fauna sana mumei fuwawa mococo bijou
shiori nerissa liz raora gigi cecilia "a-chan" nodoka
)

RARITIES=(C HR OC OSR OUR P R RR S SEC SP SR SY U UP UR bday)

echo "Creating folders under $ROOT..."
for o in "${OSHIS[@]}"; do
  echo "Processing: $o"
  for r in "${RARITIES[@]}"; do
    mkdir -p "$ROOT/$o/$r"
  done
done
echo "Done."
