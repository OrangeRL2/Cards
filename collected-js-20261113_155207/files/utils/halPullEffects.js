'use strict';
const path = require('path');
const pools = require('./loadImages');
const Oshi = require('../models/Oshi');
const oshis = require('../config/oshis');
const { resolveCardColor } = require('../config/holomemColor');
const config = require('../config.json');
const { pickWorldRarity } = require('./halWorldOdds');

const COLOR_TAROT = Object.freeze({ 2: 'blue', 3: 'green', 4: 'red', 14: 'white', 15: 'purple', 19: 'yellow' });
const SR_PLUS = new Set(['SR', 'OSR', 'UR', 'OUR', 'SY', 'SEC', 'HR', 'BDAY', 'ORI', 'SP', 'UP']);
const moonCandidates = new Map();
function nameOf(file) {
  return path.basename(String(file || '')).replace(/\.(png|jpe?g|gif)$/i, '').trim();
}
function memberMatches(file, member) {
  if (!member) return false;
  const escaped = String(member).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(?:\\s|$)`, 'i').test(nameOf(file));
}
function allRarityFiles(rarity) {
  return Array.isArray(pools[rarity]) ? pools[rarity] : [];
}
function replacement(item, predicate) {
  if (!item || !item.rarity) return null;
  const found = allRarityFiles(item.rarity).filter(file => predicate(file, item.rarity));
  return found.length ? { ...item, file: found[Math.floor(Math.random() * found.length)], relativeImagePath: null } : null;
}
function matchingMemberFiles(rarity, member) {
  return allRarityFiles(rarity).filter(file => memberMatches(file, member));
}
function firstMatchingWithFallback(item, predicate, { canChangeRarity = false } = {}) {
  const inRarity = replacement(item, predicate);
  if (inRarity) return inRarity;
  if (!canChangeRarity) return null;
  for (const rarity of ['C', 'U', 'R', 'S', 'RR', 'SR', 'OSR', 'UR', 'OUR']) {
    const files = allRarityFiles(rarity).filter(file => predicate(file, rarity));
    if (files.length) return { ...item, rarity, file: files[Math.floor(Math.random() * files.length)], relativeImagePath: null };
  }
  return null;
}
async function createContext(userId, card) {
  const number = typeof card === 'object' ? card?.number : card;
  if (![6, 9, 17].includes(number)) return { number, oshiName: null, userId: String(userId) };
  const doc = await Oshi.findOne({ userId: String(userId) }, { oshiId: 1 }).lean().exec();
  const found = oshis.find(o => o.id === doc?.oshiId);
  return { number, oshiName: found?.label || doc?.oshiId || null, userId: String(userId) };
}
function modifyPack(pack, context, { forceMagician = false } = {}) {
  if (!Array.isArray(pack) || pack.length < 8) return pack;
  const n = context?.number;
  if (n == null) return pack;
  const out = pack.map(item => ({ ...item }));
  const primary = out.slice(0, 8);
  const oshi = context.oshiName;
  if (n === 13) {
    // Death: no successful rarity hits in a paid pack. Force the base rarity
    // of each ordinary slot (C/C/C/C/U/U/U/R), regardless of draw mode.
    for (let i = 0; i < primary.length; i += 1) {
      const rarity = i < 4 ? 'C' : (i < 7 ? 'U' : 'R');
      const files = allRarityFiles(rarity);
      if (!files.length) throw new Error(`Death requires a populated ${rarity} card pool`);
      primary[i] = { ...primary[i], rarity, file: files[Math.floor(Math.random() * files.length)], relativeImagePath: null };
    }
  } else if (Object.hasOwn(COLOR_TAROT, n)) {
    const desired = COLOR_TAROT[n];
    for (let i = 0; i < primary.length; i += 1) {
      const item = primary[i];
      if (resolveCardColor(nameOf(item.file), item.rarity) === desired) continue;
      const r = firstMatchingWithFallback(item, (f, rarity) => resolveCardColor(nameOf(f), rarity) === desired,
        { canChangeRarity: item.rarity !== 'SEC' });
      if (!r) throw new Error(`No ${desired} card pool found for tarot slot ${i + 1}`);
      primary[i] = r;
    }
  } else if (n === 17 && oshi) {
    for (let i = 0; i < primary.length; i += 1) {
      if (memberMatches(primary[i].file, oshi)) continue;
      const r = firstMatchingWithFallback(primary[i], f => memberMatches(f, oshi),
        { canChangeRarity: primary[i].rarity !== 'SEC' });
      if (!r) throw new Error(`The Star cannot find a ${oshi} card for slot ${i + 1}`);
      primary[i] = r;
    }
  } else if (n === 9 && oshi) {
    for (let i = 0; i < primary.length; i += 1) {
      if (!memberMatches(primary[i].file, oshi)) continue;
      const r = replacement(primary[i], f => !memberMatches(f, oshi));
      if (!r) throw new Error(`The Hermit has no non-oshi cards for slot ${i + 1}`);
      primary[i] = r;
    }
  } else if (n === 6 && oshi) {
    const chance = Math.max(0, Math.min(1, Number(config.halLoversOshiChance ?? 0.60)));
    for (let i = 0; i < primary.length; i += 1) {
      if (Math.random() < chance) {
        primary[i] = replacement(primary[i], f => memberMatches(f, oshi)) || primary[i];
      }
    }
  } else if (n === 18) {
    // Moon: choose one member with cards in ALL four originally rolled rarities.
    const key = primary.slice(0, 4).map(item => item.rarity).join('|');
    const cacheable = !key.split('|').includes('BDAY');
    let possible = cacheable ? moonCandidates.get(key) : null;
    let names;
    if (!possible) {
      names = new Map();
      const suffix = /\s\d{3}$/;
      for (const f of allRarityFiles(primary[0].rarity)) {
        const m = nameOf(f).replace(suffix, '');
        if (m) names.set(m.toLowerCase(), m);
      }
      possible = [...names.values()].filter(m => primary.slice(1, 4).every(item => matchingMemberFiles(item.rarity, m).length));
      if (cacheable) {
        if (moonCandidates.size >= 256) moonCandidates.clear();
        moonCandidates.set(key, possible);
      }
    }
    if (possible.length) {
      const m = possible[Math.floor(Math.random() * possible.length)];
      for (let i = 0; i < 4; i += 1) primary[i] = replacement(primary[i], f => memberMatches(f, m));
    } else {
      // If the rare/special slot composition makes matching impossible, create
      // four C cards of one member rather than silently ignoring The Moon.
      if (!names) {
        names = new Map();
        for (const f of allRarityFiles(primary[0].rarity)) {
          const m = nameOf(f).replace(/\s\d{3}$/, '');
          if (m) names.set(m.toLowerCase(), m);
        }
      }
      const fallback = [...names.values()].filter(m => matchingMemberFiles('C', m).length);
      if (!fallback.length) throw new Error('The Moon requires a non-empty C pool');
      const m = fallback[Math.floor(Math.random() * fallback.length)];
      for (let i = 0; i < 4; i += 1) {
        const files = matchingMemberFiles('C', m);
        primary[i] = { ...primary[i], rarity: 'C', file: files[Math.floor(Math.random() * files.length)], relativeImagePath: null };
      }
    }
  } else if (n === 21) {
    // World: remove C/S from common, U/RR from uncommon and R from rare.
    // Remaining rarity weights come from the same profile-based table as !odds.
    for (let i = 0; i < 8; i += 1) {
      const rarity = pickWorldRarity(context.userId, i, context.drawMode || 'normal');
      const files = allRarityFiles(rarity);
      if (!files.length) throw new Error(`The World requires a populated ${rarity} pool in slot ${i + 1}`);
      primary[i] = { ...primary[i], rarity, file: files[Math.floor(Math.random() * files.length)], relativeImagePath: null };
    }
  }
  if (forceMagician && primary[7].rarity !== 'SEC') {
    const files = allRarityFiles('SEC');
    if (!files.length) throw new Error('Magician requires an available SEC card pool');
    primary[7] = { ...primary[7], rarity: 'SEC', file: files[Math.floor(Math.random() * files.length)], relativeImagePath: null };
  }
  return [...primary, ...out.slice(8)];
}

async function halIndependentSecondPack({ userId, useSpecial, drawPackSpecial, specialToken,
  bossBias, bossDraw, normalDraw, rateMultiplier, summerIsland, context }) {
  const opts = { forceSEC: false, rateMultiplier, summerIsland };
  const extra = !useSpecial && bossBias?.biased && bossBias?.drawToken
    ? await bossDraw(userId, bossBias.drawToken, opts)
    : (useSpecial && drawPackSpecial && specialToken
      ? await drawPackSpecial(userId, specialToken, opts)
      : await normalDraw(userId, null, opts));
  return modifyPack(extra, context).slice(0, 8);
}

function pityAfter(previous, hasSEC, number) {
  if (number === 13) return previous; // Death freezes the counter, even on SEC.
  if (hasSEC) return 0;
  return number === 12 ? previous - 1 : previous + 1;
}
module.exports = { COLOR_TAROT, SR_PLUS, nameOf, memberMatches, createContext, modifyPack, halIndependentSecondPack, pityAfter };
