#!/usr/bin/env node
/**
 * scripts/top-scorers.js
 *
 * Usage:
 *   node scripts/top-scorers.js --event=EVENT_ID [--top=10] [--since=2026-01-01] [--action=superchat]
 *
 * Examples:
 *   node scripts/top-scorers.js --event=ev123 --top=20
 *   node scripts/top-scorers.js --event=ev123 --since=2026-01-01 --action=superchat
 *
 * Output: prints a ranked table of users who scored the most points for the given event.
 *
 * Notes:
 * - Requires either config.json with `mongoUri` at project root or MONGO_URI env var.
 * - Looks up usernames from the User collection (field `id`) if available.
 * - If you want CSV output, pipe the console output or modify the script to write a file.
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;
const process = require('process');
const argv = require('minimist')(process.argv.slice(2), {
  string: ['event', 'since', 'action'],
  alias: { e: 'event', t: 'top', s: 'since', a: 'action' },
  default: { top: 10 }
});

// Prefer config.json mongoUri, fall back to env var
let MONGO_URI = process.env.MONGO_URI;
try {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const cfg = require('../config.json');
  if (cfg && cfg.mongoUri) MONGO_URI = cfg.mongoUri;
} catch (e) {
  // ignore if config.json not present
}

const EVENT_ID = argv.event;
const TOP_N = Math.max(1, Number(argv.top) || 10);
const SINCE = argv.since ? new Date(argv.since) : null;
const ACTION = argv.action ? String(argv.action) : null;

if (!EVENT_ID) {
  console.error('Missing required --event=EVENT_ID argument.');
  process.exit(2);
}

if (!MONGO_URI) {
  console.error('Please set MONGO_URI environment variable or mongoUri in config.json and retry.');
  process.exit(2);
}

// ----------------- Models (mirror your app) -----------------
// BossPointLog model (same shape as your app)
const BossPointLogSchema = new Schema({
  eventId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  oshiId: { type: String, default: null },
  action: { type: String, required: true, enum: ['like', 'sub', 'superchat', 'member', 'reward'], index: true },
  points: { type: Number, default: 0 },
  meta: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: () => new Date() }
}, { collection: 'bosspointlogs' });

let BossPointLog;
try { BossPointLog = mongoose.model('BossPointLog'); } catch (e) {
  BossPointLog = mongoose.model('BossPointLog', BossPointLogSchema);
}

// Minimal User model to resolve display names (adjust if your User schema differs)
const UserSchema = new Schema({
  id: { type: String, required: true, unique: true },
  pulls: { type: Number, default: 0 },
  points: { type: Number, default: 0 },
  username: { type: String, default: null },
  discriminator: { type: String, default: null },
  displayName: { type: String, default: null }
}, { collection: 'users' });

let User;
try { User = mongoose.model('User'); } catch (e) {
  User = mongoose.model('User', UserSchema);
}

// ----------------- Main -----------------
async function main() {
  await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });

  console.log(`Connected to MongoDB. Aggregating top ${TOP_N} scorers for event "${EVENT_ID}"...`);

  // Build match stage
  const match = { eventId: EVENT_ID };
  if (ACTION) match.action = ACTION;
  if (SINCE && !Number.isNaN(SINCE.getTime())) match.createdAt = { $gte: SINCE };

  // Aggregation: group by userId, sum points, count entries
  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$userId',
        totalPoints: { $sum: '$points' },
        entries: { $sum: 1 }
      }
    },
    { $sort: { totalPoints: -1 } },
    { $limit: TOP_N }
  ];

  let results;
  try {
    results = await BossPointLog.aggregate(pipeline).allowDiskUse(true).exec();
  } catch (err) {
    console.error('Aggregation error:', err);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!results || results.length === 0) {
    console.log('No point logs found for the given filters.');
    await mongoose.disconnect();
    return;
  }

  // Resolve user display names from User collection
  const userIds = results.map(r => r._id);
  let users = [];
  try {
    users = await User.find({ id: { $in: userIds } }).lean().exec();
  } catch (err) {
    console.warn('Warning: failed to fetch user documents for display names:', err);
  }
  const userMap = new Map((users || []).map(u => [u.id, u]));

  // Prepare table rows
  const rows = results.map((r, idx) => {
    const uid = r._id;
    const u = userMap.get(uid);
    let display = uid;
    if (u) {
      if (u.displayName) display = u.displayName;
      else if (u.username && u.discriminator) display = `${u.username}#${u.discriminator}`;
      else if (u.username) display = u.username;
    }
    return {
      rank: idx + 1,
      user: display,
      userId: uid,
      totalPoints: r.totalPoints,
      entries: r.entries
    };
  });

  // Print header with filters used
  console.log('Filters:');
  console.log(`  eventId: ${EVENT_ID}`);
  if (ACTION) console.log(`  action: ${ACTION}`);
  if (SINCE) console.log(`  since: ${SINCE.toISOString()}`);
  console.log('');

  // Print table
  console.table(rows, ['rank', 'user', 'userId', 'totalPoints', 'entries']);

  // Also print a simple ranked list
  console.log('Top scorers:');
  for (const row of rows) {
    console.log(`#${row.rank} ${row.user} (${row.userId}) — ${row.totalPoints} points across ${row.entries} log entries`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
