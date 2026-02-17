// utils/drawPackBoss.js
const path = require('path');
const pools = require('./loadImages');
const { pickCardFromRarityFolder } = require('./cardPicker');

function rand() { return Math.random(); }

// --- NEW: Boss alias exceptions map -----------------------------------------
// When the boss bias is 'Mel', we will pick uniformly from this list.
// You can add more keys as needed. Keys are case-sensitive to whatever your
// folder/label system uses.
const bossAliasMap = {
  Fuwawa: ['Fuwawa','Mococo', 'Fuwamoco'],
};

// Helper to pick uniformly from an array (no weights)
function uniformPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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

function fallbackPickFromPools(rarity, userId) {
  if (pools.special && pools.special[rarity] && pools.special[rarity].length > 0) {
    return pools.special[rarity][Math.floor(Math.random() * pools.special[rarity].length)];
  }
  if (pools.other && pools.other[rarity] && pools.other[rarity].length > 0) {
    return pools.other[rarity][Math.floor(Math.random() * pools.other[rarity].length)];
  }
  if (pools[rarity] && pools[rarity].length > 0) {
    return pools[rarity][Math.floor(Math.random() * pools[rarity].length)];
  }
  return `${rarity}-unknown-001.png`;
}

// --- UPDATED: pickForSlot to support alias exceptions -----------------------
// Behavior:
//  - If boss bias triggers (10%): build a candidate set.
//      * If bossLabel has aliases, pick uniformly among the aliases.
//        (equal chance for every alias in the array)
//      * If there are no aliases for bossLabel, use [bossLabel] as the only candidate.
//  - Try the first selected candidate; if it fails, try the remaining candidates
//    (order randomized by the first pick) before global fallback.
//  - All attempts keep `avoidImmediateRepeat: true`.
async function pickForSlot(rarity, bossLabel, userId) {
  const tryBoss = !!bossLabel && Math.random() < 0.1; // 10% boss bias as in your original file
  if (tryBoss) {
    try {
      // If aliases exist for the provided bossLabel, use them; otherwise, fall back to the label itself.
      const aliases = bossAliasMap[bossLabel];
      const candidates = Array.from(
        new Set((Array.isArray(aliases) && aliases.length > 0) ? aliases : [bossLabel])
      );

      // Ensure equal chance among *alias* options by picking the first attempt uniformly.
      const first = uniformPick(candidates);
      const ordered = [first, ...candidates.filter(c => c !== first)];

      for (const candidateLabel of ordered) {
        try {
          const picked = await pickCardFromRarityFolder(rarity, candidateLabel, { avoidImmediateRepeat: true });
          if (picked) return picked;
        } catch (err) {
          // continue to next candidate
        }
      }
      // If all alias candidates fail, we fall through to the global fallback below.
    } catch (err) {
      // fall through to global fallback
    }
  }

  // Global fallback path (unchanged)
  try {
    const fallback = await pickCardFromRarityFolder(rarity, null, { avoidImmediateRepeat: true });
    if (fallback) return fallback;
  } catch (err) { /* fallthrough */ }

  try {
    const raw = fallbackPickFromPools(rarity, userId);
    return path.basename(raw, path.extname(raw));
  } catch (err) {
    console.error('[drawPackBoss] final fallback error', { rarity, err });
    return `${rarity}-unknown-001`;
  }
}

async function drawPackBoss(userId, bossLabel) {
  const results = [];

  const commonSlot1Options = [
    { key: 'C', weight: 95.8 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
    { key: 'BDAY', weight: 0.1 },
  ];
  {
    const rarity = pickWeighted(commonSlot1Options);
    const file = await pickForSlot(rarity, bossLabel, userId);
    results.push({ rarity, file });
  }

  const commonSlot2Options = [
    { key: 'C', weight: 94.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 2.0 },
  ];
  {
    const rarity = pickWeighted(commonSlot2Options);
    const file = await pickForSlot(rarity, bossLabel, userId);
    results.push({ rarity, file });
  }

  const commonSlot3Options = [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'BDAY', weight: 0.1 },
  ];
  {
    const rarity = pickWeighted(commonSlot3Options);
    const file = await pickForSlot(rarity, bossLabel, userId);
    results.push({ rarity, file });
  }

  const commonSlot4Options = [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
  ];
  {
    const rarity = pickWeighted(commonSlot4Options);
    const file = await pickForSlot(rarity, bossLabel, userId);
    results.push({ rarity, file });
  }

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
    const file = await pickForSlot(rarity, bossLabel, userId);
    results.push({ rarity, file });
  }

  const rareOptions = [
    { key: 'R', weight: 99.58 },
    { key: 'OUR', weight: 0.39 },
    { key: 'SEC', weight: 0.03 },
  ];
  {
    const rareRarity = pickWeighted(rareOptions);
    const rareFile = await pickForSlot(rareRarity, bossLabel, userId);
    results.push({ rarity: rareRarity, file: rareFile });
  }

  if (!Array.isArray(results) || results.length !== 8) {
    console.warn('[drawPackBoss] unexpected results length', { length: results.length });
  }
  return results;
}

module.exports = { drawPackBoss };