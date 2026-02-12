// utils/drawPackBoss.js
const path = require('path');
const pools = require('./loadImages');
const { pickCardFromRarityFolder } = require('./cardPicker');

function rand() { return Math.random(); }
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

async function pickForSlot(rarity, bossLabel, userId) {
  const tryBoss = !!bossLabel && Math.random() < 0.1;

  if (tryBoss) {
    try {
      const picked = await pickCardFromRarityFolder(rarity, bossLabel, { avoidImmediateRepeat: true });
      if (picked) return picked;
    } catch (err) { /* fallthrough */ }
  }

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
