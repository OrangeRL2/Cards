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

// --- User groups ---
const specialUserIds = new Set([
  '409717160995192832',
  '',
]);

const otherUserIds = new Set([
  '',
  '222222222222222222',
]);

// --- Overrides ---
const specialOverrides = {
  commonSlot1Options: [
    { key: 'C', weight: 95.8 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
    { key: 'bday', weight: 0.1 },
  ],
  commonSlot2Options: [
    { key: 'C', weight: 94.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 2.0 },
  ],
  commonSlot3Options: [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'bday', weight: 0.1 },
  ],
  commonSlot4Options: [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
  ],
  uncommonSlotOptions: [
    [
      { key: 'U', weight: 87.0 },
      { key: 'RR', weight: 12.5 },
      { key: 'SY', weight: 0.5 },
    ],
    [
      { key: 'U', weight: 94.5 },
      { key: 'SR', weight: 4.0 },
      { key: 'SY', weight: 1.5 },
    ],
    [
      { key: 'U', weight: 95.0 },
      { key: 'OSR', weight: 3.0 },
      { key: 'UR', weight: 2.0 },
    ],
  ],
  rareOptions: [
    { key: 'R', weight: 99.20 },
    { key: 'OUR', weight: 0.55 },
    { key: 'SEC', weight: 0.25 },
  ],
};

const otherOverrides = {
  commonSlot1Options: [
    { key: 'C', weight: 97.9 },
    { key: 'S', weight: 2.0 },
    { key: 'HR', weight: 0.05 },
    { key: 'bday', weight: 0.05 },
  ],
  commonSlot2Options: [
    { key: 'C', weight: 97.0 },
    { key: 'S', weight: 2.0 },
    { key: 'OC', weight: 1.0 },
  ],
  commonSlot3Options: [
    { key: 'C', weight: 97.95 },
    { key: 'S', weight: 2.0 },
    { key: 'bday', weight: 0.05 },
  ],
  commonSlot4Options: [
    { key: 'C', weight: 97.95 },
    { key: 'S', weight: 2.0 },
    { key: 'HR', weight: 0.05 },
  ],
  uncommonSlotOptions: [
    [
      { key: 'U', weight: 93.5 },
      { key: 'RR', weight: 6.25 },
      { key: 'SY', weight: 0.25 },
    ],
    [
      { key: 'U', weight: 97.75 },
      { key: 'SR', weight: 2.0 },
      { key: 'SY', weight: 0.25 },
    ],
    [
      { key: 'U', weight: 98.0 },
      { key: 'OSR', weight: 1.5 },
      { key: 'UR', weight: 0.5 },
    ],
  ],
  rareOptions: [
    { key: 'R', weight: 99.725 },
    { key: 'OUR', weight: 0.275 },
    { key: 'SEC', weight: 0.00 },
  ],
};


// --- Override map ---
const overridesMap = [
  [specialUserIds, specialOverrides],
  [otherUserIds, otherOverrides],
];

// --- Helper ---
function applyOverride(userId, base, key) {
  const idStr = String(userId);
  for (const [idSet, overrideObj] of overridesMap) {
    if (idSet.has(idStr) && overrideObj[key] !== undefined && overrideObj[key] !== null) {
      return overrideObj[key];
    }
  }
  return base;
}

// --- Main draw ---
function drawPack(userId) {
  const results = [];

  // Common Slots
  // Slot 1: 95.8% C, 4% S, 0.1% HR, 0.1% bday
  const commonSlot1Base = [
    { key: 'C', weight: 95.8 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
    { key: 'bday', weight: 0.1 },
  ];
  const commonSlot1Options = applyOverride(userId, commonSlot1Base, 'commonSlot1Options');
  {
    const rarity = pickWeighted(commonSlot1Options);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Slot 2: 94% C, 4% S, 2% OC
  const commonSlot2Base = [
    { key: 'C', weight: 94.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 2.0 },
  ];
  const commonSlot2Options = applyOverride(userId, commonSlot2Base, 'commonSlot2Options');
  {
    const rarity = pickWeighted(commonSlot2Options);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Slot 3: 95.9% C, 4% S, 0.1% bday
  const commonSlot3Base = [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'bday', weight: 0.1 },
  ];
  const commonSlot3Options = applyOverride(userId, commonSlot3Base, 'commonSlot3Options');
  {
    const rarity = pickWeighted(commonSlot3Options);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Slot 4: 95.9% C, 4% S, 0.1% HR
  const commonSlot4Base = [
    { key: 'C', weight: 95.9 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 0.1 },
  ];
  const commonSlot4Options = applyOverride(userId, commonSlot4Base, 'commonSlot4Options');
  {
    const rarity = pickWeighted(commonSlot4Options);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Uncommon Slots
  // Slot 1: 87% U, 12.5% RR, 0.5% SY
  const uncommonSlot1Base = [
    { key: 'U', weight: 87.0 },
    { key: 'RR', weight: 12.5 },
    { key: 'SY', weight: 0.5 },
  ];
  const uncommonSlot1Options = applyOverride(userId, uncommonSlot1Base, 'uncommonSlot1Options');
  {
    const rarity = pickWeighted(uncommonSlot1Options);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Slot 2: 95.5% U, 4% SR, 0.5% SY
  const uncommonSlot2Base = [
    { key: 'U', weight: 95.5 },
    { key: 'SR', weight: 4.0 },
    { key: 'SY', weight: 0.5 },
  ];
  const uncommonSlot2Options = applyOverride(userId, uncommonSlot2Base, 'uncommonSlot2Options');
  {
    const rarity = pickWeighted(uncommonSlot2Options);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Slot 3: 96% U, 3% OSR, 1% UR
  const uncommonSlot3Base = [
    { key: 'U', weight: 96.0 },
    { key: 'OSR', weight: 3.0 },
    { key: 'UR', weight: 1.0 },
  ];
  const uncommonSlot3Options = applyOverride(userId, uncommonSlot3Base, 'uncommonSlot3Options');
  {
    const rarity = pickWeighted(uncommonSlot3Options);
    const file = pickFileFromPool(rarity);
    results.push({ rarity, file });
  }

  // Rare slot: 99.40% R, 0.55% OUR, 0.05% SEC
  const rareBase = [
    { key: 'R', weight: 99.40 },
    { key: 'OUR', weight: 0.55 },
    { key: 'SEC', weight: 0.05 },
  ];
  const rareOptions = applyOverride(userId, rareBase, 'rareOptions');
  {
    const rareRarity = pickWeighted(rareOptions);
    const rareFile = pickFileFromPool(rareRarity);
    results.push({ rarity: rareRarity, file: rareFile });
  }

  return results;
}

module.exports = { drawPack };