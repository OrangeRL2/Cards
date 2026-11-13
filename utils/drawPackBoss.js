
// utils/drawPackBoss.js
const path = require('path');
const pools = require('./loadImages');
const { pickCardFromRarityFolder } = require('./cardPicker');
const { pickWeighted, buildSlotOptions, applyFinalRateMultiplier, applyAbsoluteOverrides, getUserProfile, getOverrides } = require('./rates');
const { NORMAL_BOSS_BASES } = require('./pullSlotBases');
const { rollExtraSlot } = require('./extraSlot');
const { normalizeIsland, getIslandCards } = require('../config/summer-cards');
// --- Boss alias exceptions map (kept from your file)
const bossAliasMap = {
  Fuwawa: ['Fuwawa', 'Mococo', 'Fuwamoco'],
  Mococo: ['Fuwawa', 'Mococo', 'Fuwamoco'],
};


const SUMMER_MEMBER_ALIASES = Object.freeze({
  Elizabeth: ['Liz'],
  'Fubuki G': ['Fubuki G'],
  'La+': ['Laplus'],
  Achan: ['A-chan'],
});

function getCardBaseName(file) {
  return path.basename(String(file || ''), path.extname(String(file || ''))).trim();
}

function getAllowedNamesForIsland(island) {
  const names = new Set();
  for (const member of getIslandCards(island)) {
    names.add(member);
    for (const alias of SUMMER_MEMBER_ALIASES[member] || []) names.add(alias);
  }
  return [...names];
}

