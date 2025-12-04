// utils/leveling.js
const BASE_XP = 10;

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

function xpToNextForLevel(level) {
  return Math.floor(BASE_XP * Math.pow(1.1, Math.max(0, level - 1)));
}

module.exports = { BASE_XP, RARITY_XP, isValidRarity, xpForCard, xpToNextForLevel };
