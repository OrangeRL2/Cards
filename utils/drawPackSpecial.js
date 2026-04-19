// utils/drawPackSpecial.js
const path = require('path');
const pools = require('./loadImages');
const { pickCardFromRarityFolder } = require('./cardPicker');
const { pickWeighted, buildSlotOptions, getUserProfile, getOverrides } = require('./rates');
const { rollExtraSlot } = require('./extraSlot');

/**
 * Map a "special event label" -> list of folder labels it can become.
 * Keys are compared case-insensitively.
 */
const gachaMap = {
  hololive: ['Iofi', 'Risu', 'Moona', 'Anya', 'Ollie', 'Reine', 'Kaela', 'Kobo', 'Zeta', 'Achan', 'Nodoka', 'Ina', 'Amelia', 'Calli', 'Gura', 'Kiara', 'Baelz', 'Kronii', 'Mumei', 'IRyS', 'Fauna', 'Sana', 'Bijou', 'Fuwawa', 'Mococo', 'Nerissa', 'Shiori', 'Gigi', 'Elizabeth', 'Cecilia', 'Raora', 'AZKi', 'Sora', 'Suisei', 'Roboco', 'Miko', 'Mel', 'Haato', 'Aki', 'Matsuri', 'Fubuki', 'Korone', 'Okayu', 'Mio', 'Aqua', 'Ayame', 'Shion', 'Choco', 'Subaru', 'Marine', 'Flare', 'Noel', 'Pekora', 'Luna', 'Towa', 'Watame', 'Kanata', 'Coco', 'Lamy', 'Nene', 'Polka', 'Botan', 'Aloe', 'Chloe', 'Iroha', 'Koyori', 'La+', 'Lui', 'Ao', 'Kanade', 'Hajime', 'Raden', 'Ririka', 'Riona', 'Niko', 'Chihaya', 'Vivi', 'Su'],
  stage1: ['Fubuki', 'Ayame', 'Choco', 'Okayu', 'Pekora', 'Flare', 'Watame', 'Lamy', 'Polka', 'Lui', 'Koyori', 'Zeta', 'Kobo', 'Ina', 'Fuwawa', 'Mococo'],
  stage2: ['Sora', 'Miko', 'Subaru', 'Mio', 'Nene', 'Botan', 'La+', 'Iofi', 'Ollie', 'Kiara', 'Elizabeth', 'Gigi', 'Cecilia', 'Raora'],
  stage3: ['AZKi', 'Matsuri', 'Noel', 'Luna', 'Iroha', 'Risu', 'Reine', 'IRyS', 'Baelz', 'Shiori', 'Riona', 'Niko', 'Su', 'Chihaya', 'Vivi'],
  stage4: ['Roboco', 'Suisei', 'Aki', 'Marine', 'Towa', 'Moona', 'Anya', 'Kaela', 'Calli', 'Kronii', 'Bijou', 'Nerissa', 'Kanade', 'Ririka', 'Hajime', 'Raden'],
};

/** Pick 1 element uniformly from an array */
function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
const MONTHLY_BDAYS_BASE = process.env.MONTHLY_BDAYS_BASE || 'assets/montlybdays';
const OSR_BASE = process.env.OSR_BASE || 'assets/special/OSR';
/**
 * Resolve the incoming specialLabel into the actual folder label used for pulls.
 * - If specialLabel matches a gachaMap key, pick one variant ONCE per pack.
 * - Otherwise, use the label as-is.
 */
