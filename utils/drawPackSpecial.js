// utils/drawPackSpecial.js
const path = require('path');
const pools = require('./loadImages');
const { pickCardFromRarityFolder } = require('./cardPicker');
const { pickWeighted, buildSlotOptions, getUserProfile, getOverrides } = require('./rates');
const { SPECIAL_BASES } = require('./pullSlotBases');
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

// Special pulls use the full BDAY artwork folder, independent of the month.
const IMAGE_ASSETS_BASE = path.join(__dirname, '..', 'assets', 'images');
const configuredOsrBase = process.env.OSR_BASE;
const OSR_BASE = configuredOsrBase
  ? (path.basename(configuredOsrBase).toUpperCase() === 'OSR' ? path.dirname(configuredOsrBase) : configuredOsrBase)
  : IMAGE_ASSETS_BASE;

/**
 * Resolve the incoming specialLabel into the actual folder label used for pulls.
 * - If specialLabel matches a gachaMap key, pick one variant ONCE per pack.
 * - Otherwise, use the label as-is.
 */
function resolveSpecialVariantLabel(specialLabel) {
  if (!specialLabel) return { baseLabel: null, variantLabel: null };

  const base = String(specialLabel).trim();
  const key = base.toLowerCase();

  const variants = key === 'god' ? gachaMap.hololive : gachaMap[key];
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

  if (R === 'BDAY') {
    try {
      const pickedMonthly = await pickCardFromRarityFolder(
        'BDAY',
        specialLabel || null,
        { avoidImmediateRepeat: true, baseDir: IMAGE_ASSETS_BASE, birthdayFilter: false, includeExtension: true }
      );
      if (pickedMonthly) return pickedMonthly;
    } catch {}

    try {
      const pickedMonthlyNeutral = await pickCardFromRarityFolder(
        'BDAY',
        null,
        { avoidImmediateRepeat: true, baseDir: IMAGE_ASSETS_BASE, birthdayFilter: false, includeExtension: true }
      );
      if (pickedMonthlyNeutral) return pickedMonthlyNeutral;
    } catch {}
  } else if (R === 'OSR') {
    try {
      const pickedOSR = await pickCardFromRarityFolder(
        'OSR',
        specialLabel || null,
        { avoidImmediateRepeat: true, baseDir: OSR_BASE, includeExtension: true }
      );
      if (pickedOSR) return pickedOSR;
    } catch {}

    try {
      const pickedOSRNeutral = await pickCardFromRarityFolder(
        'OSR',
        null,
        { avoidImmediateRepeat: true, baseDir: OSR_BASE, includeExtension: true }
      );
      if (pickedOSRNeutral) return pickedOSRNeutral;
    } catch {}
  }

  if (specialLabel) {
    try {
      const picked = await pickCardFromRarityFolder(
        rarity,
        specialLabel,
        { avoidImmediateRepeat: true, baseDir: IMAGE_ASSETS_BASE, includeExtension: true }
      );
      if (picked) return picked;
    } catch {}
  }

  try {
    const fallback = await pickCardFromRarityFolder(
      rarity,
      null,
      { avoidImmediateRepeat: true, baseDir: IMAGE_ASSETS_BASE, includeExtension: true }
    );
    if (fallback) return fallback;
  } catch {}

  const raw = fallbackPickFromPools(rarity);
  // Never grant a phantom card without a file: draw failures are refunded by
  // the slash commands. Include the true extension for JPEG/WebP artwork.
  if (!require('fs').existsSync(raw)) {
    throw new Error(`No artwork available for special rarity ${rarity} (${specialLabel})`);
  }
  return path.basename(raw);
}

