// utils/drawPackSpecial.js
const path = require('path');
const pools = require('./loadImages');
const { pickCardFromRarityFolder } = require('./cardPicker');

function rand() {
  return Math.random();
}

function pickWeighted(options) {
  const total = options.reduce((s, o) => s + (o.weight || 0), 0);
  let r = rand() * total;
  for (const o of options) {
    if (r <= o.weight) return o.key;
    r -= o.weight;
  }
  return options[options.length - 1].key;
}

function scaleSlotOdds(baseOptions, rate) {
  if (!Array.isArray(baseOptions) || baseOptions.length === 0) return baseOptions;
  const baseKey = baseOptions[0].key;

  if (rate <= 0) return [{ key: baseKey, weight: 100 }];

  let nonBaseSum = 0;
  const scaledNonBase = [];

  for (const opt of baseOptions) {
    if (!opt || typeof opt.weight !== 'number') continue;
    if (opt.key === baseKey) continue;

    const w = opt.weight * rate;
    nonBaseSum += w;
    scaledNonBase.push({ key: opt.key, weight: w });
  }

  const baseWeight = Math.max(0, 100 - nonBaseSum);
  return [{ key: baseKey, weight: baseWeight }, ...scaledNonBase];
}

function applyAbsoluteOverrides(slotOptions, overrides = {}, { warn = true } = {}) {
  if (!Array.isArray(slotOptions) || slotOptions.length === 0) return slotOptions;
  if (!overrides || typeof overrides !== 'object') return slotOptions;

  const baseKey = String(slotOptions[0].key);
  const byKey = new Map(slotOptions.map((o) => [String(o.key), { key: o.key, weight: o.weight }]));

  for (const [k, v] of Object.entries(overrides)) {
    const key = String(k);
    const w = Number(v);
    if (!Number.isFinite(w) || w < 0) continue;

    if (byKey.has(key)) byKey.get(key).weight = w;
    else byKey.set(key, { key, weight: w });
  }

  let nonBaseSum = 0;
  for (const [k, obj] of byKey.entries()) {
    if (k === baseKey) continue;
    nonBaseSum += Number(obj.weight) || 0;
  }

  const newBase = 100 - nonBaseSum;
  if (newBase < 0) {
    if (warn) {
      console.warn('[applyAbsoluteOverrides] overrides exceed 100%. Clamping base to 0.', {
        baseKey,
        nonBaseSum,
        overrides,
      });
    }
    byKey.get(baseKey).weight = 0;
  } else {
    byKey.get(baseKey).weight = newBase;
  }

  const originalOrder = slotOptions.map((o) => String(o.key));
  const out = [];
  const seen = new Set();

  out.push(byKey.get(baseKey));
  seen.add(baseKey);

  for (const k of originalOrder) {
    if (seen.has(k)) continue;
    if (byKey.has(k)) {
      out.push(byKey.get(k));
      seen.add(k);
    }
  }

  for (const [k, obj] of byKey.entries()) {
    if (seen.has(k)) continue;
    out.push(obj);
  }

  return out;
}

function buildSlotOptions(baseOptions, rate, overridesForSlot) {
  const scaled = scaleSlotOdds(baseOptions, rate);
  return applyAbsoluteOverrides(scaled, overridesForSlot);
}

// ---- Same user profiles as newWeightedDraw.js ----
const rateProfiles = (() => {
  const m = new Map();

  m.set('1334914199968677941', {
    pullRate: 0.33,
    extraSlotRate: 0.0,
    specialPullRate: 0.0,
    overrides: { normal: {}, special: {}, boss: {} },
  });

  [
    '953552994232852490',
    '1188023588926795827',
    '1300468334474690583',
    '1416081468794339479',
    '91103688415776768',
    '647219814011502607',
    '875533483051712543',
  ].forEach((id) =>
    m.set(String(id), {
      pullRate: 0.50,
      extraSlotRate: 0.0,
      specialPullRate: 0.0,
      overrides: { normal: {}, special: {}, boss: {} },
    })
  );

  m.set('1171127294413246567', {
    pullRate: 0.66,
    extraSlotRate: 1.0,
    specialPullRate: 0.50,
    overrides: { normal: {}, special: {}, boss: {} },
  });

  return m;
})();

function getUserProfile(userId) {
  const idStr = String(userId);
  return (
    rateProfiles.get(idStr) || {
      pullRate: 1.0,
      extraSlotRate: 1.0,
      specialPullRate: 1.0,
      overrides: { normal: {}, special: {}, boss: {} },
    }
  );
}

