#!/usr/bin/env node
/**
 * scripts/recalc-event-points.js
 *
 * Recomputes BossEvent.pointsTotal and BossEvent.pointsByUser from BossPointLog entries.
 *
 * Usage:
 *   node scripts/recalc-event-points.js --event=EVENT_ID        # recompute a single event
 *   node scripts/recalc-event-points.js --all                  # recompute all events that have logs
 *   node scripts/recalc-event-points.js --event=EVENT_ID --dry # show what would change but don't write
 *
 * Notes:
 * - The script reads mongoUri from ../config.json (key: mongoUri) or falls back to MONGO_URI env var.
 * - It aggregates BossPointLog documents grouped by userId for each event and writes the
 *   resulting points and superchatCount into the corresponding BossEvent document.
 * - For each user we compute:
 *     - points: sum(points)
 *     - superchatCount: count of logs where action === 'superchat'
 *     - firstPointAt: earliest createdAt among that user's logs for the event (or null)
 * - The event-level pointsTotal is set to the sum of per-user points.
 * - The script updates events in-place. Use --dry to preview changes.
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;
const argv = require('minimist')(process.argv.slice(2), {
  string: ['event'],
  boolean: ['all', 'dry'],
  alias: { e: 'event' },
  default: { all: false, dry: false }
});

// prefer config.json then env
let MONGO_URI = process.env.MONGO_URI;
try {
  // eslint-disable-next-line global-require
  const cfg = require('../config.json');
  if (cfg && cfg.mongoUri) MONGO_URI = cfg.mongoUri;
} catch (e) {
  // ignore if config.json missing
}

if (!MONGO_URI) {
  console.error('Missing MongoDB URI. Set MONGO_URI env or mongoUri in ../config.json');
  process.exit(2);
}

const TARGET_EVENT = argv.event || null;
const PROCESS_ALL = argv.all || false;
const DRY_RUN = argv.dry || false;

if (!TARGET_EVENT && !PROCESS_ALL) {
  console.error('Specify --event=EVENT_ID or --all to process all events.');
  process.exit(2);
}

// --- Schemas / Models (mirror your app) ---
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

const BossUserStateSchema = new Schema({
  userId: { type: String, required: true, index: true },
  points: { type: Number, default: 0 },
  superchatCount: { type: Number, default: 0 },
  firstPointAt: { type: Date, default: null }
}, { _id: false });

const BossEventSchema = new Schema({
  eventId: { type: String, required: true, unique: true },
  oshiId: { type: String, required: true, index: true },
  imageUrl: { type: String, default: null },
  spawnAt: { type: Date, required: true, index: true },
  endsAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ['scheduled','active','ended','settled'], default: 'scheduled', index: true },
  pointsTotal: { type: Number, default: 0 },
  pointsByUser: { type: [BossUserStateSchema], default: [] },
  happiness: { type: Number, default: 0 },
  announceMessageId: { type: String, default: null, index: true },
  boostedRarities: { type: [String], default: [] },
  createdAt: { type: Date, default: () => new Date() }
}, { collection: 'bossevents' });

let BossEvent;
try { BossEvent = mongoose.model('BossEvent'); } catch (e) {
  BossEvent = mongoose.model('BossEvent', BossEventSchema);
}

// --- Helper: aggregate per-event user stats from logs ---
async function aggregateEventUserStats(eventId) {
  const pipeline = [
    { $match: { eventId } },
    {
      $group: {
        _id: '$userId',
        totalPoints: { $sum: '$points' },
        superchatCount: {
          $sum: {
            $cond: [{ $eq: ['$action', 'superchat'] }, 1, 0]
          }
        },
        firstPointAt: { $min: '$createdAt' },
        entries: { $sum: 1 }
      }
    },
    { $sort: { totalPoints: -1 } }
  ];

  const rows = await BossPointLog.aggregate(pipeline).allowDiskUse(true).exec();
  return rows.map(r => ({
    userId: r._id,
    points: r.totalPoints || 0,
    superchatCount: r.superchatCount || 0,
    firstPointAt: r.firstPointAt || null,
    entries: r.entries || 0
  }));
}

// --- Main processing ---
async function processEvent(eventId) {
  console.log(`\nProcessing event: ${eventId}`);

  // Ensure event exists
  const ev = await BossEvent.findOne({ eventId }).lean().exec();
  if (!ev) {
    console.warn(`  Event ${eventId} not found in BossEvent collection. Skipping.`);
    return { eventId, skipped: true };
  }

  // Aggregate logs
  const userStats = await aggregateEventUserStats(eventId);

  // Compute totals
  const pointsTotal = userStats.reduce((s, u) => s + (u.points || 0), 0);

  // Build pointsByUser array in the same shape as BossUserStateSchema
  const pointsByUser = userStats.map(u => ({
    userId: u.userId,
    points: u.points,
    superchatCount: u.superchatCount,
    firstPointAt: u.firstPointAt
  }));

  // Optionally compute happiness: here we set to pointsTotal (adjust if you have a different formula)
  const happiness = pointsTotal;

  // Show diff / preview
  console.log(`  current pointsTotal: ${ev.pointsTotal} -> new: ${pointsTotal}`);
  console.log(`  users affected: ${pointsByUser.length}`);
  if (pointsByUser.length > 0) {
    console.log('  top users preview:');
    pointsByUser.slice(0, 10).forEach((u, i) => {
      console.log(`    ${i + 1}. ${u.userId} — ${u.points} pts, superchats=${u.superchatCount}, firstAt=${u.firstPointAt}`);
    });
  }

  if (DRY_RUN) {
    console.log('  dry run enabled: not writing changes.');
    return { eventId, updated: false, pointsTotal, pointsByUserCount: pointsByUser.length };
  }

  // Write update
  const update = {
    $set: {
      pointsTotal,
      pointsByUser,
      happiness
    }
  };

  const res = await BossEvent.updateOne({ eventId }, update).exec();
  console.log(`  update result: matched=${res.matchedCount || res.n || 0}, modified=${res.modifiedCount || res.nModified || 0}`);
  return { eventId, updated: true, pointsTotal, pointsByUserCount: pointsByUser.length };
}

async function main() {
  await mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });

  console.log('Connected to MongoDB.');

  let eventIds = [];

  if (TARGET_EVENT) {
    eventIds = [TARGET_EVENT];
  } else if (PROCESS_ALL) {
    // find all eventIds that have logs
    const ids = await BossPointLog.distinct('eventId').exec();
    eventIds = ids || [];
    if (eventIds.length === 0) {
      console.log('No events found in BossPointLog collection. Nothing to do.');
      await mongoose.disconnect();
      return;
    }
  }

  console.log(`Will process ${eventIds.length} event(s). Dry run: ${DRY_RUN}`);

  const results = [];
  for (const eid of eventIds) {
    try {
      // process sequentially to avoid huge memory spikes; can be parallelized if needed
      // but keep it safe for large datasets
      const r = await processEvent(eid);
      results.push(r);
    } catch (err) {
      console.error(`Error processing event ${eid}:`, err);
      results.push({ eventId: eid, error: String(err) });
    }
  }

  console.log('\nSummary:');
  for (const r of results) {
    if (r.skipped) console.log(`  ${r.eventId}: skipped (no BossEvent)`);
    else if (r.error) console.log(`  ${r.eventId}: error: ${r.error}`);
    else if (r.updated) console.log(`  ${r.eventId}: updated, pointsTotal=${r.pointsTotal}, users=${r.pointsByUserCount}`);
    else console.log(`  ${r.eventId}: preview only, pointsTotal=${r.pointsTotal}, users=${r.pointsByUserCount}`);
  }

  await mongoose.disconnect();
  console.log('Disconnected. Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
