/**
 * One-time cleanup:
 * 1) Remove duplicate "like" logs per (eventId,userId)
 * 2) Ensure the unique partial index exists for likes
 *
 * Usage:
 *   MONGO_URI="mongodb://..." node scripts/fixBossLikes.js
 */
const { token, mongoUri } = require('../config.json');
const mongoose = require('mongoose');
const BossPointLog = require('../models/BossPointLog');

async function main() {
  const uri = mongoUri;
  if (!uri) throw new Error('Missing MONGO_URI env var.');

  await mongoose.connect(uri);

  // 1) Find duplicate like groups
  const dups = await BossPointLog.aggregate([
    { $match: { action: 'like' } },
    {
      $group: {
        _id: { eventId: '$eventId', userId: '$userId' },
        ids: { $push: '$_id' },
        createdAts: { $push: '$createdAt' },
        count: { $sum: 1 },
      }
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  console.log(`Found ${dups.length} duplicate (eventId,userId) like groups`);

  // 2) Delete extras (keep the earliest createdAt if present, otherwise keep first)
  let removed = 0;
  for (const g of dups) {
    const pairs = g.ids.map((id, i) => ({ id, at: g.createdAts[i] ? new Date(g.createdAts[i]).getTime() : Number.MAX_SAFE_INTEGER }));
    pairs.sort((a, b) => a.at - b.at);

    const keep = pairs[0].id;
    const toDelete = pairs.slice(1).map(x => x.id);

    const res = await BossPointLog.deleteMany({ _id: { $in: toDelete } });
    removed += res.deletedCount || 0;

    console.log(`eventId=${g._id.eventId} userId=${g._id.userId} kept=${keep} deleted=${toDelete.length}`);
  }

  console.log(`Deleted ${removed} duplicate like docs`);

  // 3) Ensure correct unique partial index exists
  // Drop any existing conflicting index on (eventId,userId,action) if needed
  const idx = await BossPointLog.collection.indexes();
  const target = idx.find(i => {
    const k = i.key || {};
    return k.eventId === 1 && k.userId === 1 && k.action === 1;
  });

  if (target) {
    // If it isn't unique+partial like we want, drop it first
    const wantsUnique = target.unique === true;
    const wantsPartial = JSON.stringify(target.partialFilterExpression || {}) === JSON.stringify({ action: 'like' });

    if (!wantsUnique || !wantsPartial) {
      console.log(`Dropping conflicting index: ${target.name}`);
      await BossPointLog.collection.dropIndex(target.name);
    }
  }

  console.log('Creating unique partial index for likes...');
  await BossPointLog.collection.createIndex(
    { eventId: 1, userId: 1, action: 1 },
    { unique: true, partialFilterExpression: { action: 'like' } }
  );

  console.log('✅ Done. Unique like enforcement is now active.');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});