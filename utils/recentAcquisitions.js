// utils/recentAcquisitions.js
// Shared rarity/window helpers for the universal acquisition watcher and /recents.

const RARITY_ORDER = Object.freeze([
  'C', 'U', 'R', 'S', 'RR', 'OC', 'SR', 'XMAS', 'VAL', 'EAS', 'SUN', 'EV',
  '★★★', 'COL', 'OSR', 'P', 'SP', '★★★★', 'UP', 'SY', 'UR', 'OUR', 'HR',
  'BDAY', '★★★★★', 'SEC', 'ORI',
]);

const HIDDEN_FROM_RECENTS = new Set(['C', 'U', 'R', 'S', 'RR', 'OC', 'P']);
const DEFAULT_RECENT_RARITIES = new Set(
  RARITY_ORDER.filter(rarity => !HIDDEN_FROM_RECENTS.has(rarity))
);

const RETENTION_DAYS = 30;
const MAX_ACQUISITION_BATCHES = 500;

function normalizeRarity(value) {
  return String(value ?? '').trim().toUpperCase();
}

function isTrackedRarity(rarity) {
  return DEFAULT_RECENT_RARITIES.has(normalizeRarity(rarity));
}

function getJstDayStart(date = new Date()) {
  const JST_MS = 9 * 60 * 60 * 1000;
  const shifted = new Date(date.getTime() + JST_MS);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      0, 0, 0, 0
    ) - JST_MS
  );
}

function getRetentionCutoff(now = new Date()) {
  return new Date(
    getJstDayStart(now).getTime() -
    (RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000
  );
}

function parseRaritySelector(raw) {
  const text = String(raw || '').trim();

  if (!text) {
    return {
      rarities: new Set(DEFAULT_RECENT_RARITIES),
      label: 'Default notable rarities',
    };
  }

  const selected = new Set();
  const tokens = text.split(',').map(x => x.trim()).filter(Boolean);

  if (!tokens.length) {
    return { error: 'Please provide at least one rarity.' };
  }

  for (const rawToken of tokens) {
    const plus = rawToken.endsWith('+');
    const token = normalizeRarity(plus ? rawToken.slice(0, -1) : rawToken);
    const index = RARITY_ORDER.indexOf(token);

    if (index < 0) {
      return { error: `Unknown rarity \`${rawToken}\`.` };
    }

    if (plus) {
      for (const rarity of RARITY_ORDER.slice(index)) selected.add(rarity);
    } else {
      selected.add(token);
    }
  }

  return {
    rarities: selected,
    label: [...selected].join(', '),
  };
}

module.exports = {
  RARITY_ORDER,
  HIDDEN_FROM_RECENTS,
  DEFAULT_RECENT_RARITIES,
  RETENTION_DAYS,
  MAX_ACQUISITION_BATCHES,
  normalizeRarity,
  isTrackedRarity,
  getJstDayStart,
  getRetentionCutoff,
  parseRaritySelector,
};
