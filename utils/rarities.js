const RARITIES = [
  'XMAS','VAL','EAS','C','U','R','S','RR','OC','SR','COL','OSR','P','SP','UP','SY','UR','OUR','HR','BDAY','SEC','ORI',
];

function rarityChoices({ includeAnyAll = false } = {}) {
  const base = RARITIES.map(r => ({ name: r, value: r }));
  if (!includeAnyAll) return base;

  return [
    { name: 'Any (match any rarity)', value: 'any' },
    { name: 'All (same as any)', value: 'all' },
    ...base,
  ];
}

function parseRarityFilter(input) {
  if (!input) return { any: true, rarity: null };
  const v = String(input).trim().toLowerCase();
  if (v === 'any' || v === 'all') return { any: true, rarity: null };
  return { any: false, rarity: v.toUpperCase() };
}

module.exports = { RARITIES, rarityChoices, parseRarityFilter };