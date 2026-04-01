// utils/extraSlot.js
const path = require('path');
const pools = require('./loadImages');
const { pickWeighted } = require('./rates');

/**
 * Extract a stable "card key" from a pool entry.
 * Uses filename WITHOUT extension.
 * Example: "/cards/EAS/Padoru 1.png" -> "Padoru 1"
 */
function cardKeyFromFile(filePath) {
  const base = path.basename(String(filePath));
  return base.replace(path.extname(base), '');
}

/**
 * DEFAULT per-card weight maps for the EXTRA slot.
 * Keys must match cardKeyFromFile() output.
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

// --- Pool selection logic (mirrors newWeightedDraw.js) ---
const specialUserIds = new Set([]);
const otherUserIds = new Set([]);

/**
 * Pick a file from a pool with optional per-card weights.
 *
 * @param {string} rarity
 * @param {string|number} userId
 * @param {boolean} useSpecialRates
 * @param {Object<string, number>|null} fileWeightsMap
 * @param {number} unlistedWeight
 */
function pickFileFromPool(rarity, userId, useSpecialRates = false, fileWeightsMap = null, unlistedWeight = 0) {
  const idStr = String(userId);
  let pool = null;

  // Respect "useSpecialRates" gate (same structure as newWeightedDraw.js)
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

  // No weights provided -> uniform random
  if (!fileWeightsMap || typeof fileWeightsMap !== 'object') {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Build weighted options based on the pool files
  const options = pool.map((file) => {
    const k = cardKeyFromFile(file);
    const w = (k in fileWeightsMap) ? Number(fileWeightsMap[k]) : Number(unlistedWeight);
    return { key: file, weight: Number.isFinite(w) ? w : 0 };
  });

  // If all weights are <= 0, fall back to uniform random
  const total = options.reduce((s, o) => s + (o.weight > 0 ? o.weight : 0), 0);
  if (total <= 0) {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  return pickWeighted(options);
}

/**
 * Roll the extra slot, using the SAME behavior as newWeightedDraw.js:
 * - chance = 0.40 * profile.extraSlotRate
 * - rarity is whatever your config picks (currently always "EAS" in your code)
 * - card is selected using runtime weights or defaultExtraCardWeightsByRarity
 */
function rollExtraSlot(userId, profile, useSpecialRates = false, opts = {}) {
  const baseExtraChance = 0.40;
  const extraChance = baseExtraChance * (profile.extraSlotRate ?? 1.0);

  if (Math.random() >= extraChance) return null;

  // In newWeightedDraw.js, your extra slot ends up always being "EAS"
  // (extraBase had duplicate 'EAS' keys). We keep behavior consistent.
  const extraRarity = 'EAS';

  const runtimeWeights =
    (opts.extraCardWeightsByRarity && opts.extraCardWeightsByRarity[extraRarity]) || null;

  const defaultWeights =
    defaultExtraCardWeightsByRarity[extraRarity] || null;

  const weightsToUse = runtimeWeights || defaultWeights;

  const extraFile = pickFileFromPool(
    extraRarity,
    userId,
    useSpecialRates,
    weightsToUse,
    opts.unlistedExtraCardWeight ?? 0
  );

  return { rarity: extraRarity, file: extraFile, slot: 'extra' };
}

module.exports = {
  defaultExtraCardWeightsByRarity,
  pickFileFromPool,
  rollExtraSlot,

  // exported in case you later want to configure these from elsewhere
  specialUserIds,
  otherUserIds,
};