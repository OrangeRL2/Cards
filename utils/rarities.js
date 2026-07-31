// utils/rarities.js

const RARITIES = [
  'XMAS',
  'VAL',
  'EAS',
  'SUN',
  'C',
  'U',
  'R',
  'S',
  'RR',
  'OC',
  'SR',
  'COL',
  'OSR',
  'P',
  'SP',
  'UP',
  'SY',
  'UR',
  'OUR',
  'HR',
  'BDAY',
  'SEC',
  'ORI',
  'EV',
];

function rarityChoices({ includeAnyAll = false } = {}) {
  const base = RARITIES.map(rarity => ({
    name: rarity,
    value: rarity,
  }));

  if (!includeAnyAll) {
    return base;
  }

  // Discord permits a maximum of 25 choices.
  // There are 24 rarities, so only one wildcard choice can be included.
  return [
    {
      name: 'Any rarity',
      value: 'any',
    },
    ...base,
  ];
}

function parseRarityFilter(input) {
  if (!input) {
    return {
      any: true,
      rarity: null,
    };
  }

  const value = String(input).trim().toLowerCase();

  // Keep "all" supported internally for backward compatibility,
  // even though only "any" is shown in slash-command choices.
  if (value === 'any' || value === 'all') {
    return {
      any: true,
      rarity: null,
    };
  }

  return {
    any: false,
    rarity: value.toUpperCase(),
  };
}

module.exports = {
  RARITIES,
  rarityChoices,
  parseRarityFilter,
};