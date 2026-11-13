// utils/newWeightedDraw.js
const path = require('path');

const PullQuota = require('../models/PullQuota');
const pools = require('../utils/loadImages');

const {
  pickWeighted,
  buildSlotOptions,
  getUserProfile,
  getOverrides,
} = require('../utils/rates');

const {
  pickFileFromPool,
  rollExtraSlot,
  specialUserIds,
  otherUserIds,
} = require('../utils/extraSlot');

const { NORMAL_BOSS_BASES } = require('./pullSlotBases');

const {
  getIslandCards,
  normalizeIsland,
} = require('../config/summer-cards');

const SUMMER_MEMBER_ALIASES = Object.freeze({
  'Fubuki G': ['Fubuki'],
  Fuwawa: ['Fuwawa', 'Fuwamoco'],
  Mococo: ['Mococo', 'Fuwamoco'],
});

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
  const summerIsland = normalizeIsland(opts?.summerIsland);

  // Stack the contextual forum/thread nerf on top of the user's own pullRate.
  // 1.00 * 0.20 = 0.20
  // 0.66 * 0.20 = 0.132
  // 0.50 * 0.20 = 0.10
  // 0.33 * 0.20 = 0.066
  const requestedRateMultiplier = Number(opts?.rateMultiplier);
  const contextRateMultiplier =
    Number.isFinite(requestedRateMultiplier) && requestedRateMultiplier >= 0
      ? requestedRateMultiplier
      : 1.0;

  const effectivePullRate =
    Number(profile?.pullRate ?? 1.0) * contextRateMultiplier;

  const commonSlot1Base = NORMAL_BOSS_BASES.common1;

  {
    const options = buildSlotOptions(
      commonSlot1Base,
      effectivePullRate,
      getOverrides(profile, 'normal', 'common1')
    );

    results.push(
      chooseRarityAndFile(
        options,
        userId,
        useSpecialRates,
        summerIsland
      )
    );
  }

  const commonSlot2Base = NORMAL_BOSS_BASES.common2;

  {
    const options = buildSlotOptions(
      commonSlot2Base,
      effectivePullRate,
      getOverrides(profile, 'normal', 'common2')
    );

    results.push(
      chooseRarityAndFile(
        options,
        userId,
        useSpecialRates,
        summerIsland
      )
    );
  }

  const commonSlot3Base = NORMAL_BOSS_BASES.common3;

  {
    const options = buildSlotOptions(
      commonSlot3Base,
      effectivePullRate,
      getOverrides(profile, 'normal', 'common3')
    );

    results.push(
      chooseRarityAndFile(
        options,
        userId,
        useSpecialRates,
        summerIsland
      )
    );
  }

  const commonSlot4Base = NORMAL_BOSS_BASES.common4;

  {
    const options = buildSlotOptions(
      commonSlot4Base,
      effectivePullRate,
      getOverrides(profile, 'normal', 'common4')
    );

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
    NORMAL_BOSS_BASES.uncommon1,
    NORMAL_BOSS_BASES.uncommon2,
    NORMAL_BOSS_BASES.uncommon3,
  ];

  for (let i = 0; i < uncommonSlotBases.length; i += 1) {
    const slotName = `uncommon${i + 1}`;

    const options = buildSlotOptions(
      uncommonSlotBases[i],
      effectivePullRate,
      getOverrides(profile, 'normal', slotName)
    );

    results.push(
      chooseRarityAndFile(
        options,
        userId,
        useSpecialRates,
        summerIsland
      )
    );
  }

  const rareBase = NORMAL_BOSS_BASES.rare;

  {
    const baseOverrides = getOverrides(profile, 'normal', 'rare');

    const pityOverrides = opts?.forceSEC
      ? { SEC: 100 }
      : null;

    const mergedOverrides = pityOverrides
      ? { ...(baseOverrides || {}), ...pityOverrides }
      : baseOverrides;

    const options = buildSlotOptions(
      rareBase,
      effectivePullRate,
      mergedOverrides
    );

    results.push(
      chooseRarityAndFile(
        options,
        userId,
        useSpecialRates,
        summerIsland
      )
    );
  }

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
