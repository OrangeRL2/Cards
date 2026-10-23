'use strict';

// Candy awarded for one completed pull. Only the highest qualifying rarity
// counts: multiple cards and Judgement's extra cards never create extra packs.
const CANDY_BY_RARITY = Object.freeze({
  SR: 2,
  OSR: 2,
  SY: 3,
  UR: 4,
  HR: 5,
  OUR: 6,
  BDAY: 7,
  SEC: 10,
});

function candyForPack(cards) {
  if (!Array.isArray(cards)) return 1;
  return cards.reduce((highest, card) => {
    const rarity = String(card?.rarity ?? '').trim().toUpperCase();
    return Math.max(highest, CANDY_BY_RARITY[rarity] || 1);
  }, 1);
}

function candyForPacks(packs) {
  if (!Array.isArray(packs)) return 0;
  return packs.reduce((sum, pack) => sum + candyForPack(pack), 0);
}

module.exports = { CANDY_BY_RARITY, candyForPack, candyForPacks };
