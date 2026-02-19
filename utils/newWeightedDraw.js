// newWeightedDraw.js
const pools = require('../utils/loadImages');
const PullQuota = require('../models/PullQuota'); // kept from your original file
const { pickWeighted, buildSlotOptions, getUserProfile, getOverrides } = require('../utils/rates');

// --- Pool selection logic (kept as-is from your file) ---
const specialUserIds = new Set([]);

// NOTE: This set only affects *which image pool* is used (pools.other), not odds.
const otherUserIds = new Set([
]);

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
     // NEW: merge normal overrides with pity override
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
  const baseExtraChance = 0.02;
  const extraChance = baseExtraChance * (profile.extraSlotRate ?? 1.0);

  if (Math.random() < extraChance) {
    const extraBase = [
      { key: 'VAL', weight: 99.58 },
      { key: 'VAL', weight: 0.39 },
      { key: 'VAL', weight: 0.03 },
    ];
    const extraRarity = pickWeighted(extraBase); // do NOT scale extra odds
    const extraFile = pickFileFromPool(extraRarity, userId, useSpecialRates);
    results.push({ rarity: extraRarity, file: extraFile, slot: 'extra' });
  }

  return results;
}

module.exports = { drawPack };