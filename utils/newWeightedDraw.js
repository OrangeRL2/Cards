const fs = require('fs');
const path = require('path');
const pools = require('../utils/loadImages');
const PullQuota = require('../models/PullQuota'); // adjust path if needed

function rand() {
  return Math.random();
}

// Example: weights keyed by filename base (no extension)
const defaultEventWeights = {
  "Padoru 1": 20.0,
  "Padoru 2": 20.0,
  "Padoru 3": 20.0,
  "Padoru 4": 20.0,
  "Padoru 5": 10.0,
  "Padoru 6": 5.0,
  "Padoru 7": 4.0,
  "Padoru 8": 0.865,
  "Padoru 9": 0.12,
  "Padoru 0": 0.01,
  "Padoru X": 0.005,
};

const CustomEventWeights = {
   '91098889796481024': {
    "Padoru 1": 20.0,
  "Padoru 2": 20.0,
  "Padoru 3": 20.0,
  "Padoru 4": 20.0,
  "Padoru 5": 10.0,
  "Padoru 6": 5.0,
  "Padoru 7": 4.0,
  "Padoru 8": 0.865,
  "Padoru 9": 0.1,
  "Padoru 0": 0.03,
  "Padoru X": 0.005,
   },
    '91103688415776768': {
    "Padoru 1": 20.0,
  "Padoru 2": 20.0,
  "Padoru 3": 20.0,
  "Padoru 4": 20.0,
  "Padoru 5": 10.0,
  "Padoru 6": 5.0,
  "Padoru 7": 4.0,
  "Padoru 8": 0.865,
  "Padoru 9": 0.1,
  "Padoru 0": 0.03,
  "Padoru X": 0.005,
   },
    '6': {
  "Padoru 1": 20.0,
  "Padoru 2": 20.0,
  "Padoru 3": 20.0,
  "Padoru 4": 20.0,
  "Padoru 5": 10.0,
  "Padoru 6": 5.0,
  "Padoru 7": 4.0,
  "Padoru 8": 0.865,
  "Padoru 9": 0.1,
  "Padoru 0": 0.03,
  "Padoru X": 0.005,
   }
};

// Pick an index from an array of numeric weights
function pickWeightedIndex(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return -1;
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function pickFileFromEventPool(rarityKey, userId, weightsMap = defaultEventWeights) {
  // pools is the object returned by loadPools()
  // rarityKey should be 'XMAS' in your case
  const files = pools[rarityKey];
  if (!files || files.length === 0) return null;

  // Build arrays of filenames (base) and weights aligned with files[]
  const weights = [];
  for (const f of files) {
    const base = path.basename(f, path.extname(f)); // e.g., "Padoru 1"
    // If exact base name exists in weightsMap, use it; otherwise fallback to small default weight
    const w = (Object.prototype.hasOwnProperty.call(weightsMap, base) ? weightsMap[base] : 1.0);
    weights.push(w);
  }

  const idx = pickWeightedIndex(weights);
  return idx >= 0 ? files[idx] : files[Math.floor(Math.random() * files.length)];
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
  '4',
  '',
]);

const otherUserIds = new Set([
  '',
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
    { key: 'R', weight: 99.40 },
    { key: 'OUR', weight: 0.55 },
    { key: 'SEC', weight: 0.05 },
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
      if (quota && typeof quota.pulls === 'number' && quota.pulls === 0 && specialUserIds.has(idStr)) {
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
    { key: 'R', weight: 99.60 },
    { key: 'OUR', weight: 0.39 },
    { key: 'SEC', weight: 0.03 },
  ];
  const rareOptions = applyOverride(userId, rareBase, 'rareOptions', overrideSet);
  {
    const rareRarity = pickWeighted(rareOptions);
    const rareFile = pickFileFromPool(rareRarity, userId);
    results.push({ rarity: rareRarity, file: rareFile });
  }

 // Event slot (XMAS) with per-file weights
const eventBase = [
  { key: 'XMAS', weight: 100.0 },
];
const eventOptions = applyOverride(userId, eventBase, 'eventOptions', overrideSet);
{
  const eventRarity = pickWeighted(eventOptions);

  // If eventRarity is XMAS, pick using per-file weights
  let eventFile = null;
  if (eventRarity === 'XMAS') {
    // Resolve weights map precedence:
    // 1) overrideSet.eventWeights[idStr] (if overrideSet stores per-user maps)
    // 2) CustomEventWeights[idStr] (your explicit per-user map)
    // 3) overrideSet.eventWeights (global map)
    // 4) defaultEventWeights (fallback)
    let weightsMap = null;

    // 1) per-user map inside overrideSet
    if (overrideSet && overrideSet.eventWeights && overrideSet.eventWeights[idStr]) {
      weightsMap = overrideSet.eventWeights[idStr];
    }

    // 2) explicit per-user map you defined (CustomEventWeights)
    if (!weightsMap && CustomEventWeights && CustomEventWeights[idStr]) {
      weightsMap = CustomEventWeights[idStr];
    }

    // 3) global eventWeights in overrideSet
    if (!weightsMap && overrideSet && overrideSet.eventWeights && typeof overrideSet.eventWeights === 'object') {
      weightsMap = overrideSet.eventWeights;
    }

    // 4) fallback to default
    if (!weightsMap) weightsMap = defaultEventWeights;

    // Validate weightsMap is an object with at least one numeric value
    const validWeights = weightsMap && typeof weightsMap === 'object' &&
      Object.keys(weightsMap).some(k => typeof weightsMap[k] === 'number' && !Number.isNaN(weightsMap[k]));

    if (!validWeights) {
      console.warn('Resolved event weights map is invalid for user', idStr, '; falling back to defaultEventWeights.');
      weightsMap = defaultEventWeights;
    }

    // pick using the resolved weights map; pickFileFromEventPool accepts a weightsMap param
    try {
      eventFile = pickFileFromEventPool('XMAS', userId, weightsMap);
    } catch (e) {
      console.warn('Event file pick failed for user', idStr, e);
      // fallback to generic pool pick
      try { eventFile = pickFileFromPool('XMAS', userId); } catch (e2) { eventFile = null; }
    }
  } else {
    // fallback to existing behavior for other event rarities
    try { eventFile = pickFileFromPool(eventRarity, userId); } catch (e) { eventFile = null; }
  }

  results.push({ rarity: eventRarity, file: eventFile });
}
  return results;
}

module.exports = { drawPack };