function getOverrides(profile, mode, slotName) {
  return profile?.overrides?.[mode]?.[slotName] || null;
}

function fallbackPickFromPools(rarity) {
  if (pools.special && pools.special[rarity] && pools.special[rarity].length > 0) {
    return pools.special[rarity][Math.floor(Math.random() * pools.special[rarity].length)];
  }
  if (pools.other && pools.other[rarity] && pools.other[rarity].length > 0) {
    return pools.other[rarity][Math.floor(Math.random() * pools.other[rarity].length)];
  }
  if (pools[rarity] && pools[rarity].length > 0) {
    return pools[rarity][Math.floor(Math.random() * pools[rarity].length)];
  }
  return `${rarity}-unknown-001.png`;
}

async function pickForSlot(rarity, specialLabel) {
  if (specialLabel) {
    try {
      const picked = await pickCardFromRarityFolder(rarity, specialLabel, { avoidImmediateRepeat: true });
      if (picked) return picked;
    } catch (err) {
      // fall through
    }
  }

  try {
    const fallback = await pickCardFromRarityFolder(rarity, null, { avoidImmediateRepeat: true });
    if (fallback) return fallback;
  } catch (err) {
    // fall through
  }

  const raw = fallbackPickFromPools(rarity);
  return path.basename(raw, path.extname(raw));
}

async function drawPackSpecial(userId, specialLabel) {
  const results = [];
  const profile = getUserProfile(userId);

  // Special pulls use specialPullRate (your rule) [3](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/drawPackSpecial.js)
  const rate = profile.specialPullRate;

  // --- Common slots (4) ---
  const commonSlot1Base = [
    { key: 'C', weight: 93.8 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 1.1 },
    { key: 'BDAY', weight: 1.1 },
  ];
  {
    const options = buildSlotOptions(commonSlot1Base, rate, getOverrides(profile, 'special', 'common1'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, specialLabel);
    results.push({ rarity, file });
  }

  const commonSlot2Base = [
    { key: 'C', weight: 94.0 },
    { key: 'S', weight: 4.0 },
    { key: 'OC', weight: 2.0 },
  ];
  {
    const options = buildSlotOptions(commonSlot2Base, rate, getOverrides(profile, 'special', 'common2'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, specialLabel);
    results.push({ rarity, file });
  }

  const commonSlot3Base = [
    { key: 'C', weight: 94.9 },
    { key: 'S', weight: 4.0 },
    { key: 'BDAY', weight: 1.1 },
  ];
  {
    const options = buildSlotOptions(commonSlot3Base, rate, getOverrides(profile, 'special', 'common3'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, specialLabel);
    results.push({ rarity, file });
  }

  const commonSlot4Base = [
    { key: 'C', weight: 94.9 },
    { key: 'S', weight: 4.0 },
    { key: 'HR', weight: 1.1 },
  ];
  {
    const options = buildSlotOptions(commonSlot4Base, rate, getOverrides(profile, 'special', 'common4'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, specialLabel);
    results.push({ rarity, file });
  }

  // --- Uncommon slots (3) ---
  const uncommonSlotBases = [
    [
      { key: 'U', weight: 88.75 },
      { key: 'RR', weight: 10.0 },
      { key: 'SY', weight: 1.25 },
    ],
    [
      { key: 'U', weight: 95.75 },
      { key: 'SR', weight: 3.0 },
      { key: 'SY', weight: 1.25 },
    ],
    [
      { key: 'U', weight: 95.5 },
      { key: 'OSR', weight: 3.0 },
      { key: 'UR', weight: 1.5 },
    ],
  ];

  for (let i = 0; i < uncommonSlotBases.length; i++) {
    const slotName = `uncommon${i + 1}`;
    const options = buildSlotOptions(uncommonSlotBases[i], rate, getOverrides(profile, 'special', slotName));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, specialLabel);
    results.push({ rarity, file });
  }

  // --- Rare slot (1) ---
  const rareBase = [
    { key: 'R', weight: 99.1 },
    { key: 'OUR', weight: 0.9 },
    { key: 'SEC', weight: 0.1 },
  ];
  {
    const options = buildSlotOptions(rareBase, rate, getOverrides(profile, 'special', 'rare'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, specialLabel);
    results.push({ rarity, file });
  }

  if (!Array.isArray(results) || results.length !== 8) {
    console.warn('[drawPackSpecial] unexpected results length', { length: results.length });
  }

  return results;
}

module.exports = { drawPackSpecial };