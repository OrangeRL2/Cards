'use strict';

/**
 * One-time inventory repair for two specific card-name mistakes:
 *   [BDAY] Haato 001 - \u30b3\u30d4\u30fc -> Haato 001
 *   [C]    Jaato 504          -> Haato 504
 *
 * Run from the bot root with the bot STOPPED (to avoid concurrent inventory writes):
 *   node scripts/fix-haato-typos.js             # read-only preview (default)
 *   node scripts/fix-haato-typos.js --apply     # perform the repair
 *
 * Optional scope: ONLY_USER_ID=123456789 node scripts/fix-haato-typos.js
 * Uses MONGODB_URI if set, otherwise config.json's mongoUri.
 *
 * Only users with one of the exact old name + rarity combinations are loaded.
 * Only duplicates caused by these renames are merged. Existing unrelated
 * duplicate entries are left untouched. Different variants are never merged.
 * Keeps an existing correctly named card's subdocument _id where possible.
 * This script does NOT modify the card-artwork source files.
 */

const FIXES = Object.freeze([
  { rarity: 'BDAY', from: 'Haato 001 - \u30b3\u30d4\u30fc', to: 'Haato 001' },
  { rarity: 'C', from: 'Jaato 504', to: 'Haato 504' },
]);

function keyFor(card) {
  return JSON.stringify([card.rarity, card.name, card.variant ?? null]);
}

function chooseDate(values, direction) {
  const dated = values
    .filter(value => value !== undefined && value !== null)
    .map(value => ({ value, time: new Date(value).getTime() }))
    .filter(item => Number.isFinite(item.time));
  if (!dated.length) return undefined;
  return dated.reduce((best, item) =>
    direction === 'earliest'
      ? (item.time < best.time ? item : best)
      : (item.time > best.time ? item : best)
  ).value;
}

/** Pure, non-mutating transformation. Exported for offline regression tests. */
function repairCards(originalCards) {
  if (!Array.isArray(originalCards)) throw new TypeError('Expected a cards array');
  const cards = originalCards.map(card => ({ ...card }));
  const touchedKeys = new Set();
  const originalNames = cards.map(card => card.name);
  const renamedByFix = Object.fromEntries(FIXES.map(fix => [`${fix.rarity}:${fix.from}`, 0]));
  let renamed = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const fix = FIXES.find(rule => card.rarity === rule.rarity && card.name === rule.from);
    if (!fix) continue;
    card.name = fix.to;
    touchedKeys.add(keyFor(card));
    renamedByFix[`${fix.rarity}:${fix.from}`]++;
    renamed++;
  }
  if (!renamed) return { changed: false, cards: originalCards, renamed: 0, merged: 0, renamedByFix };

  const groups = new Map();
  for (let i = 0; i < cards.length; i++) {
    const key = keyFor(cards[i]);
    if (!touchedKeys.has(key)) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }

  const removed = new Set();
  let merged = 0;
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    // Preserve the original _id of a legitimately named card, if one exists.
    const keeperIndex = indexes.find(i => originalNames[i] === cards[i].name) ?? indexes[0];
    const items = indexes.map(i => cards[i]);
    const counts = items.map(item => Number(item.count ?? 0));
    if (counts.some(count => !Number.isFinite(count) || count < 0)) {
      throw new Error(`Invalid card count while merging ${cards[keeperIndex].rarity} ${cards[keeperIndex].name}`);
    }
    const keeper = cards[keeperIndex];
    keeper.count = counts.reduce((sum, count) => sum + count, 0);
    keeper.locked = items.some(item => Boolean(item.locked));
    const first = chooseDate(items.map(item => item.firstAcquiredAt), 'earliest');
    const last = chooseDate(items.map(item => item.lastAcquiredAt), 'latest');
    if (first !== undefined) keeper.firstAcquiredAt = first;
    if (last !== undefined) keeper.lastAcquiredAt = last;
    for (const i of indexes) {
      if (i !== keeperIndex) {
        removed.add(i);
        merged++;
      }
    }
  }

  return {
    changed: true,
    cards: cards.filter((_, i) => !removed.has(i)),
    renamed,
    merged,
    renamedByFix,
  };
}

async function main(argv = process.argv.slice(2)) {
  if (argv.some(arg => !['--apply', '--help'].includes(arg))) {
    throw new Error('Unknown option. Use --apply, or run without options for a dry run.');
  }
  if (argv.includes('--help')) {
    console.log('node scripts/fix-haato-typos.js [--apply]');
    console.log('Default: preview only. --apply: update all matching user inventories.');
    console.log('Optional: ONLY_USER_ID=... MONGODB_URI=...');
    return;
  }
  const applying = argv.includes('--apply');
  const mongoose = require('mongoose');
  const User = require('../models/User');
  const { mongoUri } = require('../config.json');
  const mongoURI = process.env.MONGODB_URI || mongoUri;
  if (!mongoURI) throw new Error('Missing MONGODB_URI / config.json mongoUri');

  const query = {
    $or: FIXES.map(fix => ({
      cards: { $elemMatch: { rarity: fix.rarity, name: fix.from } },
    })),
  };
  if (process.env.ONLY_USER_ID) query.id = process.env.ONLY_USER_ID;

  const summary = { affectedUsers: 0, renamed: 0, merged: 0 };
  console.log(`Mode: ${applying ? 'APPLY (writes enabled)' : 'DRY RUN (read-only)'}`);
  console.log(`Scope: ${process.env.ONLY_USER_ID || 'all users'}`);
  for (const fix of FIXES) console.log(`  [${fix.rarity}] ${fix.from} -> ${fix.to}`);
  await mongoose.connect(mongoURI);
  try {
    // First capture matching IDs so updates cannot alter a running query cursor.
    // Fetch card arrays only for those users, with no Mongoose document hydration.
    const ids = await User.collection.distinct('_id', query);
    console.log(`Users matching the two typo rules: ${ids.length}`);
    for (const _id of ids) {
      const user = await User.collection.findOne({ _id }, {
        projection: { _id: 1, id: 1, cards: 1, __v: 1, updatedAt: 1 },
      });
      if (!user) continue;
      const repaired = repairCards(user.cards || []);
      if (!repaired.changed) continue;
      summary.affectedUsers++;
      summary.renamed += repaired.renamed;
      summary.merged += repaired.merged;
      console.log(`${applying ? 'Updating' : 'Would update'} user ${user.id}: renamed=${repaired.renamed}, merged=${repaired.merged}`);
      if (!applying) continue;

      // Stop the bot before applying. These guards also reject ordinary stale writes.
      const filter = { _id: user._id };
      filter.__v = Number.isInteger(user.__v) ? user.__v : { $exists: false };
      filter.updatedAt = user.updatedAt instanceof Date ? user.updatedAt : { $exists: false };
      const result = await User.collection.updateOne(filter, {
        $set: { cards: repaired.cards },
        $inc: { __v: 1 },
        $currentDate: { updatedAt: true },
      });
      if (result.matchedCount !== 1) {
        throw new Error(`Concurrent modification detected for user ${user.id}. Stop the bot, re-run the preview, then retry.`);
      }
    }
    console.log(`\n${applying ? 'Applied' : 'Preview'}: ${summary.affectedUsers} users, ${summary.renamed} card entries renamed, ${summary.merged} duplicate entries safely merged.`);
    if (!applying) console.log('No database changes made. Run with --apply after stopping the bot to execute.');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(error => { console.error('Repair failed:', error); process.exitCode = 1; });
}

module.exports = { FIXES, repairCards, main };
