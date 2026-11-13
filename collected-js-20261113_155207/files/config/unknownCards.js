'use strict';
// Stored collection rarity is ???; artwork stays in its original event folder.
// Only these exact names are reclassified. The underlying event pools/odds
// and original artwork files are deliberately unchanged.
const UNKNOWN_RARITY = '???';
const SOURCE_RARITIES = Object.freeze({
  'Halloween X': 'BOO',
  'Easter O': 'EAS',
  'Easter Y': 'EAS',
  'Easter X': 'EAS',
  'Padoru X': 'XMAS',
});
const UNKNOWN_CARD_NAMES = Object.freeze(Object.keys(SOURCE_RARITIES));

function sourceRarity(name) {
  return SOURCE_RARITIES[String(name || '').trim()] || null;
}
function isUnknownCard(name) { return sourceRarity(name) !== null; }
function storedRarity(name, originalRarity) {
  const original = String(originalRarity || '').trim().toUpperCase();
  return sourceRarity(name) === original ? UNKNOWN_RARITY : original;
}
function artRarity(name, cardRarity) {
  const rarity = String(cardRarity || '').trim().toUpperCase();
  return rarity === UNKNOWN_RARITY ? (sourceRarity(name) || rarity) : rarity;
}

module.exports = { UNKNOWN_RARITY, SOURCE_RARITIES, UNKNOWN_CARD_NAMES,
  sourceRarity, isUnknownCard, storedRarity, artRarity };
