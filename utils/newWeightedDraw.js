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
]);

const otherUserIds = new Set([
 '1171127294413246567',//blacky
  '1334914199968677941',//blacky
]); 
const otherUserIds25 = new Set([
 '1171127294413246567',//blacky
  '1334914199968677941',//blacky
  '953552994232852490',
  '1188023588926795827',
  '1300468334474690583',
  '1416081468794339479'
]); 
const otherUserIds50 = new Set([
  '91098889796481024', //moo
  '91103688415776768',//moo2
  '647219814011502607',//illegal
  '875533483051712543',//weirdmj
  '495185224628699137',
  '578146378501324812',
  '975246037914624030'
]); 
const otherUserIdsTier75 = new Set([
]); 

// --- Overrides (unchanged) ---
const specialOverrides = {
  commonSlot1Options: [
    { key: 'C', weight: 87.40 },
    { key: 'S', weight: 12.00 },
    { key: 'HR', weight: 0.50 },
    { key: 'BDAY', weight: 0.10 }, //bday
  ],
  commonSlot2Options: [
    { key: 'C', weight: 82.00 },
    { key: 'S', weight: 12.00 },
    { key: 'OC', weight: 6.00 },
  ],
  commonSlot3Options: [
    { key: 'C', weight: 87.70 },
    { key: 'S', weight: 12.20 },
    { key: 'BDAY', weight: 0.10 }, //bday
  ],
  commonSlot4Options: [
    { key: 'C', weight: 87.70 },
    { key: 'S', weight: 12.00 },
    { key: 'HR', weight: 0.30 },
  ],
  uncommonSlotOptions: [
    [
      { key: 'U', weight: 69.25 },
      { key: 'RR', weight: 30.00 },
      { key: 'SY', weight: 0.75 },
    ],
    [
      { key: 'U', weight: 90.25 },
      { key: 'SR', weight: 9.00 },
      { key: 'SY', weight: 0.75 },
    ],
    [
      { key: 'U', weight: 92.50 },
      { key: 'OSR', weight: 6.00 },
      { key: 'UR', weight: 1.50 },
    ],
  ],
  rareOptions: [
    { key: 'R', weight: 98.74 },
    { key: 'OUR', weight: 1.17 },
    { key: 'OUR', weight: 0.09 },
  ],
};

const otherOverrides25 = {
  commonSlot1Options: [
    { key: 'C', weight: 97.90 },
    { key: 'S', weight: 2.00 },
    { key: 'HR', weight: 0.05 },
    { key: 'HR', weight: 0.05 },
  ],
  commonSlot2Options: [
    { key: 'C', weight: 97.00 },
    { key: 'S', weight: 2.00 },
    { key: 'OC', weight: 1.00 },
  ],
  commonSlot3Options: [
    { key: 'C', weight: 97.95 },
    { key: 'S', weight: 2.00 },
    { key: 'S', weight: 0.05 },
  ],
  commonSlot4Options: [
    { key: 'C', weight: 97.95 },
    { key: 'S', weight: 2.00 },
    { key: 'HR', weight: 0.05 },
  ],
  uncommonSlotOptions: [
    [
      { key: 'U', weight: 94.875 },
      { key: 'RR', weight: 5.00 },
      { key: 'SY', weight: 0.125 },
    ],
    [
      { key: 'U', weight: 98.375 },
      { key: 'SR', weight: 1.50 },
      { key: 'SY', weight: 0.125 },
    ],
    [
      { key: 'U', weight: 98.75 },
      { key: 'OSR', weight: 1.00 },
      { key: 'UR', weight: 0.25 },
    ],
  ],
  rareOptions: [
    { key: 'R', weight: 99.79 },   // adjusted -0.02 to make total exactly 100.00
    { key: 'OUR', weight: 0.195 },
    { key: 'SEC', weight: 0.015 },
  ],
};
const otherOverrides50 = {
  commonSlot1Options: [
    { key: 'C', weight: 97.90 },
    { key: 'S', weight: 2.00 },
    { key: 'HR', weight: 0.05 },
    { key: 'HR', weight: 0.05 },
  ],
  commonSlot2Options: [
    { key: 'C', weight: 97.00 },
    { key: 'S', weight: 2.00 },
    { key: 'OC', weight: 1.00 },
  ],
  commonSlot3Options: [
    { key: 'C', weight: 97.95 },
    { key: 'S', weight: 2.00 },
    { key: 'BDAY', weight: 0.05 },
  ],
  commonSlot4Options: [
    { key: 'C', weight: 97.95 },
    { key: 'S', weight: 2.00 },
    { key: 'HR', weight: 0.05 },
  ],
  uncommonSlotOptions: [
    [
      { key: 'U', weight: 94.875 },
      { key: 'RR', weight: 5.00 },
      { key: 'SY', weight: 0.125 },
    ],
    [
      { key: 'U', weight: 98.375 },
      { key: 'SR', weight: 1.50 },
      { key: 'SY', weight: 0.125 },
    ],
    [
      { key: 'U', weight: 98.75 },
      { key: 'OSR', weight: 1.00 },
      { key: 'UR', weight: 0.25 },
    ],
  ],
  rareOptions: [
    { key: 'R', weight: 99.79 },   // adjusted -0.02 to make total exactly 100.00
    { key: 'OUR', weight: 0.195 },
    { key: 'SEC', weight: 0.015 },
  ],
};

// --- Helper to choose override set for the user ---
function resolveOverrideSet(userId, useSpecialRates) {
  const idStr = String(userId);
  if (useSpecialRates && specialUserIds.has(idStr)) return specialOverrides;
  if (otherUserIds50.has(idStr)) return otherOverrides50;
  if (otherUserIds25.has(idStr)) return otherOverrides25;
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
      if (quota && typeof quota.pulls === 'number' && quota.pulls >= 0 && specialUserIds.has(idStr)) {
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
    { key: 'BDAY', weight: 0.1 },
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
    { key: 'BDAY', weight: 0.1 },
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
    { key: 'R', weight: 99.58 },
    { key: 'OUR', weight: 0.39 },
    { key: 'SEC', weight: 0.03 },
  ];
  const rareOptions = applyOverride(userId, rareBase, 'rareOptions', overrideSet);
  {
    const rareRarity = pickWeighted(rareOptions);
    const rareFile = pickFileFromPool(rareRarity, userId);
    results.push({ rarity: rareRarity, file: rareFile });
  }

  // Extra slot with appearance chance
  const extraChance = 0.02; // 10% chance to include the extra slot
  if (Math.random() < extraChance) {
    // Define the base rarity table for the extra slot here so you can edit it
    const extraBase = [
      // <-- edit these entries to the rarities you want for the extra slot
      { key: 'VAL', weight: 99.58 },
      { key: 'VAL', weight: 0.39 },
      { key: 'VAL', weight: 0.03 },
    ];

    // Allow overrides under 'extraOptions' in override sets; falls back to extraBase
    const extraOptions = applyOverride(userId, extraBase, 'extraOptions', overrideSet);
    const extraRarity = pickWeighted(extraOptions);
    const extraFile = pickFileFromPool(extraRarity, userId);
    results.push({ rarity: extraRarity, file: extraFile, slot: 'extra' });
  }

  return results;
}

module.exports = { drawPack };