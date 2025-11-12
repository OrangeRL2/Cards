// newWeightedDraw.js
const pools = require('../utils/loadImages');

function rand() {
  return Math.random();
}

function pickWeighted(options) {
  // options: [{ key: 'C', weight: 94 }, ...]
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = rand() * total;
  for (const o of options) {
    if (r <= o.weight) return o.key;
    r -= o.weight;
  }
  // fallback
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

  // 4 C slots (all C having same odds)
  const cOptions = [
    { key: 'C', weight: 94.0 },
    { key: 'S', weight: 3.0 },
    { key: 'OC', weight: 2.75 },
    { key: 'HR', weight: 0.25 },
  ];
  for (let i = 0; i < 4; i++) {
    const rarity = pickWeighted(cOptions);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // 3 U slots with slot-specific probabilities
  const uSlotOptions = [
    // Slot 1
    [
      { key: 'U', weight: 81.0 },
      { key: 'RR', weight: 17.0 },
      { key: 'SY', weight: 2.0 },
    ],
    // Slot 2
    [
      { key: 'U', weight: 90.0 },
      { key: 'SR', weight: 8.0 },
      { key: 'SY', weight: 2.0 },
    ],
    // Slot 3
    [
      { key: 'U', weight: 94.0 },
      { key: 'OSR', weight: 5.0 },
      { key: 'UR', weight: 1.0 },
    ],
  ];

  for (let s = 0; s < 3; s++) {
    const rarity = pickWeighted(uSlotOptions[s]);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Rare slot
  const rareOptions = [
    { key: 'R', weight: 99.0 },
    { key: 'OUR', weight: 0.75 },
    { key: 'SEC', weight: 0.25 },
  ];
  const rareRarity = pickWeighted(rareOptions);
  const rareFile = pickFileFromPool(rareRarity);
  results.push({ rarity: rareRarity, file: rareFile });

  // results length should be 8
  return results;
}

module.exports = { drawPack };
