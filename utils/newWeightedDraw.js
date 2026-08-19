// utils/newWeightedDraw.js
const path = require('path');

const PullQuota = require('../models/PullQuota');
const pools = require('../utils/loadImages');

const {
  pickWeighted,
  buildSlotOptions,
  applyFinalRateMultiplier,
  applyAbsoluteOverrides,
  getUserProfile,
  getOverrides,
} = require('../utils/rates');

const {
  pickFileFromPool,
  rollExtraSlot,
  specialUserIds,
  otherUserIds,
} = require('../utils/extraSlot');

const {
  getIslandCards,
  normalizeIsland,
} = require('../config/summer-cards');

const SUMMER_MEMBER_ALIASES = Object.freeze({
  'Fubuki G': ['Fubuki'],
  Fuwawa: ['Fuwawa', 'Fuwamoco'],
  Mococo: ['Mococo', 'Fuwamoco'],
});

// Pool/image data is loaded once at startup, so Summer eligibility for a given
// island + rarity + pool mode is stable for the life of the process.
const islandEligiblePoolCache = new Map();

function getBasePool(rarity, userId, useSpecialRates) {
  const idStr = String(userId);

  if (
    useSpecialRates &&
    specialUserIds.has(idStr) &&
    pools.special &&
    Array.isArray(pools.special[rarity]) &&
    pools.special[rarity].length > 0
  ) {
    return pools.special[rarity];
  }

  if (
    otherUserIds.has(idStr) &&
    pools.other &&
    Array.isArray(pools.other[rarity]) &&
    pools.other[rarity].length > 0
  ) {
    return pools.other[rarity];
  }

  if (Array.isArray(pools[rarity]) && pools[rarity].length > 0) {
    return pools[rarity];
  }

  return [];
}

function getCardBaseName(file) {
  const base = path.basename(String(file));
  return base.slice(0, base.length - path.extname(base).length).trim();
}

function getAllowedNamesForIsland(island) {
  const members = getIslandCards(island);
  const names = new Set();

  for (const member of members) {
    names.add(member);

    const aliases = SUMMER_MEMBER_ALIASES[member] || [];
    for (const alias of aliases) {
      names.add(alias);
    }
  }

  return [...names];
}

function isMemberCardAllowed(file, allowedNames) {
  const cardName = getCardBaseName(file);

  if (/^support(?:\s|$)/i.test(cardName)) {
    return false;
  }

  return allowedNames.some(memberName => {
    const escaped = String(memberName)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return new RegExp(`^${escaped}(?:\\s|$)`, 'i').test(cardName);
  });
}

function getEligibleIslandFiles(rarity, userId, useSpecialRates, island) {
  const normalizedIsland = normalizeIsland(island);

  if (!normalizedIsland) {
    return [];
  }

  const idStr = String(userId);
  const poolMode =
    useSpecialRates && specialUserIds.has(idStr)
      ? 'special'
      : otherUserIds.has(idStr)
        ? 'other'
        : 'normal';

  const cacheKey = `${normalizedIsland}\u0000${rarity}\u0000${poolMode}`;
  const cached = islandEligiblePoolCache.get(cacheKey);
  if (cached) return cached;

  const allowedNames = getAllowedNamesForIsland(normalizedIsland);
  const pool = getBasePool(rarity, userId, useSpecialRates);
  const eligible = pool.filter(file => isMemberCardAllowed(file, allowedNames));

  islandEligiblePoolCache.set(cacheKey, eligible);
  return eligible;
}

function chooseRarityAndFile(options, userId, useSpecialRates, summerIsland) {
  const normalizedIsland = normalizeIsland(summerIsland);

  if (!normalizedIsland) {
    const rarity = pickWeighted(options);
    const file = pickFileFromPool(rarity, userId, useSpecialRates);
    return { rarity, file };
  }

  const eligibleOptions = options.filter(option => {
    const rarity = option.key;
    return getEligibleIslandFiles(
      rarity,
      userId,
      useSpecialRates,
      normalizedIsland
    ).length > 0;
  });

  if (eligibleOptions.length === 0) {
    throw new Error(
      `No eligible Summer island cards were found for island "${normalizedIsland}".`
    );
  }

  const rarity = pickWeighted(eligibleOptions);
  const eligibleFiles = getEligibleIslandFiles(
    rarity,
    userId,
    useSpecialRates,
    normalizedIsland
  );

  const file = eligibleFiles[Math.floor(Math.random() * eligibleFiles.length)];

  return { rarity, file };
}