function isIslandMemberFile(file, island) {
  const normalizedIsland = normalizeIsland(island);
  if (!normalizedIsland) return true;
  const cardName = getCardBaseName(file);
  if (/^support(?:\s|$)/i.test(cardName)) return false;
  return getAllowedNamesForIsland(normalizedIsland).some(memberName => {
    const escaped = String(memberName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}(?:\\s|$)`, 'i').test(cardName);
  });
}

function getIslandPoolFiles(rarity, island) {
  const all = [
    ...(Array.isArray(pools.special?.[rarity]) ? pools.special[rarity] : []),
    ...(Array.isArray(pools.other?.[rarity]) ? pools.other[rarity] : []),
    ...(Array.isArray(pools[rarity]) ? pools[rarity] : []),
  ];
  return Array.from(new Set(all)).filter(file => isIslandMemberFile(file, island));
}

function pickIslandFallback(rarity, island) {
  const eligible = getIslandPoolFiles(rarity, island);
  if (!eligible.length) {
    throw new Error(`No eligible ${rarity} cards for Summer island "${island}".`);
  }
  const raw = uniformPick(eligible);
  return path.basename(raw, path.extname(raw));
}

function uniformPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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

async function pickForSlot(rarity, bossLabel, summerIsland = null) {
  const tryBoss = !!bossLabel && Math.random() < 0.1; // 10% boss-bias exception
  if (tryBoss) {
    try {
      const aliases = bossAliasMap[bossLabel];
      const candidates = Array.from(new Set(
        Array.isArray(aliases) && aliases.length > 0 ? aliases : [bossLabel]
      ));
      const first = uniformPick(candidates);
      const ordered = [first, ...candidates.filter(candidate => candidate !== first)];

      for (const candidateLabel of ordered) {
        try {
          const picked = await pickCardFromRarityFolder(
            rarity,
            candidateLabel,
            { avoidImmediateRepeat: true }
          );
          // A successful boss-biased card is intentionally allowed even if the
          // boss member is outside the player's Summer island.
          if (picked) return picked;
        } catch {}
      }
    } catch {}
  }

  const normalizedIsland = normalizeIsland(summerIsland);
  if (normalizedIsland) {
    // No boss-bias result: strictly use the player's island pool.
    return pickIslandFallback(rarity, normalizedIsland);
  }

  try {
    const fallback = await pickCardFromRarityFolder(rarity, null, { avoidImmediateRepeat: true });
    if (fallback) return fallback;
  } catch {}

  const raw = fallbackPickFromPools(rarity);
  return path.basename(raw, path.extname(raw));
}

async function drawPackBoss(userId, bossLabel, opts = {}) {
  const results = [];
  const profile = getUserProfile(userId);
  const rateMultiplier = Number.isFinite(Number(opts?.rateMultiplier)) ? Math.max(0, Number(opts.rateMultiplier)) : 1;
  const summerIsland = normalizeIsland(opts?.summerIsland);

  // Common slots (4)
  const commonSlot1Base = NORMAL_BOSS_BASES.common1;
  {
    let options = buildSlotOptions(commonSlot1Base, profile.pullRate, getOverrides(profile, 'boss', 'common1'));
    options = applyFinalRateMultiplier(options, rateMultiplier);
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, bossLabel, summerIsland);
    results.push({ rarity, file });
  }

  const commonSlot2Base = NORMAL_BOSS_BASES.common2;
  {
    let options = buildSlotOptions(commonSlot2Base, profile.pullRate, getOverrides(profile, 'boss', 'common2'));
    options = applyFinalRateMultiplier(options, rateMultiplier);
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, bossLabel, summerIsland);
    results.push({ rarity, file });
  }

  const commonSlot3Base = NORMAL_BOSS_BASES.common3;
  {
    let options = buildSlotOptions(commonSlot3Base, profile.pullRate, getOverrides(profile, 'boss', 'common3'));
    options = applyFinalRateMultiplier(options, rateMultiplier);
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, bossLabel, summerIsland);
    results.push({ rarity, file });
  }

  const commonSlot4Base = NORMAL_BOSS_BASES.common4;
  {
    let options = buildSlotOptions(commonSlot4Base, profile.pullRate, getOverrides(profile, 'boss', 'common4'));
    options = applyFinalRateMultiplier(options, rateMultiplier);
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, bossLabel, summerIsland);
    results.push({ rarity, file });
  }

  // Uncommon slots (3)
  const uncommonSlotBases = [
    NORMAL_BOSS_BASES.uncommon1,
    NORMAL_BOSS_BASES.uncommon2,
    NORMAL_BOSS_BASES.uncommon3,
  ];

  for (let i = 0; i < uncommonSlotBases.length; i++) {
    const slotName = `uncommon${i + 1}`;
    let options = buildSlotOptions(uncommonSlotBases[i], profile.pullRate, getOverrides(profile, 'boss', slotName));
    options = applyFinalRateMultiplier(options, rateMultiplier);
    const rarity = pickWeighted(options);
    const file = await pickForSlot(rarity, bossLabel, summerIsland);
    results.push({ rarity, file });
  }

  // Rare slot (1)
  const rareBase = NORMAL_BOSS_BASES.rare;
  {
      const baseOverrides = getOverrides(profile, 'boss', 'rare');
    const pityOverrides = (opts && opts.forceSEC) ? { SEC: 100 } : null;

    let options = buildSlotOptions(rareBase, profile.pullRate, baseOverrides);
    options = applyFinalRateMultiplier(options, rateMultiplier);
    if (pityOverrides) {
      options = applyAbsoluteOverrides(options, pityOverrides);
    }
    const rareRarity = pickWeighted(options);
    const rareFile = await pickForSlot(rareRarity, bossLabel, summerIsland);
    results.push({ rarity: rareRarity, file: rareFile });
  }
  
  const extra = rollExtraSlot(userId, profile, false, opts);
  if (extra && (!summerIsland || isIslandMemberFile(extra.file, summerIsland))) {
    results.push(extra);
  }

  if (!Array.isArray(results) || (results.length !== 8 && results.length !== 9)) {
  console.warn('[drawPackBoss] unexpected results length', { length: results.length });
  }
  
  return results;
}

module.exports = { drawPackBoss };

