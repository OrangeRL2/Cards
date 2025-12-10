// utils/leveling.js
const BASE_XP = 100;

const RARITY_XP = {
  C: 1,
  U: 3,
  R: 6,
  OC: 4,
  S: 12,
  RR: 40,
  SR: 50,
  OSR: 60,
  SY: 70,
  HR: 80,
  BDAY: 80,
  UR: 90,
  OUR: 100,
  SEC: 250,
  UP: 1000,
};

function isValidRarity(rarity) {
  if (!rarity && rarity !== '') return false;
  const r = String(rarity).toUpperCase().trim();
  return Object.prototype.hasOwnProperty.call(RARITY_XP, r);
}

function xpForCard(rarity, count = 1) {
  const r = String(rarity ?? '').toUpperCase();
  if (!isValidRarity(r)) return null; // return null for invalid rarity
  const per = RARITY_XP[r];
  return Math.floor(per * Math.max(0, Number(count) || 0));
}

// XP required for the next single level given the current level.
// Behavior:
//  - start level is 0 (new users can be level 0)
//  - level 0 => require BASE_XP (i.e., treat multiplier as 1)
//  - level 1 => require BASE_XP * 1
//  - level 2 => require BASE_XP * 2
//  - etc.
function xpToNextForLevel(level) {
  // Normalize numeric level safely, allowing level 0
  const raw = Number(level);
  const lvl = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;

  // Use level+1 so level 0 => BASE_XP*1, level 1 => BASE_XP*2, ...
  return BASE_XP * (lvl + 1);
}


module.exports = { BASE_XP, RARITY_XP, isValidRarity, xpForCard, xpToNextForLevel };
