'use strict';

// Fetch only the inventory entries that a new /pull or /multi-pull needs.
// A projection of { cards: 1 } sends the user's ENTIRE multi-thousand-card
// array over the network. $filter keeps that work server-side and returns
// only the matching cards (including their _id and count for atomic updates).
const path = require('node:path');

function normalizeName(value) {
  return String(value ?? '')
    .replace(/[_\s-]+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchingPattern(value) {
  const normalized = normalizeName(value);
  if (!normalized) return null;
  return `^\\s*${normalized.split(' ').map(escapeRegex).join('[_\\s-]+')}\\s*$`;
}

function packIdentities(packs) {
  const result = new Map();
  for (const pack of packs) {
    for (const card of pack) {
      if (!card || !card.file || !card.rarity) continue;
      const base = path.basename(String(card.file), path.extname(String(card.file)));
      const name = normalizeName(base);
      const rarity = String(card.rarity);
      const key = `${rarity}\0${name.toLowerCase()}`;
      if (!result.has(key)) result.set(key, { rarity, name });
    }
  }
  return [...result.values()];
}

function buildPipeline(userId, packs) {
  const identities = packIdentities(packs);
  if (!identities.length) throw new Error('Cannot fetch matching inventory cards without drawn cards');
  const conditions = identities.map(({ rarity, name }) => ({
    $and: [
      { $eq: ['$$card.rarity', rarity] },
      { $regexMatch: { input: { $ifNull: ['$$card.name', ''] }, regex: matchingPattern(name), options: 'i' } },
    ],
  }));
  return [
    { $match: { id: String(userId) } },
    { $project: {
      cards: { $filter: {
        input: { $ifNull: ['$cards', []] },
        as: 'card',
        cond: conditions.length === 1 ? conditions[0] : { $or: conditions },
      } },
    } },
  ];
}

async function loadMatchingInventoryCards(User, userId, packs) {
  const rows = await User.aggregate(buildPipeline(userId, packs)).exec();
  return rows[0] ?? null;
}

module.exports = { loadMatchingInventoryCards, buildPipeline, matchingPattern, packIdentities };
