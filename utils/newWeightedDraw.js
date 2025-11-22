const pools = require('../utils/loadImages');
const PullQuota = require('../models/PullQuota'); // adjust path if needed

function rand() {
  return Math.random();
}

function pickWeighted(options) {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = rand() * total;
  for (const o of options) {
    if (r <= o.weight) return o.key;
    r -= o.weight;
  }
  return options[options.length - 1].key;
}

// --- User groups ---
const specialUserIds = new Set([
  '153551890976735232',
  '',
]);

const otherUserIds = new Set([
  //'1171127294413246567',
  '409717160995192832',
]);

// --- Overrides (unchanged) ---
const specialOverrides = {
commonSlot1Options: [
    { key: 'C', weight: 95.7 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
    { key: 'bday', weight: 0.2 },
  ],
  commonSlot2Options: [
    { key: 'C', weight: 93.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 3.0 },
  ],
  commonSlot3Options: [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'bday', weight: 0.1 },
  ],
  commonSlot4Options: [
    { key: 'C', weight: 95.8 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.2 },
  ],
  uncommonSlotOptions: [
    [
      { key: 'U', weight: 86.9 },
      { key: 'RR', weight: 12.5 },
      { key: 'SY', weight: 0.6 },
    ],
    [
      { key: 'U', weight: 94.5 },
      { key: 'SR', weight: 4.0 },
      { key: 'SY', weight: 1.5 },
    ],
    [
      { key: 'U', weight: 94.0 },
      { key: 'OSR', weight: 3.0 },
      { key: 'UR', weight: 3.0 },
    ],
  ],
  rareOptions: [
    { key: 'R', weight: 99.20 },
    { key: 'OUR', weight: 0.55 },
    { key: 'SEC', weight: 0.25 },
  ],
};

const otherOverrides = {
  commonSlot1Options: [
    { key: 'C', weight: 95.7 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
    { key: 'bday', weight: 0.2 },
  ],
  commonSlot2Options: [
    { key: 'C', weight: 93.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 3.0 },
  ],
  commonSlot3Options: [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'bday', weight: 0.1 },
  ],
  commonSlot4Options: [
    { key: 'C', weight: 95.8 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.2 },
  ],
  uncommonSlotOptions: [
    [
      { key: 'U', weight: 86.9 },
      { key: 'RR', weight: 12.5 },
      { key: 'SY', weight: 0.6 },
    ],
    [
      { key: 'U', weight: 94.5 },
      { key: 'SR', weight: 4.0 },
      { key: 'SY', weight: 1.5 },
    ],
    [
      { key: 'U', weight: 94.0 },
      { key: 'OSR', weight: 3.0 },
      { key: 'UR', weight: 3.0 },
    ],
  ],
  rareOptions: [
    { key: 'R', weight: 99.20 },
    { key: 'OUR', weight: 0.55 },
    { key: 'SEC', weight: 0.25 },
  ],
};

// --- Helper to choose override set for the user ---
function resolveOverrideSet(userId, useSpecialRates) {
  const idStr = String(userId);
  if (useSpecialRates && specialUserIds.has(idStr)) return specialOverrides;
  if (otherUserIds.has(idStr)) return otherOverrides;
  return null; // indicates use base
}

function applyOverride(userId, base, key, overrideSet) {
  if (overrideSet && overrideSet[key] !== undefined && overrideSet[key] !== null) {
    return overrideSet[key];
  }
  return base;
}

