'use strict';
const { getUserProfile, buildSlotOptions, getOverrides } = require('./rates');
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
    { key: 'U', weight: 94.75 },
    { key: 'SR', weight: 5.0 },
    { key: 'SY', weight: 0.25 },
  ],
  uncommon3: [
    { key: 'U', weight: 95.5 },
    { key: 'OSR', weight: 4.0 },
    { key: 'UR', weight: 0.5 },
  ],
  rare: [
    { key: 'R', weight: 99.58 },
    { key: 'OUR', weight: 0.39 },
    { key: 'SEC', weight: 0.03 },
  ],
};

// Special bases (same as your special pack code).
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
    { key: 'U', weight: 95.75 },
    { key: 'SR', weight: 3.0 },
    { key: 'SY', weight: 1.25 },
  ],
  uncommon3: [
    { key: 'U', weight: 95.5 },
    { key: 'OSR', weight: 3.0 },
    { key: 'UR', weight: 1.5 },
  ],
  rare: [
    { key: 'R', weight: 99.1 },
    { key: 'OUR', weight: 0.9 },
    { key: 'SEC', weight: 0.1 },
  ],
};


const SLOT_NAMES = ['common1','common2','common3','common4','uncommon1','uncommon2','uncommon3','rare'];
function worldFilter(options, index) {
  const forbidden = index < 4 ? new Set(['C', 'S']) : index < 7 ? new Set(['U', 'RR']) : new Set(['R']);
  const eligible = options.filter(o => !forbidden.has(o.key) && Number(o.weight) > 0);
  const total = eligible.reduce((s, o) => s + Number(o.weight), 0);
  if (total <= 0) throw new Error(`World slot ${index + 1} has no eligible positive weights`);
  return eligible.map(o => ({ key: o.key, weight: Number(o.weight) * 100 / total }));
}
function worldOptionsForSlot(userId, index, mode = 'normal') {
  const profile = getUserProfile(userId);
  const m = mode === 'special' ? 'special' : mode === 'boss' ? 'boss' : 'normal';
  const slot = SLOT_NAMES[index];
  if (!slot) throw new Error('Invalid World slot index');
  const base = m === 'special' ? SPECIAL_BASES[slot] : NORMAL_BOSS_BASES[slot];
  const rate = m === 'special' ? profile.specialPullRate : profile.pullRate;
  return worldFilter(buildSlotOptions(base, rate, getOverrides(profile, m, slot)), index);
}
function pickWorldRarity(userId, index, mode = 'normal', rng = Math.random) {
  const opts = worldOptionsForSlot(userId, index, mode);
  let roll = rng() * 100;
  for (const item of opts) { roll -= item.weight; if (roll < 0) return item.key; }
  return opts[opts.length - 1].key;
}
module.exports = { SLOT_NAMES, NORMAL_BOSS_BASES, SPECIAL_BASES, worldFilter, worldOptionsForSlot, pickWorldRarity };
