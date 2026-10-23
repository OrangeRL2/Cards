// utils/recentPulls.js
// Compact recent high-rarity/event pull history for /recents.
const User = require('../models/User');

const RECENT_PULL_RETENTION_DAYS = 30;
const RECENT_PULL_MAX_BATCHES = 500;

const RARITY_ORDER = Object.freeze([
  'C', 'U', 'R', 'S', 'RR', 'OC', 'SR', 'XMAS', 'VAL', 'EAS', 'SUN', 'EV',
  '★★★', 'COL', 'OSR', 'P', 'SP', '★★★★', 'UP', 'SY', 'UR', 'OUR', 'HR',
  'BDAY', '★★★★★', 'SEC', 'ORI',
]);

const HIDDEN_FROM_RECENTS = new Set(['C', 'U', 'R', 'S', 'RR', 'OC', 'P']);
const DEFAULT_RECENT_RARITIES = new Set(
  RARITY_ORDER.filter(rarity => !HIDDEN_FROM_RECENTS.has(rarity))
);

function normalizeRarity(value) {
  return String(value ?? '').trim().toUpperCase();
}

function isTrackedRecentRarity(rarity) {
  return DEFAULT_RECENT_RARITIES.has(normalizeRarity(rarity));
}

function getJstDayStart(date = new Date()) {
  const offset = 9 * 60 * 60 * 1000;
  const shifted = new Date(date.getTime() + offset);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 0, 0, 0, 0
  ) - offset);
}

function retentionCutoff(now = new Date()) {
  const startToday = getJstDayStart(now);
  return new Date(startToday.getTime() - (RECENT_PULL_RETENTION_DAYS - 1) * 86400000);
}

async function recordRecentPullBatch(userId, cards, pulledAt = new Date()) {
  const qualifying = (Array.isArray(cards) ? cards : [])
    .map(card => ({
      rarity: normalizeRarity(card?.rarity),
      name: String(card?.name ?? card?.displayName ?? '').trim(),
    }))
    .filter(card => card.name && isTrackedRecentRarity(card.rarity));

  const cutoff = retentionCutoff(pulledAt);
  await User.updateOne(
    { id: String(userId) },
    { $pull: { recentPulls: { pulledAt: { $lt: cutoff } } } }
  ).exec();

  if (!qualifying.length) return 0;

  await User.updateOne(
    { id: String(userId) },
    { $push: { recentPulls: { $each: [{ pulledAt, cards: qualifying }], $slice: -RECENT_PULL_MAX_BATCHES } } }
  ).exec();
  return qualifying.length;
}

module.exports = {
  RARITY_ORDER,
  HIDDEN_FROM_RECENTS,
  DEFAULT_RECENT_RARITIES,
  RECENT_PULL_RETENTION_DAYS,
  RECENT_PULL_MAX_BATCHES,
  normalizeRarity,
  isTrackedRecentRarity,
  getJstDayStart,
  recordRecentPullBatch,
};
