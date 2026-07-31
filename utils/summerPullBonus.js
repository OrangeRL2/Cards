// utils/summerPullBonus.js
const path = require('node:path');
const SummerUser = require('../models/SummerUser');
const config = require('../config.json');
const {
  getIslandCards,
  getIslandFolder,
  normalizeIsland,
} = require('../config/summer-cards');
const {
  EVENT_RARITY,
  getIslandChannelId,
  isSummerEventActive,
} = require('./summerEvent');

const DEFAULT_BONUS_CHANCE = 0.05;
const DEFAULT_ASSETS_ROOT = path.join(__dirname, '..', 'assets', 'images');

function randomItem(items, rng = Math.random) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const index = Math.floor(rng() * items.length);
  return items[Math.max(0, Math.min(items.length - 1, index))];
}

function normalizeIdSet(values) {
  if (!Array.isArray(values)) return new Set();
  return new Set(
    values
      .map(value => String(value ?? '').trim())
      .filter(Boolean)
  );
}

function normalizeRoleIds(roleIds) {
  if (!roleIds) return [];
  if (Array.isArray(roleIds)) return roleIds;
  if (typeof roleIds[Symbol.iterator] === 'function') return [...roleIds];
  return [];
}

function hasStaffChannelBypass(userId, roleIds) {
  const bypassUsers = normalizeIdSet(config.summerChannelBypassUserIds);
  const bypassRoles = normalizeIdSet(config.summerChannelBypassRoleIds);
  const discordId = String(userId ?? '').trim();

  if (discordId && bypassUsers.has(discordId)) return true;

  return normalizeRoleIds(roleIds).some(roleId =>
    bypassRoles.has(String(roleId ?? '').trim())
  );
}

/**
 * During Summer, ordinary users must pull in their selected island channel.
 * Exceptions:
 * - bossChannelPullId keeps its normal boss-biased behavior;
 * - configured staff user IDs and role IDs may pull in any channel.
 *
 * Both exceptions still load and return the player's permanently selected
 * island, so normal pulls and SUN bonus cards remain tied to that island.
 */
async function validateSummerPullChannel({
  userId,
  channelId,
  roleIds = [],
  now = new Date(),
}) {
  if (!isSummerEventActive(now)) {
    return {
      allowed: true,
      summerActive: false,
      island: null,
      expectedChannelId: null,
      summerUser: null,
      isBossChannel: false,
      isStaffChannelBypass: false,
    };
  }

  const discordId = String(userId ?? '').trim();
  if (!discordId) {
    return {
      allowed: false,
      summerActive: true,
      reason: 'INVALID_USER',
      message: 'Could not identify your Summer event profile.',
    };
  }

  const summerUser = await SummerUser.findOne({ userId: discordId }).lean().exec();
  const island = normalizeIsland(summerUser?.island);

  if (!island) {
    return {
      allowed: false,
      summerActive: true,
      reason: 'NO_ISLAND',
      message: 'Choose your island with `/summer` before using regular pulls during the Summer event.',
      summerUser,
    };
  }

  const currentChannelId = String(channelId ?? '').trim();
  const bossChannelId = String(config.bossChannelPullId ?? '').trim();
  const isBossChannel = Boolean(bossChannelId) && currentChannelId === bossChannelId;
  const isStaffChannelBypass = hasStaffChannelBypass(discordId, roleIds);

  if (isBossChannel || isStaffChannelBypass) {
    return {
      allowed: true,
      summerActive: true,
      island,
      expectedChannelId: getIslandChannelId(island) || null,
      summerUser,
      isBossChannel,
      isStaffChannelBypass,
    };
  }

  const expectedChannelId = getIslandChannelId(island);
  if (!expectedChannelId) {
    return {
      allowed: false,
      summerActive: true,
      reason: 'CHANNEL_NOT_CONFIGURED',
      message: `The ${island} island channel has not been configured yet. Please contact an administrator.`,
      island,
      summerUser,
    };
  }

  if (currentChannelId !== String(expectedChannelId)) {
    return {
      allowed: false,
      summerActive: true,
      reason: 'WRONG_CHANNEL',
      message: `You joined **${capitalize(island)} Island** for this event. Use your regular pull in <#${expectedChannelId}>.`,
      island,
      expectedChannelId,
      summerUser,
      isBossChannel: false,
      isStaffChannelBypass: false,
    };
  }

  return {
    allowed: true,
    summerActive: true,
    island,
    expectedChannelId,
    summerUser,
    isBossChannel: false,
    isStaffChannelBypass: false,
  };
}

function rollSummerBonus({
  summerContext,
  chance = DEFAULT_BONUS_CHANCE,
  assetsRoot = DEFAULT_ASSETS_ROOT,
  rng = Math.random,
} = {}) {
  if (!summerContext?.summerActive || !summerContext?.allowed) return null;

  const island = normalizeIsland(summerContext.island);
  if (!island) return null;

  const normalizedChance = Math.max(0, Math.min(1, Number(chance) || 0));
  if (rng() >= normalizedChance) return null;

  const cards = getIslandCards(island);
  const cardName = randomItem(cards, rng);
  const folder = getIslandFolder(island);

  if (!cardName || !folder) return null;

  const filename = `${cardName}.png`;
  const file = path.join(assetsRoot, EVENT_RARITY, folder, filename);

  return {
    rarity: EVENT_RARITY,
    name: cardName,
    cardName,
    island,
    islandFolder: folder,
    filename,
    file,
    relativeImagePath: `${EVENT_RARITY}/${folder}/${filename}`,
    isSummerBonus: true,
    slot: 9,
  };
}

function capitalize(value) {
  const text = String(value ?? '');
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

module.exports = {
  DEFAULT_BONUS_CHANCE,
  DEFAULT_ASSETS_ROOT,
  validateSummerPullChannel,
  rollSummerBonus,
  hasStaffChannelBypass,
};
