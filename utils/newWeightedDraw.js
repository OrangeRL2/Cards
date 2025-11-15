// newWeightedDraw.js
const pools = require('../utils/loadImages');

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

function pickFileFromPool(rarity) {
  const choices = pools[rarity];
  if (!choices || choices.length === 0) {
    throw new Error(`Pool for rarity "${rarity}" is empty or missing`);
  }
  return choices[Math.floor(Math.random() * choices.length)];
}

// Add all special user IDs here (strings)
const specialUserIds = new Set([
  '409717160995192832',
  '153551890976735232',
]);

// Direct overrides for the special users with the 3rd option's weight tripled
const specialOverrides = {
  commonSlot12Options: [
    { key: 'C', weight: 95.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 3.0 }, // 1.0 * 3
  ],
  commonSlot3Options: [
    { key: 'C', weight: 95.0 },
    { key: 'S', weight: 4.0 },
    { key: 'bday', weight: 3.0 }, // 1.0 * 3
  ],
  commonSlot4Options: [
    { key: 'C', weight: 95.0 },
    { key: 'S', weight: 4.5 },
    { key: 'HR', weight: 1.5 }, // 0.5 * 3
  ],
  uncommonSlotOptions: [
    [
      { key: 'U', weight: 84.0 },
      { key: 'RR', weight: 15.0 },
      { key: 'SY', weight: 3.0 }, // 1.0 * 3
    ],
    [
      { key: 'U', weight: 94.0 },
      { key: 'SR', weight: 5.0 },
      { key: 'SY', weight: 3.0 }, // 1.0 * 3
    ],
    [
      { key: 'U', weight: 95.0 },
      { key: 'OSR', weight: 4.0 },
      { key: 'UR', weight: 3.0 }, // 1.0 * 3
    ],
  ],
  rareOptions: [
    { key: 'R', weight: 98.15 },
    { key: 'OUR', weight: 1.70 },
    { key: 'SEC', weight: 0.45 }, // 0.15 * 3
  ],
};

// Helper: return override when userId is in specialUserIds
function applyOverride(userId, base, override) {
  if (specialUserIds.has(String(userId)) && override !== undefined) return override;
  return base;
}

function drawPack(userId) {
  const results = [];

  // Common slots
  // Slot 1 and Slot 2 (same odds)
  const commonSlot12Base = [
    { key: 'C', weight: 95.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 1.0 },
  ];
  const commonSlot12Options = applyOverride(userId, commonSlot12Base, specialOverrides.commonSlot12Options);
  for (let i = 0; i < 2; i++) {
    const rarity = pickWeighted(commonSlot12Options);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Slot 3 (common with bday instead of OC/HR)
  const commonSlot3Base = [
    { key: 'C', weight: 95.0 },
    { key: 'S', weight: 4.0 },
    { key: 'bday', weight: 1.0 },
  ];
  const commonSlot3Options = applyOverride(userId, commonSlot3Base, specialOverrides.commonSlot3Options);
  {
    const rarity = pickWeighted(commonSlot3Options);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Slot 4 (common with small HR chance)
  const commonSlot4Base = [
    { key: 'C', weight: 95.0 },
    { key: 'S', weight: 4.5 },
    { key: 'HR', weight: 0.5 },
  ];
  const commonSlot4Options = applyOverride(userId, commonSlot4Base, specialOverrides.commonSlot4Options);
  {
    const rarity = pickWeighted(commonSlot4Options);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Uncommon slots (slot-specific)
  const uncommonSlotBase = [
    [
      { key: 'U', weight: 84.0 },
      { key: 'RR', weight: 15.0 },
      { key: 'SY', weight: 1.0 },
    ],
    [
      { key: 'U', weight: 94.0 },
      { key: 'SR', weight: 5.0 },
      { key: 'SY', weight: 1.0 },
    ],
    [
      { key: 'U', weight: 95.0 },
      { key: 'OSR', weight: 4.0 },
      { key: 'UR', weight: 1.0 },
    ],
  ];
  const uncommonSlotOptions = applyOverride(userId, uncommonSlotBase, specialOverrides.uncommonSlotOptions);
  for (let s = 0; s < uncommonSlotOptions.length; s++) {
    const rarity = pickWeighted(uncommonSlotOptions[s]);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Rare slot
  const rareBase = [
    { key: 'R', weight: 99.35 },
    { key: 'OUR', weight: 0.50 },
    { key: 'SEC', weight: 0.15 },
  ];
  const rareOptions = applyOverride(userId, rareBase, specialOverrides.rareOptions);
  const rareRarity = pickWeighted(rareOptions);
  const rareFile = pickFileFromPool(rareRarity);
  results.push({ rarity: rareRarity, file: rareFile });

  return results;
}

module.exports = { drawPack };