async function drawPackSpecial(userId, specialLabel, opts = {}) {
  const results = [];

  const { baseLabel, variantLabel } = resolveSpecialVariantLabel(specialLabel);

  // Hololive's special pack is intentionally a fixed guaranteed-rarity pack,
  // so it continues to bypass normal/special rate multipliers.
  if (['hololive', 'god'].includes(String(baseLabel || '').trim().toLowerCase())) {
    const guaranteedRarities = ['BDAY', 'OC', 'S', 'HR', 'SY', 'SY', 'UR', 'SEC'];

    for (const rarity of guaranteedRarities) {
      const file = await pickForSlot(rarity, variantLabel);
      results.push({ rarity, file });
    }

    if (opts && opts.withMeta) {
      return { results, baseLabel, variantLabel };
    }

    return results;
  }

  const profile = getUserProfile(userId);

  // Stack forum/thread context on the user's existing specialPullRate.
  const requestedRateMultiplier = Number(opts?.rateMultiplier);
  const contextRateMultiplier =
    Number.isFinite(requestedRateMultiplier) && requestedRateMultiplier >= 0
      ? requestedRateMultiplier
      : 1.0;

  const rate =
    Number(profile?.specialPullRate ?? 1.0) * contextRateMultiplier;

  // --- Common slots (4) ---
  const commonSlot1Base = SPECIAL_BASES.common1;
  {
    const options = buildSlotOptions(commonSlot1Base, rate, getOverrides(profile, 'special', 'common1'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, variantLabel);
    results.push({ rarity, file });
  }

  const commonSlot2Base = SPECIAL_BASES.common2;
  {
    const options = buildSlotOptions(commonSlot2Base, rate, getOverrides(profile, 'special', 'common2'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, variantLabel);
    results.push({ rarity, file });
  }

  const commonSlot3Base = SPECIAL_BASES.common3;
  {
    const options = buildSlotOptions(commonSlot3Base, rate, getOverrides(profile, 'special', 'common3'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, variantLabel);
    results.push({ rarity, file });
  }

  const commonSlot4Base = SPECIAL_BASES.common4;
  {
    const options = buildSlotOptions(commonSlot4Base, rate, getOverrides(profile, 'special', 'common4'));
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, variantLabel);
    results.push({ rarity, file });
  }

  // --- Uncommon slots (3) ---
  const uncommonSlotBases = [
    SPECIAL_BASES.uncommon1,
    SPECIAL_BASES.uncommon2,
    SPECIAL_BASES.uncommon3,
  ];

  for (let i = 0; i < uncommonSlotBases.length; i++) {
    const slotName = `uncommon${i + 1}`;
    const options = buildSlotOptions(
      uncommonSlotBases[i],
      rate,
      getOverrides(profile, 'special', slotName)
    );
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, variantLabel);
    results.push({ rarity, file });
  }

  // --- Rare slot (1) ---
  const rareBase = SPECIAL_BASES.rare;
  {
    const baseOverrides = getOverrides(profile, 'special', 'rare');
    const pityOverrides = (opts && opts.forceSEC)
      ? { SEC: 100, OUR: 0, R: 0 }
      : null;

    const mergedOverrides = pityOverrides
      ? { ...(baseOverrides || {}), ...pityOverrides }
      : baseOverrides;

    const options = buildSlotOptions(rareBase, rate, mergedOverrides);
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, variantLabel);
    results.push({ rarity, file });
  }

  if (opts && opts.withMeta) {
    return { results, baseLabel, variantLabel };
  }

  const baseExtraChance = 0.00;
  const extraChance = baseExtraChance * (profile.extraSlotRate ?? 1.0);

  if (Math.random() < extraChance) {
    const extraBase = [{ key: 'EAS', weight: 100 }];
    const extraRarity = pickWeighted(extraBase);
    const extraFile = await pickForSlot(extraRarity, variantLabel);
    results.push({ rarity: extraRarity, file: extraFile, slot: 'extra' });
  }

  const extra = rollExtraSlot(userId, profile, false, opts);
  if (extra) results.push(extra);

  return results;
}

module.exports = { drawPackSpecial };