// New: pick file from pool with optional per-user-group pools support
function pickFileFromPool(rarity, userId) {
  const idStr = String(userId);

  let pool = null;

  if (specialUserIds.has(idStr) && pools.special && Array.isArray(pools.special[rarity]) && pools.special[rarity].length > 0) {
    pool = pools.special[rarity];
  } else if (otherUserIds.has(idStr) && pools.other && Array.isArray(pools.other[rarity]) && pools.other[rarity].length > 0) {
    pool = pools.other[rarity];
  } else if (Array.isArray(pools[rarity]) && pools[rarity].length > 0) {
    pool = pools[rarity];
  }

  if (!pool || pool.length === 0) {
    throw new Error(`Pool for rarity "${rarity}" is empty or missing for user "${userId}"`);
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

// --- Main draw (async because of DB read)
// Accept an override flag so callers can decide special-rate eligibility before consuming the pull
async function drawPack(userId, useSpecialRatesOverride = null) {
  const results = [];
  const idStr = String(userId);

  // decide whether to use special rates: prefer explicit override if provided
  let useSpecialRates = false;
  if (useSpecialRatesOverride !== null) {
    useSpecialRates = Boolean(useSpecialRatesOverride);
  } else {
    try {
      const quota = await PullQuota.findOne({ userId: idStr }).lean().exec();
      if (quota && typeof quota.pulls === 'number' && quota.pulls <= 12 && specialUserIds.has(idStr)) {
        useSpecialRates = true;
      }
    } catch (err) {
      // DB error: fallback to false (do not apply special rates)
      useSpecialRates = false;
    }
  }

  const overrideSet = resolveOverrideSet(userId, useSpecialRates);

  // Common Slots
  const commonSlot1Base = [
    { key: 'C', weight: 95.8 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
    { key: 'bday', weight: 0.1 },
  ];
  const commonSlot1Options = applyOverride(userId, commonSlot1Base, 'commonSlot1Options', overrideSet);
  {
    const rarity = pickWeighted(commonSlot1Options);
    const file = pickFileFromPool(rarity, userId);
    results.push({ rarity, file });
  }

  const commonSlot2Base = [
    { key: 'C', weight: 94.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 2.0 },
  ];
  const commonSlot2Options = applyOverride(userId, commonSlot2Base, 'commonSlot2Options', overrideSet);
  {
    const rarity = pickWeighted(commonSlot2Options);
    const file = pickFileFromPool(rarity, userId);
    results.push({ rarity, file });
  }

  const commonSlot3Base = [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'bday', weight: 0.1 },
  ];
  const commonSlot3Options = applyOverride(userId, commonSlot3Base, 'commonSlot3Options', overrideSet);
  {
    const rarity = pickWeighted(commonSlot3Options);
    const file = pickFileFromPool(rarity, userId);
    results.push({ rarity, file });
  }

  const commonSlot4Base = [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
  ];
  const commonSlot4Options = applyOverride(userId, commonSlot4Base, 'commonSlot4Options', overrideSet);
  {
    const rarity = pickWeighted(commonSlot4Options);
    const file = pickFileFromPool(rarity, userId);
    results.push({ rarity, file });
  }

  // Uncommon Slots (note: overrides provided as uncommonSlotOptions array; pick per-slot index)
  const uncommonSlotBases = [
    [
      { key: 'U', weight: 87.0 },
      { key: 'RR', weight: 12.5 },
      { key: 'SY', weight: 0.5 },
    ],
    [
      { key: 'U', weight: 95.5 },
      { key: 'SR', weight: 4.0 },
      { key: 'SY', weight: 0.5 },
    ],
    [
      { key: 'U', weight: 96.0 },
      { key: 'OSR', weight: 3.0 },
      { key: 'UR', weight: 1.0 },
    ],
  ];

  const uncommonOverrideSet = overrideSet && overrideSet.uncommonSlotOptions ? overrideSet.uncommonSlotOptions : null;

  for (let i = 0; i < uncommonSlotBases.length; i++) {
    const base = uncommonSlotBases[i];
    const key = `uncommonSlot${i + 1}Options`;
    const options = uncommonOverrideSet && Array.isArray(uncommonOverrideSet[i]) ? uncommonOverrideSet[i] : base;
    const rarity = pickWeighted(options);
    const file = pickFileFromPool(rarity, userId);
    results.push({ rarity, file });
  }

  // Rare slot
  const rareBase = [
    { key: 'R', weight: 99.40 },
    { key: 'OUR', weight: 0.55 },
    { key: 'SEC', weight: 0.05 },
  ];
  const rareOptions = applyOverride(userId, rareBase, 'rareOptions', overrideSet);
  {
    const rareRarity = pickWeighted(rareOptions);
    const rareFile = pickFileFromPool(rareRarity, userId);
    results.push({ rarity: rareRarity, file: rareFile });
  }

  return results;
}

module.exports = { drawPack };
