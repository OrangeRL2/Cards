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
  '1171127294413246567': Object.freeze({ //blacky
    three_star: 89.5,
    four_star: 10,
    five_star: 0.4,
    signed: 0.1,
  }),

  '408400038767624195': Object.freeze({//grimm
    three_star: 95,
    four_star: 5,
    five_star: 0,
    signed: 0,
  }),
    '1450162068484264091': Object.freeze({//grimm2
    three_star: 95,
    four_star: 5,
    five_star: 0,
    signed: 0,
  }),
})


const NO_HOLODORI_FIVE_STAR_USER_IDS = new Set([
  '408400038767624195',
  '1450162068484264091',
]);

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
      const number = Number(cardNumber(file));
      const signed = Number.isInteger(number) && number > 0 && number % 2 === 0;
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

function pickHolodoriLoginReward(userIdOrRng = null, rng = Math.random, options = {}) {
  // Backward compatibility: older debug/tests may call pickHolodoriLoginReward(rng).
  const userId = typeof userIdOrRng === 'function' ? null : userIdOrRng;
  const pickerRng = typeof userIdOrRng === 'function'
    ? userIdOrRng
    : (typeof rng === 'function' ? rng : Math.random);

  const userTiers = tiersForUser(userId);
  const permittedFiveStarTiers = userTiers.filter(tier =>
    (tier.key === 'five_star' || tier.key === 'signed') && tier.weight > 0
  );
  // Explicitly zero-rate users are never boosted, even when marked buffed.
  const canBuff = !NO_HOLODORI_FIVE_STAR_USER_IDS.has(String(userId || ''))
    && permittedFiveStarTiers.length > 0;
  // Signed-only boost is allowed only if the user has a nonzero signed tier.
  const signedTier = userTiers.find(tier => tier.key === 'signed' && tier.weight > 0);
  const tier = options?.forceSignedFiveStar && canBuff && signedTier
    ? signedTier
    : options?.forceFiveStar && canBuff
      ? weightedTierPick(pickerRng, permittedFiveStarTiers)
      : weightedTierPick(pickerRng, userTiers);
  const files = listTierFiles(tier);

  if (!files.length) {
    throw new Error(`No eligible HOLODORI cards found in ${tier.folder} for ${tier.key}.`);
  }

  const file = files[Math.floor(pickerRng() * files.length)];
  return cardFromFile(file, tier);
}

/**
 * HAL/BOO Candy shop FIRST HOLODORI 10-pull only.
 * The normal reward picker still enforces all zero-five-star restrictions.
 *
 * cardName optionally names the exact guaranteed card for any configured user
 * (e.g. "Suisei 001" or signed "Suisei 002"). With no configured card,
 * the player's ordinary guaranteed-selection rule applies.
 */
function pickHalloweenFirstPurchaseFiveStar(userId, { cardName = null, rng = Math.random } = {}) {
  const id = String(userId || '');
  const permitted = tiersForUser(id).filter(tier =>
    (tier.key === 'five_star' || tier.key === 'signed') && tier.weight > 0
  );
  const restricted = NO_HOLODORI_FIVE_STAR_USER_IDS.has(id) || permitted.length === 0;

  // A configured first-purchase card always takes priority, regardless of the
  // user's regular rate profile. This does not affect other pull systems.
  if (cardName !== null && cardName !== undefined && cardName !== '') {
    if (typeof cardName !== 'string') {
      throw new Error(`HAL first-purchase card override for ${id} must be a card name string.`);
    }
    const name = cardName.trim();
    // Avoid path traversal; card files are named "Member 001.png", etc.
    const match = name.match(/^([^/\\\x00-\x1f]+) (\d{3})$/u);
    if (!match || name.includes('..')) {
      throw new Error(`Invalid HAL first-purchase card override for ${id}: ${name}`);
    }
    const signed = Number(match[2]) % 2 === 0;
    const tier = TIERS.find(item => item.key === (signed ? 'signed' : 'five_star'));
    const filename = `${name}.png`;
    if (!listTierFiles(tier).includes(filename)) {
      throw new Error(`HAL first-purchase 5-star card does not exist: ${filename}`);
    }
    return cardFromFile(filename, tier, { guaranteed: true });
  }

  // Unconfigured users retain the normal guaranteed five-star selection.
  if (!restricted) {
    const reward = pickHolodoriLoginReward(id, rng, { forceFiveStar: true });
    return { ...reward, guaranteed: true };
  }

  // This opt-in bypass is *only* used by HAL's first purchase. Normal HOLODORI
  // packs and all subsequent HAL 10-pulls still respect the user's zero rate.
  const fiveStarTiers = TIERS.filter(item => item.key === 'five_star' || item.key === 'signed');
  const tier = weightedTierPick(rng, fiveStarTiers);
  const files = listTierFiles(tier);
  if (!files.length) {
    throw new Error(`No eligible HOLODORI cards found in ${tier.folder} for ${tier.key}.`);
  }
  return cardFromFile(files[Math.floor(rng() * files.length)], tier, { guaranteed: true });
}