function resolveSpecialVariantLabel(specialLabel) {
  if (!specialLabel) return { baseLabel: null, variantLabel: null };

  const base = String(specialLabel).trim();
  const key = base.toLowerCase();

  const variants = gachaMap[key];
  if (Array.isArray(variants) && variants.length > 0) {
    return { baseLabel: base, variantLabel: pickOne(variants) };
  }
  return { baseLabel: base, variantLabel: base };
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
  const R = String(rarity || '').toUpperCase();

  // ✅ Special-pull BDAY: try monthly base first (with label, then without)
  if (R === 'BDAY') {
    try {
      const pickedMonthly = await pickCardFromRarityFolder(
        'BDAY',
        specialLabel || null,
        { avoidImmediateRepeat: true, baseDir: MONTHLY_BDAYS_BASE }
      );
      if (pickedMonthly) return pickedMonthly;
    } catch {}

    // If label search found nothing, try neutral monthly pick
    try {
      const pickedMonthlyNeutral = await pickCardFromRarityFolder(
        'BDAY',
        null,
        { avoidImmediateRepeat: true, baseDir: MONTHLY_BDAYS_BASE }
      );
      if (pickedMonthlyNeutral) return pickedMonthlyNeutral;
    } catch {}
    // If monthly folder is missing/empty, fall through to normal BDAY behavior below.
  }

    else if (R === 'OSR') {
    try {
      const pickedOSR = await pickCardFromRarityFolder(
        'OSR',
        specialLabel || null,
        { avoidImmediateRepeat: true, baseDir: OSR_BASE }
      );
      if (pickedOSR) return pickedOSR;
    } catch {}

    // If label search found nothing, try neutral monthly pick
    try {
      const pickedOSRNeutral = await pickCardFromRarityFolder(
        'OSR',
        null,
        { avoidImmediateRepeat: true, baseDir: OSR_BASE }
      );
      if (pickedOSRNeutral) return pickedOSRNeutral;
    } catch {}
    // If osr folder is missing/empty, fall through to normal OSR behavior below.
  }

  // Existing behavior: label-biased pick from default ASSETS_BASE/<RARITY>
  if (specialLabel) {
    try {
      const picked = await pickCardFromRarityFolder(rarity, specialLabel, { avoidImmediateRepeat: true });
      if (picked) return picked;
    } catch {}
  }

  // Fallback: neutral pick from default
  try {
    const fallback = await pickCardFromRarityFolder(rarity, null, { avoidImmediateRepeat: true });
    if (fallback) return fallback;
  } catch {}

  // Last fallback: pool fallback
  const raw = fallbackPickFromPools(rarity);
  return path.basename(raw, path.extname(raw));
}


async function drawPackSpecial(userId, specialLabel, opts = {}) {
  const results = [];

  // ✅ Resolve gacha variant ONCE per pack
  const { baseLabel, variantLabel } = resolveSpecialVariantLabel(specialLabel);

  const profile = getUserProfile(userId);
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
    const file = await pickForSlot(rarity, variantLabel); // ✅ use variantLabel
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
    const file = await pickForSlot(rarity, variantLabel);
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
    const file = await pickForSlot(rarity, variantLabel);
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
    const file = await pickForSlot(rarity, variantLabel);
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
    const file = await pickForSlot(rarity, variantLabel);
    results.push({ rarity, file });
  }

  // --- Rare slot (1) ---
  const rareBase = [
    { key: 'R', weight: 99.1 },
    { key: 'OUR', weight: 0.9 },
    { key: 'SEC', weight: 0.1 },
  ];
  {
    const baseOverrides = getOverrides(profile, 'special', 'rare');
    const pityOverrides = (opts && opts.forceSEC) ? { SEC: 100, OUR: 0, R: 0 } : null;
    const mergedOverrides = pityOverrides
      ? { ...(baseOverrides || {}), ...pityOverrides }
      : baseOverrides;

    const options = buildSlotOptions(rareBase, rate, mergedOverrides);
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, variantLabel);
    results.push({ rarity, file });
  }

  // ✅ Optional meta return without breaking old callers
  if (opts && opts.withMeta) {
    return { results, baseLabel, variantLabel };
  }
  // --- Extra slot (mirrors normal pack behavior) ---
  const baseExtraChance = 0.00; // 40% base chance for the extra slot to appear
  const extraChance = baseExtraChance * (profile.extraSlotRate ?? 1.0);

  if (Math.random() < extraChance) {
    // Keep rarity odds unchanged (same approach as newWeightedDraw)
    const extraBase = [{ key: 'EAS', weight: 100 }];
    const extraRarity = pickWeighted(extraBase);

    // For special packs, it's usually nicer if the extra slot follows the same "variant label"
    // so it feels themed with the pack. If you want it neutral, pass null instead.
    const extraFile = await pickForSlot(extraRarity, variantLabel);

    results.push({ rarity: extraRarity, file: extraFile, slot: 'extra' });
  }

  // Extra slot (same settings as newWeightedDraw.js: chance + weighted card selection)
  // Special pack doesn't currently calculate "useSpecialRates", so we pass false.
  const extra = rollExtraSlot(userId, profile, false, opts);
  if (extra) results.push(extra);

  return results;
}

module.exports = { drawPackSpecial };