async function drawPack(userId, useSpecialRatesOverride = null, opts = {}) {
  const results = [];
  const idStr = String(userId);

  let useSpecialRates = false;

  if (useSpecialRatesOverride !== null) {
    useSpecialRates = Boolean(useSpecialRatesOverride);
  } else if (specialUserIds.has(idStr)) {
    // Only users that are actually configured for the legacy special-rate
    // pool need a quota lookup. Ordinary users can skip this Mongo round trip
    // entirely.
    try {
      const quota = await PullQuota
        .findOne({ userId: idStr })
        .lean()
        .exec();

      if (
        quota &&
        typeof quota.pulls === 'number' &&
        quota.pulls >= 0
      ) {
        useSpecialRates = true;
      }
    } catch {
      useSpecialRates = false;
    }
  }

  const profile = getUserProfile(userId);
  const rateMultiplier = Number.isFinite(Number(opts?.rateMultiplier)) ? Math.max(0, Number(opts.rateMultiplier)) : 1;
  const summerIsland = normalizeIsland(opts?.summerIsland);

  const commonSlot1Base = [
    { key: 'C', weight: 94.8 },
    { key: 'S', weight: 5.0 },
    { key: 'HR', weight: 0.1 },
    { key: 'BDAY', weight: 0.1 },
  ];

  {
    let options = buildSlotOptions(
      commonSlot1Base,
      profile.pullRate,
      getOverrides(profile, 'normal', 'common1')
    );
    options = applyFinalRateMultiplier(options, rateMultiplier);

    results.push(
      chooseRarityAndFile(
        options,
        userId,
        useSpecialRates,
        summerIsland
      )
    );
  }

  const commonSlot2Base = [
    { key: 'C', weight: 93.0 },
    { key: 'S', weight: 5.0 },
    { key: 'OC', weight: 2.0 },
  ];

  {
    let options = buildSlotOptions(
      commonSlot2Base,
      profile.pullRate,
      getOverrides(profile, 'normal', 'common2')
    );
    options = applyFinalRateMultiplier(options, rateMultiplier);

    results.push(
      chooseRarityAndFile(
        options,
        userId,
        useSpecialRates,
        summerIsland
      )
    );
  }

  const commonSlot3Base = [
    { key: 'C', weight: 94.8 },
    { key: 'S', weight: 5.0 },
    { key: 'BDAY', weight: 0.1 },
  ];

  {
    let options = buildSlotOptions(
      commonSlot3Base,
      profile.pullRate,
      getOverrides(profile, 'normal', 'common3')
    );
    options = applyFinalRateMultiplier(options, rateMultiplier);

    results.push(
      chooseRarityAndFile(
        options,
        userId,
        useSpecialRates,
        summerIsland
      )
    );
  }

  const commonSlot4Base = [
    { key: 'C', weight: 94.8 },
    { key: 'S', weight: 5.0 },
    { key: 'HR', weight: 0.1 },
  ];

  {
    let options = buildSlotOptions(
      commonSlot4Base,
      profile.pullRate,
      getOverrides(profile, 'normal', 'common4')
    );
    options = applyFinalRateMultiplier(options, rateMultiplier);

    results.push(
      chooseRarityAndFile(
        options,
        userId,
        useSpecialRates,
        summerIsland
      )
    );
  }

  const uncommonSlotBases = [
    [
      { key: 'U', weight: 87.75 },
      { key: 'RR', weight: 12.0 },
      { key: 'SY', weight: 0.25 },
    ],
    [
      { key: 'U', weight: 95.75 },
      { key: 'SR', weight: 4.0 },
      { key: 'SY', weight: 0.25 },
    ],
    [
      { key: 'U', weight: 96.5 },
      { key: 'OSR', weight: 3.0 },
      { key: 'UR', weight: 0.5 },
    ],
  ];

  for (let i = 0; i < uncommonSlotBases.length; i += 1) {
    const slotName = `uncommon${i + 1}`;

    let options = buildSlotOptions(
      uncommonSlotBases[i],
      profile.pullRate,
      getOverrides(profile, 'normal', slotName)
    );
    options = applyFinalRateMultiplier(options, rateMultiplier);

    results.push(
      chooseRarityAndFile(
        options,
        userId,
        useSpecialRates,
        summerIsland
      )
    );
  }

  const rareBase = [
    { key: 'R', weight: 99.58 },
    { key: 'OUR', weight: 0.39 },
    { key: 'SEC', weight: 0.03 },
  ];

  {
    const baseOverrides = getOverrides(profile, 'normal', 'rare');

    const pityOverrides = opts?.forceSEC
      ? { SEC: 100 }
      : null;

    let options = buildSlotOptions(
      rareBase,
      profile.pullRate,
      baseOverrides
    );
    options = applyFinalRateMultiplier(options, rateMultiplier);
    if (pityOverrides) {
      options = applyAbsoluteOverrides(options, pityOverrides);
    }

    results.push(
      chooseRarityAndFile(
        options,
        userId,
        useSpecialRates,
        summerIsland
      )
    );
  }

  // Existing extra slot is left unchanged.
  // Its configured chance is currently zero in extraSlot.js.
  const extra = rollExtraSlot(
    userId,
    profile,
    useSpecialRates,
    opts
  );

  if (extra) {
    results.push(extra);
  }

  return results;
}

module.exports = { drawPack };
