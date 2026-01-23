// utils/drawPackSpecial.js
// A focused drawPackSpecial implementation that preserves your original 8-slot composition
// but prefers files that match a provided special/display label (settlement-style matching).
//
// Usage:
//   const { drawPackSpecial } = require('./utils/drawPackSpecial');
//   const pack = await drawPackSpecial(userId, 'Suisei'); // returns array of { rarity, file } (basename without extension)

const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;

const pools = require('./loadImages'); // your existing loader that exposes pools per rarity
const { pickCardFromRarityFolder, normalizeFilenameForMatch } = require('./cardPicker'); // settlement-style picker

function rand() {
  return Math.random();
}
function pickWeighted(options) {
  const total = options.reduce((s, o) => s + (o.weight || 0), 0);
  let r = rand() * total;
  for (const o of options) {
    if (r <= o.weight) return o.key;
    r -= o.weight;
  }
  return options[options.length - 1].key;
}

// Fallback random pick from pools object (keeps original non-special behavior if no special match)
function fallbackPickFromPools(rarity, userId) {
  const idStr = String(userId);
  // prefer per-group pools if present (mirrors your pickFileFromPool logic)
  if (pools.special && pools.special[rarity] && pools.special[rarity].length > 0) {
    return pools.special[rarity][Math.floor(Math.random() * pools.special[rarity].length)];
  }
  if (pools.other && pools.other[rarity] && pools.other[rarity].length > 0) {
    return pools.other[rarity][Math.floor(Math.random() * pools.other[rarity].length)];
  }
  if (pools[rarity] && pools[rarity].length > 0) {
    return pools[rarity][Math.floor(Math.random() * pools[rarity].length)];
  }
  // last resort: synthesize a fallback name
  return `${rarity}-unknown-001.png`;
}

/**
 * pickForSlot(rarity, specialLabel, userId)
 * - Try settlement-style pickCardFromRarityFolder with specialLabel first (exact/partial match).
 * - If that fails, fall back to pickCardFromRarityFolder with no label (random from folder).
 * - If that fails, fall back to pools loader.
 *
 * Returns basename without extension (e.g., "Suisei 001")
 */
async function pickForSlot(rarity, specialLabel, userId) {
  // Try special-first using settlement picker
  if (specialLabel) {
    try {
      const picked = await pickCardFromRarityFolder(rarity, specialLabel, { avoidImmediateRepeat: true });
      if (picked) return picked;
    } catch (err) {
      console.debug('[drawPackSpecial] special pick error', { rarity, specialLabel, err });
    }
  }

  // Fallback: any file from folder via settlement picker (no label)
  try {
    const fallback = await pickCardFromRarityFolder(rarity, null, { avoidImmediateRepeat: true });
    if (fallback) return fallback;
  } catch (err) {
    console.debug('[drawPackSpecial] fallback picker error', { rarity, err });
  }

  // Final fallback: pools loader (returns filename with extension)
  try {
    const raw = fallbackPickFromPools(rarity, userId);
    // ensure we return basename without extension
    return path.basename(raw, path.extname(raw));
  } catch (err) {
    console.error('[drawPackSpecial] final fallback error', { rarity, err });
    return `${rarity}-unknown-001`;
  }
}

/**
 * drawPackSpecial(userId, specialLabel)
 * - Preserves original 8-slot composition and weights.
 * - Prefers files matching specialLabel for each slot.
 * - Returns array of { rarity, file } where file is basename without extension.
 */
async function drawPackSpecial(userId, specialLabel) {
  const results = [];

  // --- Common slots (4) ---
  const commonSlot1Options = [
    { key: 'C', weight: 95.8 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
    { key: 'BDAY', weight: 0.1 },
  ];
  {
    const rarity = pickWeighted(commonSlot1Options);
    const file = await pickForSlot(rarity, specialLabel, userId);
    results.push({ rarity, file });
  }

  const commonSlot2Options = [
    { key: 'C', weight: 94.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 2.0 },
  ];
  {
    const rarity = pickWeighted(commonSlot2Options);
    const file = await pickForSlot(rarity, specialLabel, userId);
    results.push({ rarity, file });
  }

  const commonSlot3Options = [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'BDAY', weight: 0.1 },
  ];
  {
    const rarity = pickWeighted(commonSlot3Options);
    const file = await pickForSlot(rarity, specialLabel, userId);
    results.push({ rarity, file });
  }

  const commonSlot4Options = [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
  ];
  {
    const rarity = pickWeighted(commonSlot4Options);
    const file = await pickForSlot(rarity, specialLabel, userId);
    results.push({ rarity, file });
  }

  // --- Uncommon slots (3 picks) ---
  const uncommonSlotBases = [
    [
      { key: 'U', weight: 89.75 },
      { key: 'RR', weight: 10.0 },
      { key: 'SY', weight: 0.25 },
    ],
    [
      { key: 'U', weight: 96.75 },
      { key: 'SR', weight: 3.0 },
      { key: 'SY', weight: 0.25 },
    ],
    [
      { key: 'U', weight: 97.5 },
      { key: 'OSR', weight: 2.0 },
      { key: 'UR', weight: 0.5 },
    ],
  ];

  for (let i = 0; i < uncommonSlotBases.length; i++) {
    const options = uncommonSlotBases[i];
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, specialLabel, userId);
    results.push({ rarity, file });
  }

  // --- Rare slot (1) ---
  const rareOptions = [
    { key: 'R', weight: 99.58 },
    { key: 'OUR', weight: 0.39 },
    { key: 'SEC', weight: 0.03 },
  ];
  {
    const rareRarity = pickWeighted(rareOptions);
    const rareFile = await pickForSlot(rareRarity, specialLabel, userId);
    results.push({ rarity: rareRarity, file: rareFile });
  }

  // Defensive: ensure we always return 8 slots
  if (!Array.isArray(results) || results.length !== 8) {
    console.warn('[drawPackSpecial] unexpected results length', { length: results.length });
  }

  return results;
}

module.exports = { drawPackSpecial };
