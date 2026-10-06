// utils/rarities.js
// `rarity` contains standard card rarities.
// `rarity2` contains event/special rarities and HOLODORI star tiers.
// Both options still filter the same stored card.rarity field.
const STANDARD_RARITIES = Object.freeze([
  'C', 'U', 'R', 'S', 'RR', 'OC', 'SR', 'COL', 'OSR',
  'P', 'SP', 'UP', 'SY', 'UR', 'OUR', 'HR', 'BDAY', 'SEC', 'ORI', 'EV',
]);

const SPECIAL_RARITIES = Object.freeze([
  'XMAS', 'VAL', 'EAS', 'SUN', '★★★', '★★★★', '★★★★★',
]);

const RARITIES = Object.freeze([...SPECIAL_RARITIES, ...STANDARD_RARITIES]);

function asChoices(values) {
  return values.map(rarity => ({ name: rarity, value: rarity }));
}

function rarityChoices({ includeAnyAll = false, group = 'standard' } = {}) {
  let values;
  if (group === 'special' || group === 'rarity2') values = SPECIAL_RARITIES;
  else if (group === 'all') values = RARITIES;
  else values = STANDARD_RARITIES;

  const base = asChoices(values);
  if (!includeAnyAll) return base;

  return [{ name: 'Any rarity', value: 'any' }, ...base];
}

function parseRarityFilter(input) {
  if (!input) return { any: true, rarity: null };
  const raw = String(input).trim();
  const lower = raw.toLowerCase();
  if (lower === 'any' || lower === 'all' || raw === '*') {
    return { any: true, rarity: null };
  }
  return { any: false, rarity: raw.toUpperCase() };
}

function resolveRarityOptions(interaction, {
  primary = 'rarity',
  secondary = 'rarity2',
  required = false,
} = {}) {
  const rarity = interaction.options.getString(primary);
  const rarity2 = interaction.options.getString(secondary);

  if (rarity && rarity2) {
    return {
      error: `Choose either \`${primary}\` or \`${secondary}\`, not both.`,
      raw: null,
      any: false,
      rarity: null,
    };
  }

  const raw = rarity2 || rarity || null;
  if (required && !raw) {
    return {
      error: `Choose either \`${primary}\` or \`${secondary}\`.`,
      raw: null,
      any: false,
      rarity: null,
    };
  }

  return { error: null, raw, ...parseRarityFilter(raw) };
}

module.exports = {
  STANDARD_RARITIES,
  SPECIAL_RARITIES,
  RARITIES,
  rarityChoices,
  parseRarityFilter,
  resolveRarityOptions,
};
