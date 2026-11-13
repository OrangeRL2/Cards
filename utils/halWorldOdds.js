'use strict';
const { getUserProfile, buildSlotOptions, getOverrides } = require('./rates');
const { NORMAL_BOSS_BASES, SPECIAL_BASES } = require('./pullSlotBases');

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