// Admin one-time login override: keep the user's normal HOLODORI tier weights,
// but restrict the card artwork to the requested member. Signed cards remain a
// separate five-star tier under the normal login rules.
function eligibleMemberLoginTiers(memberName, userId = null) {
  return tiersForUser(userId)
    .filter(tier => Number(tier.weight) > 0)
    .map(tier => ({
      ...tier,
      memberFiles: listTierFiles(tier).filter(file =>
        memberMatches(fileMemberName(file), memberName)
      ),
    }))
    .filter(tier => tier.memberFiles.length > 0);
}

function hasMemberHolodoriLoginCards(memberName, userId = null) {
  return eligibleMemberLoginTiers(memberName, userId).length > 0;
}

function pickMemberHolodoriLoginReward(memberName, userId = null, rng = Math.random) {
  const choices = eligibleMemberLoginTiers(memberName, userId);
  if (!choices.length) {
    throw new Error(`No eligible 3-5 star HOLODORI login cards found for ${memberName}.`);
  }

  const pickerRng = typeof rng === 'function' ? rng : Math.random;
  const tier = weightedTierPick(pickerRng, choices);
  const file = tier.memberFiles[Math.floor(pickerRng() * tier.memberFiles.length)];
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

function pickIslandGuaranteedSignedFiveStar(islandMembers, rng = Math.random) {
  const tier = TIERS.find(item => item.key === 'signed');
  const members = Array.isArray(islandMembers) ? islandMembers : [];
  const files = listTierFiles(tier).filter(file => {
    const fileMember = fileMemberName(file);
    return members.some(member => memberMatches(fileMember, member));
  });

  if (!files.length) {
    throw new Error('No signed five-star HOLODORI cards matched the selected island members.');
  }

  const file = files[Math.floor(rng() * files.length)];
  // This card is mechanically forced, but intentionally looks like a normal signed pull.
  return cardFromFile(file, tier);
}

function buildHolodoriTenPull({
  islandMembers = [],
  guaranteeIslandFiveStar = false,
  guaranteeIslandSignedFiveStar = false,
  userId = null,
  rng = Math.random,
} = {}) {
  const cards = [];
  const noFiveStar = NO_HOLODORI_FIVE_STAR_USER_IDS.has(String(userId || ''));

  if (!noFiveStar && guaranteeIslandSignedFiveStar) {
    cards.push(pickIslandGuaranteedSignedFiveStar(islandMembers, rng));
  } else if (!noFiveStar && guaranteeIslandFiveStar) {
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
  hasMemberHolodoriLoginCards,
  pickMemberHolodoriLoginReward,
  pickHalloweenFirstPurchaseFiveStar,
  pickIslandGuaranteedFiveStar,
  pickIslandGuaranteedSignedFiveStar,
  buildHolodoriTenPull,
  buildHolodoriImageUrl,
};
