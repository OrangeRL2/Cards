// scripts/clone-inventory.js
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { mongoUri } = require('../config.json');
const User = require('../models/User');

const SOURCE_ID = '701960122251083807';
const TARGET_ID = '153551890976735232';

// What to copy besides cards (optional):
// If you truly want ONLY the inventory, leave this as [].
const EXTRA_FIELDS_TO_COPY = [
  // 'points',
  // 'pulls',
  // 'pullsSinceLastSEC',
  // 'oshi',
  // 'eventPulls',
];

// Recommended: regenerate subdocument _id values in cards
const REGENERATE_CARD_SUBDOC_IDS = true;

// Safety: require explicit env to run LIVE
const DRY_RUN = !!process.env.DRY_RUN;

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function stripCardIds(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map(c => {
    // clone plain
    const copy = { ...c };
    delete copy._id;     // regenerate per target doc
    delete copy.__v;
    return copy;
  });
}

async function cloneInventory() {
  const mongoURI = process.env.MONGODB_URI || mongoUri;

  await mongoose.connect(mongoURI);
  console.log('[clone-inventory] Connected to MongoDB');
  console.log(`[clone-inventory] Mode: ${DRY_RUN ? 'DRY_RUN (no writes)' : 'LIVE (will overwrite target cards)'}`);

  try {
    const source = await User.findOne({ id: SOURCE_ID }).lean();
    if (!source) {
      throw new Error(`Source user not found: ${SOURCE_ID}`);
    }

    const target = await User.findOne({ id: TARGET_ID }).lean();

    // Backup target (if exists)
    const backup = {
      backedUpAt: new Date().toISOString(),
      targetId: TARGET_ID,
      existed: !!target,
      targetSnapshot: target ? {
        id: target.id,
        cards: target.cards || [],
        // include extra fields in backup too
        ...EXTRA_FIELDS_TO_COPY.reduce((acc, f) => {
          acc[f] = target[f];
          return acc;
        }, {})
      } : null
    };

    const backupFile = path.join(
      process.cwd(),
      `backup_target_${TARGET_ID}_${nowStamp()}.json`
    );

    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf8');
    console.log(`[clone-inventory] Backup written: ${backupFile}`);

    // Prepare new cards array
    let newCards = source.cards || [];
    if (REGENERATE_CARD_SUBDOC_IDS) {
      newCards = stripCardIds(newCards);
    }

    // Build update payload
    const setPayload = { cards: newCards };

    for (const field of EXTRA_FIELDS_TO_COPY) {
      if (Object.prototype.hasOwnProperty.call(source, field)) {
        setPayload[field] = source[field];
      }
    }

    if (DRY_RUN) {
      console.log('[clone-inventory] DRY_RUN: would set fields:', Object.keys(setPayload));
      console.log('[clone-inventory] DRY_RUN: source cards:', (source.cards || []).length);
      console.log('[clone-inventory] DRY_RUN: target cards:', (target?.cards || []).length);
      return;
    }

    // Ensure target exists + overwrite cards (and optionally extra fields)
    const res = await User.updateOne(
      { id: TARGET_ID },
      { $set: setPayload, $setOnInsert: { id: TARGET_ID } },
      { upsert: true }
    );

    console.log('[clone-inventory] Update result:', {
      matched: res.matchedCount,
      modified: res.modifiedCount,
      upserted: res.upsertedCount,
    });

    // Verify counts
    const after = await User.findOne({ id: TARGET_ID }, { id: 1, cards: 1 }).lean();
    console.log('[clone-inventory] Done.');
    console.log(`[clone-inventory] Target now has ${after?.cards?.length || 0} card entries.`);
  } finally {
    await mongoose.connection.close();
    console.log('[clone-inventory] MongoDB connection closed');
  }
}

if (require.main === module) {
  cloneInventory().catch(err => {
    console.error('[clone-inventory] FAILED:', err);
    process.exit(1);
  });
}

module.exports = cloneInventory;