// config/summer-cards.js
// Standard [SUN] card pools used by Hello! A Brand New Summer!
// Card names match the PNG filenames exactly, without the .png extension.

const SUMMER_CARDS = Object.freeze({
blue: Object.freeze([
  'Anya',
  'Ayame',
  'Cecilia',
  'Fuwawa',
  'Ina',
  'Iroha',
  'Kanade',
  'Lamy',
  'Luna',
  'Matsuri',
  'Mococo',
  'Niko',
  'Okayu',
  'Pekora',
  'Suisei',
  'Vivi',
  'Zeta',
  'Shion',
  'Sana',
]),


green: Object.freeze([
  'AZKi',
  'Aki',
  'Baelz',
  'Chihaya',
  'Hajime',
  'Kobo',
  'Korone',
  'La+',
  'Nene',
  'Noel',
  'Ollie',
  'Raden',
  'Raora',
  'Risu',
  'Shiori',
  'Subaru',
  'Towa',
  'Coco',
  'Gura',
]),

red: Object.freeze([
  'Ao',
  'Botan',
  'Calli',
  'Choco',
  'Elizabeth',
  'Fubuki G',
  'Haato',
  'Kaela',
  'Kronii',
  'Lui',
  'Marine',
  'Moona',
  'Nerissa',
  'Riona',
  'Sora',
  'Watame',
  'Chloe',
  'Amelia',
  'Achan',
]),

yellow: Object.freeze([
  'Bijou',
  'Flare',
  'Fubuki',
  'Gigi',
  'Iofi',
  'IRyS',
  'Kanata',
  'Kiara',
  'Koyori',
  'Miko',
  'Mio',
  'Mumei',
  'Polka',
  'Reine',
  'Ririka',
  'Roboco',
  'Su',
  'Aqua',
  'Nodoka',
]),
});

const ISLAND_FOLDERS = Object.freeze({
  blue: 'Blue',
  green: 'Green',
  red: 'Red',
  yellow: 'Yellow',
});

const VALID_ISLANDS = Object.freeze(Object.keys(SUMMER_CARDS));

function normalizeIsland(island) {
  const key = String(island ?? '').trim().toLowerCase();
  return VALID_ISLANDS.includes(key) ? key : null;
}

function getIslandCards(island) {
  const key = normalizeIsland(island);
  return key ? SUMMER_CARDS[key] : [];
}

function getIslandFolder(island) {
  const key = normalizeIsland(island);
  return key ? ISLAND_FOLDERS[key] : null;
}

function getAllStandardSummerCards() {
  return VALID_ISLANDS.flatMap(island =>
    SUMMER_CARDS[island].map(cardName => ({
      island,
      folder: ISLAND_FOLDERS[island],
      cardName,
      rarity: 'SUN',
    }))
  );
}

function findCardIsland(cardName) {
  const normalizedName = String(cardName || '').trim().toLowerCase();

  for (const [island, cards] of Object.entries(SUMMER_CARDS)) {
    const found = cards.some(
      name => String(name).trim().toLowerCase() === normalizedName
    );

    if (found) {
      return island;
    }
  }

  return null;
}

module.exports = {
  SUMMER_CARDS,
  ISLAND_FOLDERS,
  VALID_ISLANDS,
  normalizeIsland,
  getIslandCards,
  getIslandFolder,
  getAllStandardSummerCards,
  findCardIsland,
};
