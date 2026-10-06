// utils/summerEvent.js
const config = require('../config.json');
const { normalizeIsland } = require('../config/summer-cards');

const EVENT_NAME = 'Hello! A Brand New Summer!';
const EVENT_RARITY = 'SUN';

// 2026-08-01 00:00 JST through 2026-09-01 00:00 JST.
const EVENT_START_AT = new Date('2026-07-31T15:00:00.000Z');
const EVENT_END_AT = new Date('2026-08-31T15:00:00.000Z');

function firstNonEmpty(...values) {
  return values.find(value => typeof value === 'string' && value.trim().length > 0) || null;
}

function getIslandChannelIds() {
  const grouped = config.summerIslandChannels || {};

  return {
    red: firstNonEmpty(grouped.red, config.summerRedIslandChannelId),
    yellow: firstNonEmpty(grouped.yellow, config.summerYellowIslandChannelId),
    green: firstNonEmpty(grouped.green, config.summerGreenIslandChannelId),
    blue: firstNonEmpty(grouped.blue, config.summerBlueIslandChannelId),
  };
}

function isSummerEventActive(now = new Date()) {
  // Optional testing switch. Remove it or leave it false for production dates.
  if (config.summerEventForceActive === true) return true;

  const time = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return Number.isFinite(time)
    && time >= EVENT_START_AT.getTime()
    && time < EVENT_END_AT.getTime();
}

function getSummerBonusChance() {
  const configured = Number(config.summerSunBonusChance);
  if (!Number.isFinite(configured)) return 0.05;
  return Math.max(0, Math.min(1, configured));
}

function getIslandChannelId(island) {
  const key = normalizeIsland(island);
  if (!key) return null;
  return getIslandChannelIds()[key] || null;
}

function getIslandFromChannelId(channelId) {
  const target = String(channelId ?? '').trim();
  if (!target) return null;

  const match = Object.entries(getIslandChannelIds())
    .find(([, id]) => id && String(id) === target);
  return match ? match[0] : null;
}

function getMissingIslandChannelConfigs() {
  return Object.entries(getIslandChannelIds())
    .filter(([, id]) => !id)
    .map(([island]) => island);
}

module.exports = {
  EVENT_NAME,
  EVENT_RARITY,
  EVENT_START_AT,
  EVENT_END_AT,
  getIslandChannelIds,
  getIslandChannelId,
  getIslandFromChannelId,
  getMissingIslandChannelConfigs,
  getSummerBonusChance,
  isSummerEventActive,
};
