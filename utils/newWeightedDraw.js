// newWeightedDraw.js
const pools = require('../utils/loadImages');

function rand() {
  return Math.random();
}

function pickWeighted(options) {
  // options: [{ key: 'C', weight: 95 }, ...]
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

function drawPack() {
  const results = [];

  // Common slots
  // Slot 1 and Slot 2 (same odds)
  const commonSlot12Options = [
    { key: 'C', weight: 95.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 1.0 },
  ];
  for (let i = 0; i < 2; i++) {
    const rarity = pickWeighted(commonSlot12Options);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Slot 3 (common with bday instead of OC/HR)
  const commonSlot3Options = [
    { key: 'C', weight: 95.0 },
    { key: 'S', weight: 4.0 },
    { key: 'bday', weight: 1.0 }, // use key your pools expect, adjust if different
  ];
  {
    const rarity = pickWeighted(commonSlot3Options);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Slot 4 (common with small HR chance)
  const commonSlot4Options = [
    { key: 'C', weight: 95.0 },
    { key: 'S', weight: 4.5 },
    { key: 'HR', weight: 0.5 },
  ];
  {
    const rarity = pickWeighted(commonSlot4Options);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Uncommon slots (slot-specific)
  const uncommonSlotOptions = [
    // Uncommon Slot 1
    [
      { key: 'U', weight: 84.0 },
      { key: 'RR', weight: 15.0 },
      { key: 'SY', weight: 1.0 },
    ],
    // Uncommon Slot 2
    [
      { key: 'U', weight: 94.0 },
      { key: 'SR', weight: 5.0 },
      { key: 'SY', weight: 1.0 },
    ],
    // Uncommon Slot 3
    [
      { key: 'U', weight: 95.0 },
      { key: 'OSR', weight: 4.0 },
      { key: 'UR', weight: 1.0 },
    ],
  ];

  for (let s = 0; s < uncommonSlotOptions.length; s++) {
    const rarity = pickWeighted(uncommonSlotOptions[s]);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Rare slot
  const rareOptions = [
    { key: 'SEC', weight: 99.35 },
    { key: 'OUR', weight: 0.50 },
    { key: 'R', weight: 0.15 },
  ];
  const rareRarity = pickWeighted(rareOptions);
  const rareFile = pickFileFromPool(rareRarity);
  results.push({ rarity: rareRarity, file: rareFile });

  // total results should be 8
  return results;
}

module.exports = { drawPack };
