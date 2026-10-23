'use strict';
const path = require('path');
const HalUser = require('../models/HalUser');
const tarot = require('../config/halTarot');
const config = require('../config.json');
const { addCardsToUser } = require('./halInventory');
const { getUserProfile } = require('./rates');

// Manual safety exclusions for XXI - The World.
// Add Discord user IDs as strings. These are IN ADDITION TO automatic rate-based exclusions.
const WORLD_EXCLUDED_USER_IDS = new Set([
  '1171127294413246567',//blacky
  '408400038767624195',//grimm
]);

const NEGATIVE_TAROTS = new Set([5, 9, 12, 13, 16]);
// Same nine GOOD effects shown in the daily login reveal.
const GOOD_TAROTS = new Set([1, 6, 7, 8, 10, 11, 17, 20, 21]);
function jstDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function active(date = new Date()) {
  const dateJst = jstDay(date);
  return config.halEventForceActive === true ||
    (dateJst >= '2026-10-24' && dateJst <= '2026-11-08');
}
async function getState(id) {
  return HalUser.findOne({ userId: String(id) }).lean().exec();
}
async function getEffect(id, now = new Date()) {
  const state = await getState(id);
  const current = state?.tarotDateJST === jstDay(now) ? tarot.lookup(state.tarotNumber) : null;
  return current?.number === 21 && worldRestricted(id) ? null : current;
}
async function grantCard(id, name) {
  await addCardsToUser(id, [{ rarity: 'BOO', name: String(name), signed: false }]);
}
function worldRestricted(id) {
  if (WORLD_EXCLUDED_USER_IDS.has(String(id))) return true;
  const profile = getUserProfile(id);
  return Number(profile.pullRate) < 1 || Number(profile.specialPullRate) < 1 || Number(profile.extraSlotRate) < 1;
}
function previousJstDay(now = new Date()) {
  // Determine the previous calendar day in JST, including month/year changes.
  const current = jstDay(now);
  const yesterday = new Date(`${current}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().slice(0, 10);
}
function rollEffect({ protectedNext = false, userId = null, rng = Math.random } = {}) {
  // Justice guarantees a GOOD effect at the following day's login.
  // Use original tarot weights, normalized over the eligible GOOD cards.
  const excludeWorld = userId != null && worldRestricted(userId);
  const pool = tarot.CARDS.filter(card =>
    (!protectedNext || GOOD_TAROTS.has(card.number)) &&
    !(excludeWorld && card.number === 21)
  );
  if (!pool.length) throw new Error('No eligible tarot effects available');
  const totalWeight = pool.reduce((sum, card) => sum + card.weight, 0);
  let roll = rng() * totalWeight;
  for (const card of pool) {
    roll -= card.weight;
    if (roll < 0) return card;
  }
  return pool[pool.length - 1];
}
async function applyTarot(id, choice, { source = 'debug', now = new Date(), protectedNext = false, rng = Math.random } = {}) {
  const initial = typeof choice === 'object' ? choice : tarot.lookup(choice);
  if (!initial) throw new Error('Unknown tarot');
  if (initial.number === 21 && worldRestricted(id)) throw new Error('The World is unavailable for restricted-rate users');
  const awards = [];
  const cardsToGrant = [];
  let selected = initial;
  let rerolls = 0;
  // Every tarot actually drawn awards its matching collectible BOO card.
  // The Fool additionally grants Halloween X and can reroll into itself.
  while (true) {
    cardsToGrant.push({ rarity: 'BOO', name: selected.cardName, signed: false });
    awards.push(selected.cardName);
    if (selected.number !== 0) break;
    cardsToGrant.push({ rarity: 'BOO', name: 'Halloween X', signed: false });
    awards.push('Halloween X');
    rerolls += 1;
    if (rerolls >= 100) throw new Error('Fool reroll safety limit reached');
    selected = rollEffect({ protectedNext, userId: id, rng });
  }
  await addCardsToUser(id, cardsToGrant);
  const state = await HalUser.findOneAndUpdate(
    { userId: String(id) },
    { $set: {
      tarotNumber: selected.number, tarotDateJST: jstDay(now), tarotSource: source,
      magicianUsed: false, justiceUsed: false, justiceShield: selected.number === 11
    }, $inc: { foolExtraAwards: awards.filter(name => name === 'Halloween X').length }, $setOnInsert: { userId: String(id) } },
    { upsert: true, new: true }
  ).lean().exec();
  return { initial, effect: selected, awards, rerolls, state };
}
async function loginTarot(id, now = new Date()) {
  if (!active(now)) return null;
  const existing = await getState(id);
  if (existing?.tarotDateJST === jstDay(now)) return null;
  const protectedNext = existing?.justiceShield === true &&
    existing?.tarotDateJST === previousJstDay(now);
  const first = rollEffect({ protectedNext, userId: id });
  return applyTarot(id, first, { source: 'login', now, protectedNext });
}
async function endTarot(id) {
  await HalUser.updateOne({ userId: String(id) }, { $set: {
    tarotNumber: null, tarotDateJST: null, magicianUsed: false,
    justiceUsed: false, justiceShield: false
  } }).exec();
}
async function useMagician(id, now = new Date()) {
  const state = await HalUser.findOneAndUpdate(
    { userId: String(id), tarotDateJST: jstDay(now), tarotNumber: 1, magicianUsed: { $ne: true } },
    { $set: { magicianUsed: true } }, { new: true }
  ).lean().exec();
  return Boolean(state);
}
async function restoreMagician(id, now = new Date()) {
  await HalUser.updateOne({ userId: String(id), tarotDateJST: jstDay(now), tarotNumber: 1 },
    { $set: { magicianUsed: false } }).exec();
}
async function addCandy(id, count = 1) {
  if (!active() || !Number.isInteger(count) || count < 1) return null;
  return HalUser.findOneAndUpdate({ userId: String(id) },
    { $inc: { candies: count }, $setOnInsert: { userId: String(id) } },
    { upsert: true, new: true }).lean().exec();
}
function rollBooExtraSlot(rng = Math.random) {
  if (!active()) return null;
  const chance = Math.min(1, Math.max(0, Number(config.halBooBonusChance ?? 0.01)));
  if (rng() >= chance) return null;
  const card = tarot.collectible(rng);
  return {
    rarity: 'BOO',
    file: path.join(process.cwd(), 'assets', 'images', 'BOO', `${card.name}.jpg`),
    relativeImagePath: `BOO/${card.name}.jpg`,
  };
}
async function rollPullRewards(id, count = 1, { skipBoo = false } = {}) {
  if (!active()) return null;
  const result = await addCandy(id, count);
  const boo = [];
  if (!skipBoo) for (let i = 0; i < count; i += 1) {
    const drop = rollBooExtraSlot();
    if (drop) {
      const cardName = path.basename(drop.file, '.jpg');
      await grantCard(id, cardName);
      boo.push(cardName);
    }
  }
  return { balance: result.candies, candy: count, boo };
}
module.exports = {
  jstDay, active, getState, getEffect, grantCard, rollEffect, applyTarot,
  loginTarot, endTarot, useMagician, restoreMagician, addCandy, rollBooExtraSlot, rollPullRewards,
  NEGATIVE_TAROTS, GOOD_TAROTS,
};
