// newWeightedDraw.js
const path = require('path');
const pools = require('../utils/loadImages');
const PullQuota = require('../models/PullQuota');
const { pickWeighted, buildSlotOptions, getUserProfile, getOverrides } = require('../utils/rates');

// --- Pool selection logic (kept as-is from your file) ---
const specialUserIds = new Set([]);
const otherUserIds = new Set([]);

/**
 * Extract a stable "card key" from a pool entry.
 * By default: uses filename WITHOUT extension.
 * Example: "/cards/EAS/Padoru 1.png" -> "Padoru 1"
 */
function cardKeyFromFile(filePath) {
  const base = path.basename(String(filePath));
  return base.replace(path.extname(base), '');
}

/**
 * Pick a file from a pool with optional per-card weights.
 *
 * @param {string} rarity
 * @param {string|number} userId
 * @param {boolean} useSpecialRates
 * @param {Object<string, number>|null} fileWeightsMap - map of cardKey -> weight
 * @param {number} unlistedWeight - weight used when a card isn't listed in the map (default 0)
 */
function pickFileFromPool(rarity, userId, useSpecialRates = false, fileWeightsMap = null, unlistedWeight = 0) {
  const idStr = String(userId);
  let pool = null;

  // Respect "useSpecialRates" gate (your original intent)
  if (
    useSpecialRates &&
    specialUserIds.has(idStr) &&
    pools.special &&
    Array.isArray(pools.special[rarity]) &&
    pools.special[rarity].length > 0
  ) {
    pool = pools.special[rarity];
  } else if (
    otherUserIds.has(idStr) &&
    pools.other &&
    Array.isArray(pools.other[rarity]) &&
    pools.other[rarity].length > 0
  ) {
    pool = pools.other[rarity];
  } else if (Array.isArray(pools[rarity]) && pools[rarity].length > 0) {
    pool = pools[rarity];
  }

  if (!pool || pool.length === 0) {
    throw new Error(`Pool for rarity "${rarity}" is empty or missing for user "${userId}"`);
  }

  // If no weights provided -> uniform random
  if (!fileWeightsMap || typeof fileWeightsMap !== 'object') {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Build weighted options based on the pool files
  const options = pool.map((file) => {
    const k = cardKeyFromFile(file);
    const w = (k in fileWeightsMap) ? Number(fileWeightsMap[k]) : Number(unlistedWeight);
    return { key: file, weight: isFinite(w) ? w : 0 };
  });

  // If all weights are <= 0, fall back to uniform random (safer than erroring)
  const total = options.reduce((s, o) => s + (o.weight > 0 ? o.weight : 0), 0);
  if (total <= 0) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // pickWeighted returns the "key" value, which we set as the file path
  return pickWeighted(options);
}

/**
 * DEFAULT per-card weight maps for the EXTRA slot.
 * Add any rarity here (EAS, EGG, VAL, etc.).
 *
 * Keys must match `cardKeyFromFile()` output:
 * - by default = filename WITHOUT extension
 */
const defaultExtraCardWeightsByRarity = {
  EAS: {
    "White Egg": 14.162666666666667,
    "Green Egg": 14.162666666666667,
    "Red Egg": 14.162666666666667,
    "Blue Egg": 14.162666666666667,
    "Purple Egg": 14.162666666666667,
    "Yellow Egg": 14.162666666666667,

    "Koyori 001": 0.833,
    "Hajime 101": 0.833,
    "Mumei 001": 0.833,
    "Pekora 001": 0.833,
    "Mio 001": 0.833,
    "Raden 101": 0.833,
    "Miko 001": 0.833,
    "Polka 001": 0.833,
    "Ririka 101": 0.833,
    "Ao 101": 0.833,
    "Shiori 001": 0.833,
    "Okayu 001": 0.833,
    "Bijou 001": 0.833,
    "Calli 001": 0.833,
    "Shion 001": 0.833,
    "Kanade 101": 0.833,
    "Watame 001": 0.833,
    "Nene 001": 0.833,

    "Easter X": 0.01,
    "Easter Y": 0.01,
    "Easter O": 0.01,
  },
};

// --- Main draw (async because of DB read)
// Accept an override flag so callers can decide special-rate eligibility before consuming the pull
async function drawPack(userId, useSpecialRatesOverride = null, opts = {}) {
  const results = [];
  const idStr = String(userId);

  // preserve original "special rate" eligibility gate
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
      useSpecialRates = false;
    }
  }

  const profile = getUserProfile(userId);

  // Common Slots
  const commonSlot1Base = [
    { key: 'C', weight: 94.8 },
    { key: 'S', weight: 5.0 },
    { key: 'HR', weight: 0.1 },
    { key: 'BDAY', weight: 0.1 },
  ];
  {
    const options = buildSlotOptions(commonSlot1Base, profile.pullRate, getOverrides(profile, 'normal', 'common1'));
    const rarity = pickWeighted(options);
    const file = pickFileFromPool(rarity, userId, useSpecialRates);
    results.push({ rarity, file });
  }

  const commonSlot2Base = [
    { key: 'C', weight: 93.0 },
    { key: 'S', weight: 5.0 },
    { key: 'OC', weight: 2.0 },
  ];
  {
    const options = buildSlotOptions(commonSlot2Base, profile.pullRate, getOverrides(profile, 'normal', 'common2'));
    const rarity = pickWeighted(options);
    const file = pickFileFromPool(rarity, userId, useSpecialRates);
    results.push({ rarity, file });
  }

  const commonSlot3Base = [
    { key: 'C', weight: 94.8 },
    { key: 'S', weight: 5.0 },
    { key: 'BDAY', weight: 0.1 },
  ];
  {
    const options = buildSlotOptions(commonSlot3Base, profile.pullRate, getOverrides(profile, 'normal', 'common3'));
    const rarity = pickWeighted(options);
    const file = pickFileFromPool(rarity, userId, useSpecialRates);
    results.push({ rarity, file });
  }

  const commonSlot4Base = [
    { key: 'C', weight: 94.8 },
    { key: 'S', weight: 5.0 },
    { key: 'HR', weight: 0.1 },
  ];
  {
    const options = buildSlotOptions(commonSlot4Base, profile.pullRate, getOverrides(profile, 'normal', 'common4'));
    const rarity = pickWeighted(options);
    const file = pickFileFromPool(rarity, userId, useSpecialRates);
    results.push({ rarity, file });
  }

  // Uncommon Slots
  const uncommonSlotBases = [
    [
      { key: 'U', weight: 87.75 },
      { key: 'RR', weight: 12.0 },
      { key: 'SY', weight: 0.25 },
    ],
    [
      { key: 'U', weight: 94.75 },
      { key: 'SR', weight: 5.0 },
      { key: 'SY', weight: 0.25 },
    ],
    [
      { key: 'U', weight: 95.5 },
      { key: 'OSR', weight: 4.0 },
      { key: 'UR', weight: 0.5 },
    ],
  ];

  for (let i = 0; i < uncommonSlotBases.length; i++) {
    const slotName = `uncommon${i + 1}`;
    const options = buildSlotOptions(uncommonSlotBases[i], profile.pullRate, getOverrides(profile, 'normal', slotName));
    const rarity = pickWeighted(options);
    const file = pickFileFromPool(rarity, userId, useSpecialRates);
    results.push({ rarity, file });
  }

  // Rare slot
  const rareBase = [
    { key: 'R', weight: 99.58 },
    { key: 'OUR', weight: 0.39 },
    { key: 'SEC', weight: 0.03 },
  ];
  {
    const baseOverrides = getOverrides(profile, 'normal', 'rare');
    const pityOverrides = (opts && opts.forceSEC) ? { SEC: 100 } : null;
    const mergedOverrides = pityOverrides
      ? { ...(baseOverrides || {}), ...pityOverrides }
      : baseOverrides;

    const options = buildSlotOptions(rareBase, profile.pullRate, mergedOverrides);
    const rareRarity = pickWeighted(options);
    const rareFile = pickFileFromPool(rareRarity, userId, useSpecialRates);
    results.push({ rarity: rareRarity, file: rareFile });
  }

  // Extra slot with appearance chance (ONLY chance changes; rarity odds unchanged)
  const baseExtraChance = 0.40; // 40% base chance for the extra slot to appear
  const extraChance = baseExtraChance * (profile.extraSlotRate ?? 1.0);

  if (Math.random() < extraChance) {
    const extraBase = [
      { key: 'EAS', weight: 99.99 },
      { key: 'EAS', weight: 0.01 },
    ];

    const extraRarity = pickWeighted(extraBase); // do NOT scale extra odds

    // Allow dynamic overrides via opts, fallback to defaults:
    const runtimeWeights = (opts.extraCardWeightsByRarity && opts.extraCardWeightsByRarity[extraRarity]) || null;
    const defaultWeights = defaultExtraCardWeightsByRarity[extraRarity] || null;
    const weightsToUse = runtimeWeights || defaultWeights;

    // If weightsToUse is null/undefined -> uniform random fallback inside pickFileFromPool
    const extraFile = pickFileFromPool(
      extraRarity,
      userId,
      useSpecialRates,
      weightsToUse,
      opts.unlistedExtraCardWeight ?? 0
    );

    results.push({ rarity: extraRarity, file: extraFile, slot: 'extra' });
  }

  return results;
}

module.exports = { drawPack };