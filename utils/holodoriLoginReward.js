const fs = require('fs');
const path = require('path');

const HOLODORI_RARITY = 'HOLODORI';
const HOLODORI_ROOT = path.join(process.cwd(), 'assets', 'images', 'HOLODORI');

const TIERS = Object.freeze([
  { key: 'three_star', folder: '★★★', weight: 85, signed: false },
  { key: 'four_star', folder: '★★★★', weight: 10, signed: false },
  { key: 'five_star', folder: '★★★★★', weight: 4, signed: false },
  { key: 'signed', folder: '★★★★★', weight: 1, signed: true },
]);

function isPng(name) {
  return /\.png$/i.test(String(name || ''));
}

function cardNumber(name) {
  const match = String(name || '').match(/\s(\d{3})\.png$/i);
  return match ? match[1] : null;
}

function listTierFiles(tier) {
  const dir = path.join(HOLODORI_ROOT, tier.folder);
  let files;

  try {
    files = fs.readdirSync(dir).filter(isPng);
  } catch (err) {
    console.error('[HOLODORI] Could not read folder:', dir, err.message);
    return [];
  }

  if (tier.folder === '★★★★★') {
    files = files.filter(file => {
      const number = cardNumber(file);
      const signed = number === '002' || number === '004';
      return tier.signed ? signed : !signed;
    });
  }

  return files;
}

function weightedTierPick(rng = Math.random) {
  const total = TIERS.reduce((sum, tier) => sum + tier.weight, 0);
  let roll = rng() * total;

  for (const tier of TIERS) {
    roll -= tier.weight;
    if (roll < 0) return tier;
  }

  return TIERS[TIERS.length - 1];
}

function pickHolodoriLoginReward(rng = Math.random) {
  const tier = weightedTierPick(rng);
  const files = listTierFiles(tier);

  if (!files.length) {
    throw new Error(`No eligible HOLODORI cards found in ${tier.folder} for ${tier.key}.`);
  }

  const file = files[Math.floor(rng() * files.length)];
  const name = file.replace(/\.png$/i, '');

  return {
    rarity: HOLODORI_RARITY,
    variant: tier.folder,
    name,
    signed: tier.signed,
    guaranteed: false,
    bonus: false,
  };
}

function buildHolodoriImageUrl(card, imageBase) {
  const base = String(imageBase || '').replace(/\/$/, '');
  const stars = String(card?.variant || '').match(/^★{3,5}/)?.[0] || '★★★';
  const name = encodeURIComponent(String(card?.name || '').trim());
  return `${base}/HOLODORI/${encodeURIComponent(stars)}/${name}.png`;
}

module.exports = {
  HOLODORI_RARITY,
  TIERS,
  pickHolodoriLoginReward,
  buildHolodoriImageUrl,
};
