'use strict';

// Shared source of truth for 8-card base draw probabilities.
// The FIRST rarity in each slot is the lowest rarity and absorbs any changes
// when rates or overrides are applied by utils/rates.buildSlotOptions().
// Both pack draw engines, !odds, and Halloween World use these same tables.
const NORMAL_BOSS_BASES = {
  common1: [
    { key: 'C', weight: 94.8 },
    { key: 'S', weight: 5.0 },
    { key: 'HR', weight: 0.1 },
    { key: 'BDAY', weight: 0.1 },
  ],
  common2: [
    { key: 'C', weight: 93.0 },
    { key: 'S', weight: 5.0 },
    { key: 'OC', weight: 2.0 },
  ],
  common3: [
    { key: 'C', weight: 94.8 },
    { key: 'S', weight: 5.0 },
    { key: 'BDAY', weight: 0.1 },
  ],
  common4: [
    { key: 'C', weight: 94.8 },
    { key: 'S', weight: 5.0 },
    { key: 'HR', weight: 0.1 },
  ],
  uncommon1: [
    { key: 'U', weight: 87.75 },
    { key: 'RR', weight: 12.0 },
    { key: 'SY', weight: 0.25 },
  ],
  uncommon2: [
    { key: 'U', weight: 95.75 },
    { key: 'SR', weight: 4.0 },
    { key: 'SY', weight: 0.25 },
  ],
  uncommon3: [
    { key: 'U', weight: 96.5 },
    { key: 'OSR', weight: 3.0 },
    { key: 'UR', weight: 0.5 },
  ],
  rare: [
    { key: 'R', weight: 99.58 },
    { key: 'OUR', weight: 0.39 },
    { key: 'SEC', weight: 0.03 },
  ],
};

// Ordinary member-targeted special pulls (e.g. "lamy").
// GOD / hololive fixed-rarity packs deliberately bypass these tables.
// SR and OSR were increased to 7%, taking the extra percentage from U.
const SPECIAL_BASES = {
  common1: [
    { key: 'C', weight: 93.8 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 1.1 },
    { key: 'BDAY', weight: 1.1 },
  ],
  common2: [
    { key: 'C', weight: 94.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 2.0 },
  ],
  common3: [
    { key: 'C', weight: 94.9 },
    { key: 'S', weight: 4.0 },
    { key: 'BDAY', weight: 1.1 },
  ],
  common4: [
    { key: 'C', weight: 94.9 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 1.1 },
  ],
  uncommon1: [
    { key: 'U', weight: 88.75 },
    { key: 'RR', weight: 10.0 },
    { key: 'SY', weight: 1.25 },
  ],
  uncommon2: [
    { key: 'U', weight: 91.75 },
    { key: 'SR', weight: 7.0 },
    { key: 'SY', weight: 1.25 },
  ],
  uncommon3: [
    { key: 'U', weight: 91.5 },
    { key: 'OSR', weight: 7.0 },
    { key: 'UR', weight: 1.5 },
  ],
  rare: [
    { key: 'R', weight: 99.1 },
    { key: 'OUR', weight: 0.9 },
    { key: 'SEC', weight: 0.1 },
  ],
};

// Prevent accidental in-process mutation of the shared probability tables.
for (const bases of [NORMAL_BOSS_BASES, SPECIAL_BASES]) {
  for (const slot of Object.values(bases)) {
    for (const option of slot) Object.freeze(option);
    Object.freeze(slot);
  }
  Object.freeze(bases);
}

module.exports = { NORMAL_BOSS_BASES, SPECIAL_BASES };
