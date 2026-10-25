'use strict';
// One-time, idempotent migration for all legacy ??? collection cards.
// Preview: node scripts/migrate-halloween-x-to-unknown.js
// Apply:   node scripts/migrate-halloween-x-to-unknown.js --apply
// Back up MongoDB and STOP the bot before --apply. Do not change counts.
const mongoose = require('mongoose');
const { UNKNOWN_RARITY, SOURCE_RARITIES } = require('../config/unknownCards');
const config = require('../config.json');
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || config.mongoUri;
const apply = process.argv.includes('--apply');
const SOURCES = [...new Set(Object.values(SOURCE_RARITIES))];
const paths = [
  { label: 'inventory', array: 'cards', path: 'cards.$[target].rarity' },
  { label: 'recent acquisitions', array: 'recentAcquisitions.cards', path: 'recentAcquisitions.$[].cards.$[target].rarity' },
  { label: 'recent pulls', array: 'recentPulls.cards', path: 'recentPulls.$[].cards.$[target].rarity' },
];
function documentFilter(source, names, array) {
  const cardMatch = { rarity: source, name: { $in: names } };
  if (array === 'cards') return { cards: { $elemMatch: cardMatch } };
  const parent = array.split('.')[0];
  return { [parent]: { $elemMatch: { cards: { $elemMatch: cardMatch } } } };
}
async function migrate() {
  if (!mongoUri) throw new Error('Missing MongoDB connection string');
  await mongoose.connect(mongoUri);
  const users = mongoose.connection.collection('users');
  try {
    for (const source of SOURCES) {
      const names = Object.entries(SOURCE_RARITIES)
        .filter(([, from]) => from === source).map(([name]) => name);
      for (const target of paths) {
        const filter = documentFilter(source, names, target.array);
        const count = await users.countDocuments(filter);
        if (!apply) {
          console.log(`[preview] ${source} -> ${UNKNOWN_RARITY} (${names.join(', ')}) / ${target.label}: ${count} user records`);
          continue;
        }
        if (!count) {
          console.log(`[done] ${source} / ${target.label}: already up to date`);
          continue;
        }
        const updated = await users.updateMany(filter,
          { $set: { [target.path]: UNKNOWN_RARITY } },
          { arrayFilters: [{ 'target.name': { $in: names }, 'target.rarity': source }] });
        console.log(`[done] ${source} -> ${UNKNOWN_RARITY} / ${target.label}: ${updated.modifiedCount} user records`);
      }
    }
    console.log(apply ? '??? rarity migration complete.' : 'Preview only. Run with --apply to migrate.');
  } finally { await mongoose.disconnect(); }
}
migrate().catch(error => { console.error('[??? migration]', error); process.exitCode = 1; });
