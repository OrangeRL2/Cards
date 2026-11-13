// utils/leveling.js
const BASE_XP = 100;

const RARITY_XP = {
C: 1,
U: 2,
R: 3,
S: 5,
P: 5,
OC: 7,
SP: 10,
RR: 10,
SR: 15,
OSR: 20,
SY: 50,
UR: 60,
OUR: 100,
HR: 150,
BDAY: 150,
SEC: 300,
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
