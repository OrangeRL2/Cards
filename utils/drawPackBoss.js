// utils/drawPackBoss.js
const path = require('path');
const pools = require('./loadImages');
const { pickCardFromRarityFolder } = require('./cardPicker');
const { pickWeighted, buildSlotOptions, getUserProfile, getOverrides } = require('./rates');

// --- Boss alias exceptions map (kept from your file)
const bossAliasMap = {
  Fuwawa: ['Fuwawa', 'Mococo', 'Fuwamoco'],
};

function uniformPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

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

async function pickForSlot(rarity, bossLabel) {
  const tryBoss = !!bossLabel && Math.random() < 0.1; // 10% boss bias
  if (tryBoss) {
    try {
      const aliases = bossAliasMap[bossLabel];
      const candidates = Array.from(new Set((Array.isArray(aliases) && aliases.length > 0) ? aliases : [bossLabel]));
      const first = uniformPick(candidates);
      const ordered = [first, ...candidates.filter((c) => c !== first)];

      for (const candidateLabel of ordered) {
        try {
          const picked = await pickCardFromRarityFolder(rarity, candidateLabel, { avoidImmediateRepeat: true });
          if (picked) return picked;
        } catch (err) {
          // continue
        }
      }
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

async function drawPackBoss(userId, bossLabel) {
  const results = [];
  const profile = getUserProfile(userId);

  // Common slots (4)
  const commonSlot1Base = [
    { key: 'C', weight: 95.8 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
    { key: 'BDAY', weight: 0.1 },
  ];
  {
    const options = buildSlotOptions(commonSlot1Base, profile.pullRate, getOverrides(profile, 'boss', 'common1'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, bossLabel);
    results.push({ rarity, file });
  }

  const commonSlot2Base = [
    { key: 'C', weight: 94.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 2.0 },
  ];
  {
    const options = buildSlotOptions(commonSlot2Base, profile.pullRate, getOverrides(profile, 'boss', 'common2'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, bossLabel);
    results.push({ rarity, file });
  }

  const commonSlot3Base = [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'BDAY', weight: 0.1 },
  ];
  {
    const options = buildSlotOptions(commonSlot3Base, profile.pullRate, getOverrides(profile, 'boss', 'common3'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, bossLabel);
    results.push({ rarity, file });
  }

  const commonSlot4Base = [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
  ];
  {
    const options = buildSlotOptions(commonSlot4Base, profile.pullRate, getOverrides(profile, 'boss', 'common4'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, bossLabel);
    results.push({ rarity, file });
  }

  // Uncommon slots (3)
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
    const slotName = `uncommon${i + 1}`;
    const options = buildSlotOptions(uncommonSlotBases[i], profile.pullRate, getOverrides(profile, 'boss', slotName));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, bossLabel);
    results.push({ rarity, file });
  }

  // Rare slot (1)
  const rareBase = [
    { key: 'R', weight: 99.58 },
    { key: 'OUR', weight: 0.39 },
    { key: 'SEC', weight: 0.03 },
  ];
  {
    const options = buildSlotOptions(rareBase, profile.pullRate, getOverrides(profile, 'boss', 'rare'));
    const rareRarity = pickWeighted(options);
    const rareFile = await pickForSlot(rareRarity, bossLabel);
    results.push({ rarity: rareRarity, file: rareFile });
  }

  if (!Array.isArray(results) || results.length !== 8) {
    console.warn('[drawPackBoss] unexpected results length', { length: results.length });
  }

  return results;
}

module.exports = { drawPackBoss };