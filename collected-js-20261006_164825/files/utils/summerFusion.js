const recipes = require('../config/summer-full-art-recipes');
const User = require('../models/User');
const SummerUser = require('../models/SummerUser');

const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';
const FULL_ART_VARIANT = 'Full Art';
const LEGACY_PREFIX = 'Full Art: ';

function storedName(route) {
  return String(route || '').trim();
}

function legacyStoredName(route) {
  return `${LEGACY_PREFIX}${storedName(route)}`;
}

function imageUrl(route) {
  return `${IMAGE_BASE.replace(/\/$/, '')}/SUN/Full%20Art/${encodeURIComponent(storedName(route))}.png`;
}

function isFullArtCard(card, route = null) {
  if (!card || String(card.rarity || '').toUpperCase() !== 'SUN') return false;

  const name = String(card.name || '').trim();
  const variant = String(card.variant || '').trim().toLowerCase();
  const wanted = route == null ? null : storedName(route);

  const modern = variant === FULL_ART_VARIANT.toLowerCase();
  const legacy = name.startsWith(LEGACY_PREFIX);

  if (!modern && !legacy) return false;
  if (wanted == null) return true;

  return name === wanted || name === legacyStoredName(wanted);
}

async function getFusionStatus(userId, route) {
  const members = recipes[route] || [];
  const user = await User.findOne({ id: userId }).lean().exec();
  const counts = {};
  let ownedFullArt = 0;

  for (const card of user?.cards || []) {
    if (String(card.rarity || '').toUpperCase() !== 'SUN') continue;

    if (isFullArtCard(card, route)) {
      ownedFullArt += Number(card.count || 0);
      continue;
    }

    counts[card.name] = (counts[card.name] || 0) + Number(card.count || 0);
  }

  const required = members.map(name => ({
    name,
    count: counts[name] || 0,
    ready: (counts[name] || 0) >= 1,
  }));

  return {
    route,
    members,
    required,
    ready: required.length > 0 && required.every(item => item.ready),
    ownedFullArt,
    imageUrl: imageUrl(route),
  };
}

async function fuseFullArt(userId, route) {
  const members = recipes[route];
  if (!members) return { success: false, reason: 'INVALID' };

  const status = await getFusionStatus(userId, route);
  if (!status.ready) return { success: false, reason: 'MISSING', status };

  const user = await User.findOne({ id: userId });
  if (!user) return { success: false, reason: 'MISSING', status };

  for (const member of members) {
    const card = user.cards.find(entry =>
      entry.name === member &&
      String(entry.rarity || '').toUpperCase() === 'SUN' &&
      !isFullArtCard(entry) &&
      Number(entry.count || 0) >= 1
    );

    if (!card) {
      return {
        success: false,
        reason: 'MISSING',
        status: await getFusionStatus(userId, route),
      };
    }

    card.count -= 1;
  }

  user.cards = user.cards.filter(card => Number(card.count || 0) > 0);

  const fullArtName = storedName(route);
  const fullArt = user.cards.find(card => isFullArtCard(card, route));
  const now = new Date();

  if (fullArt) {
    fullArt.name = fullArtName;
    fullArt.variant = FULL_ART_VARIANT;
    fullArt.count = Number(fullArt.count || 0) + 1;
    fullArt.lastAcquiredAt = now;
  } else {
    user.cards.push({
      name: fullArtName,
      rarity: 'SUN',
      variant: FULL_ART_VARIANT,
      count: 1,
      firstAcquiredAt: now,
      lastAcquiredAt: now,
      locked: false,
    });
  }

  await user.save();

  await SummerUser.updateOne(
    { userId },
    {
      $addToSet: { fusedFullArts: route },
      $inc: { 'stats.fullArtsFused': 1 },
    }
  ).exec();

  return {
    success: true,
    route,
    imageUrl: imageUrl(route),
    status: await getFusionStatus(userId, route),
  };
}

module.exports = {
  recipes,
  storedName,
  legacyStoredName,
  imageUrl,
  isFullArtCard,
  getFusionStatus,
  fuseFullArt,
};
