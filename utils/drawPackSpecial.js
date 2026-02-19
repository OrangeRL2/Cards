// utils/drawPackSpecial.js
const path = require('path');
const pools = require('./loadImages');
const { pickCardFromRarityFolder } = require('./cardPicker');
const { pickWeighted, buildSlotOptions, getUserProfile, getOverrides } = require('./rates');

function fallbackPickFromPools(rarity) {
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

async function pickForSlot(rarity, specialLabel) {
  if (specialLabel) {
    try {
      const picked = await pickCardFromRarityFolder(rarity, specialLabel, { avoidImmediateRepeat: true });
      if (picked) return picked;
    } catch (err) {
      // fall through
    }
  }

  try {
    const fallback = await pickCardFromRarityFolder(rarity, null, { avoidImmediateRepeat: true });
    if (fallback) return fallback;
  } catch (err) {
    // fall through
  }

  const raw = fallbackPickFromPools(rarity);
  return path.basename(raw, path.extname(raw));
}

async function drawPackSpecial(userId, specialLabel, opts = {}) {
  const results = [];
  const profile = getUserProfile(userId);
  const rate = profile.specialPullRate;

  // --- Common slots (4) ---
  const commonSlot1Base = [
    { key: 'C', weight: 93.8 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 1.1 },
    { key: 'BDAY', weight: 1.1 },
  ];
  {
    const options = buildSlotOptions(commonSlot1Base, rate, getOverrides(profile, 'special', 'common1'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, specialLabel);
    results.push({ rarity, file });
  }

  const commonSlot2Base = [
    { key: 'C', weight: 94.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 2.0 },
  ];
  {
    const options = buildSlotOptions(commonSlot2Base, rate, getOverrides(profile, 'special', 'common2'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, specialLabel);
    results.push({ rarity, file });
  }

  const commonSlot3Base = [
    { key: 'C', weight: 94.9 },
    { key: 'S', weight: 4.0 },
    { key: 'BDAY', weight: 1.1 },
  ];
  {
    const options = buildSlotOptions(commonSlot3Base, rate, getOverrides(profile, 'special', 'common3'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, specialLabel);
    results.push({ rarity, file });
  }

  const commonSlot4Base = [
    { key: 'C', weight: 94.9 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 1.1 },
  ];
  {
    const options = buildSlotOptions(commonSlot4Base, rate, getOverrides(profile, 'special', 'common4'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, specialLabel);
    results.push({ rarity, file });
  }

  // --- Uncommon slots (3) ---
  const uncommonSlotBases = [
    [
      { key: 'U', weight: 88.75 },
      { key: 'RR', weight: 10.0 },
      { key: 'SY', weight: 1.25 },
    ],
    [
      { key: 'U', weight: 95.75 },
      { key: 'SR', weight: 3.0 },
      { key: 'SY', weight: 1.25 },
    ],
    [
      { key: 'U', weight: 95.5 },
      { key: 'OSR', weight: 3.0 },
      { key: 'UR', weight: 1.5 },
    ],
  ];

  for (let i = 0; i < uncommonSlotBases.length; i++) {
    const slotName = `uncommon${i + 1}`;
    const options = buildSlotOptions(uncommonSlotBases[i], rate, getOverrides(profile, 'special', slotName));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, specialLabel);
    results.push({ rarity, file });
  }

  // --- Rare slot (1) ---
  const rareBase = [
    { key: 'R', weight: 99.1 },
    { key: 'OUR', weight: 0.9 },
    { key: 'SEC', weight: 0.1 },
  ];
  {
      const baseOverrides = getOverrides(profile, 'special', 'rare');
    const pityOverrides = (opts && opts.forceSEC) ? { SEC: 100, OUR:0, R:0 } : null;
    const mergedOverrides = pityOverrides
      ? { ...(baseOverrides || {}), ...pityOverrides }
      : baseOverrides;

    const options = buildSlotOptions(rareBase, rate, mergedOverrides);
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, specialLabel);
    results.push({ rarity, file });
  }

  if (!Array.isArray(results) || results.length !== 8) {
    console.warn('[drawPackSpecial] unexpected results length', { length: results.length });
  }

  return results;
}

module.exports = { drawPackSpecial };