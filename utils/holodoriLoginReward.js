const fs = require('fs');
const path = require('path');

const HOLODORI_ROOT = path.join(process.cwd(), 'assets', 'images', 'HOLODORI');
const HOLODORI_STAR_RARITIES = Object.freeze(['★★★', '★★★★', '★★★★★']);

const TIERS = Object.freeze([
  { key: 'three_star', folder: '★★★', weight: 85, signed: false },
  { key: 'four_star', folder: '★★★★', weight: 10, signed: false },
  { key: 'five_star', folder: '★★★★★', weight: 4, signed: false },
  { key: 'signed', folder: '★★★★★', weight: 1, signed: true },
]);

const USER_TIER_WEIGHTS = Object.freeze({
  // Rule-violation rate profile: 0.5% total five-star chance.
  // The removed 4.5 percentage points are moved entirely to three-star.
  '1171127294413246567': Object.freeze({
    three_star: 89.5,
    four_star: 10,
    five_star: 0.4,
    signed: 0.1,
  }),
});

const MEMBER_ALIASES = Object.freeze({
  calli: ['calli', 'calliope'],
  ina: ['ina', "inanis"],
  roboco: ['roboco', 'robocosan'],
  laplus: ['laplus', 'la'],
});

function isPng(name) {
  return /\.png$/i.test(String(name || ''));
}

function cardNumber(name) {
  const match = String(name || '').match(/\s(\d{3})\.png$/i);
  return match ? match[1] : null;
}

function normalizeMemberName(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function fileMemberName(file) {
  return String(file || '')
    .replace(/\.png$/i, '')
    .replace(/\s\d{3}$/i, '')
    .trim();
}

function memberMatches(fileMember, islandMember) {
  const fileKey = normalizeMemberName(fileMember);
  const islandKey = normalizeMemberName(islandMember);
  if (!fileKey || !islandKey) return false;
  if (fileKey === islandKey) return true;

  for (const aliases of Object.values(MEMBER_ALIASES)) {
    const normalizedAliases = aliases.map(normalizeMemberName);
    if (normalizedAliases.includes(fileKey) && normalizedAliases.includes(islandKey)) {
      return true;
    }
  }

  return false;
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

function tiersForUser(userId) {
  const weights = USER_TIER_WEIGHTS[String(userId || '')];
  if (!weights) return TIERS;

  return TIERS.map(tier => ({
    ...tier,
    weight: Number(weights[tier.key] ?? tier.weight),
  }));
}

function weightedTierPick(rng = Math.random, tiers = TIERS) {
  const pool = Array.isArray(tiers) && tiers.length ? tiers : TIERS;
  const total = pool.reduce((sum, tier) => sum + tier.weight, 0);
  let roll = rng() * total;

  for (const tier of pool) {
    roll -= tier.weight;
    if (roll < 0) return tier;
  }

  return pool[pool.length - 1];
}

function cardFromFile(file, tier, extra = {}) {
  return {
    rarity: tier.folder,
    name: file.replace(/\.png$/i, ''),
    signed: tier.signed,
    guaranteed: Boolean(extra.guaranteed),
    islandGuaranteed: Boolean(extra.islandGuaranteed),
    bonus: false,
  };
}

function pickHolodoriLoginReward(userIdOrRng = null, rng = Math.random) {
  // Backward compatibility: older debug/tests may call pickHolodoriLoginReward(rng).
  const userId = typeof userIdOrRng === 'function' ? null : userIdOrRng;
  const pickerRng = typeof userIdOrRng === 'function'
    ? userIdOrRng
    : (typeof rng === 'function' ? rng : Math.random);

  const tier = weightedTierPick(pickerRng, tiersForUser(userId));
  const files = listTierFiles(tier);

  if (!files.length) {
    throw new Error(`No eligible HOLODORI cards found in ${tier.folder} for ${tier.key}.`);
  }

  const file = files[Math.floor(pickerRng() * files.length)];
  return cardFromFile(file, tier);
}

function pickIslandGuaranteedFiveStar(islandMembers, rng = Math.random) {
  const tier = TIERS.find(item => item.key === 'five_star');
  const members = Array.isArray(islandMembers) ? islandMembers : [];
  const files = listTierFiles(tier).filter(file => {
    const fileMember = fileMemberName(file);
    return members.some(member => memberMatches(fileMember, member));
  });

  if (!files.length) {
    throw new Error('No normal five-star HOLODORI cards matched the selected island members.');
  }

  const file = files[Math.floor(rng() * files.length)];
  return cardFromFile(file, tier, { guaranteed: true, islandGuaranteed: true });
}

function buildHolodoriTenPull({ islandMembers = [], guaranteeIslandFiveStar = false, userId = null, rng = Math.random } = {}) {
  const cards = [];

  if (guaranteeIslandFiveStar) {
    cards.push(pickIslandGuaranteedFiveStar(islandMembers, rng));
  }

  while (cards.length < 10) {
    cards.push(pickHolodoriLoginReward(userId, rng));
  }

  // Shuffle so the guaranteed card is not always shown first.
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return cards;
}

function buildHolodoriImageUrl(card, imageBase) {
  const base = String(imageBase || '').replace(/\/$/, '');
  const stars = HOLODORI_STAR_RARITIES.includes(String(card?.rarity || '').trim())
    ? String(card.rarity).trim()
    : String(card?.variant || '').match(/^★{3,5}/)?.[0] || '★★★';
  const name = encodeURIComponent(String(card?.name || '').trim());
  return `${base}/HOLODORI/${encodeURIComponent(stars)}/${name}.png`;
}

module.exports = {
  HOLODORI_STAR_RARITIES,
  TIERS,
  normalizeMemberName,
  memberMatches,
  pickHolodoriLoginReward,
  pickIslandGuaranteedFiveStar,
  buildHolodoriTenPull,
  buildHolodoriImageUrl,
};
