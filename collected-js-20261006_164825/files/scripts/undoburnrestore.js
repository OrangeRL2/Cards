// undo-inventory-by-timestamp.js
// WARNING: destructive. BACKUP your DB first.
// Usage:
//   node undo-inventory-by-timestamp.js <TARGET_USER_ID> <CUTOFF_ISO> [--dry-run] [--skip-on-discrepancy] [--invoker=NAME]

const mongoose = require('mongoose');
const fs = require('fs');
const User = require('../models/User');
const BurnLog = require('../models/BurnLog');
const { mongoUri } = require('../config.json');

const MONGO_URI = process.env.MONGO_URI || mongoUri;

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { targetUserId: null, cutoff: null, dryRun: false, skipOnDiscrepancy: false, invoker: 'script' };
  if (argv.length >= 1) out.targetUserId = argv[0];
  if (argv.length >= 2) out.cutoff = argv[1];
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    if (a === '--skip-on-discrepancy') out.skipOnDiscrepancy = true;
    if (a.startsWith('--invoker=')) out.invoker = a.split('=')[1] || out.invoker;
  }
  return out;
}

async function computeRemovalsFromLog(logDoc, userDoc) {
  const burned = Array.isArray(logDoc.burned) ? logDoc.burned : [];
  const removals = [];
  for (const entry of burned) {
    const name = String(entry.name || '').trim();
    const rarity = String(entry.rarity || '').toUpperCase();
    const count = Number(entry.count || 0);
    if (!name || !rarity || count <= 0) continue;
    const existing = (userDoc.cards || []).find(c => String(c.name) === name && String((c.rarity || '')).toUpperCase() === rarity);
    removals.push({ name, rarity, removeCount: count, existingCount: existing ? (existing.count || 0) : 0 });
  }
  return removals;
}

async function undoInventoryForLog(logId, invokerId, options = { skipOnDiscrepancy: false, dryRun: false }) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const logDoc = await BurnLog.findById(logId).session(session).exec();
    if (!logDoc) throw new Error('BurnLog not found');

    const targetUserId = logDoc.userId;
    if (!targetUserId) throw new Error('BurnLog missing userId');

    const userDoc = await User.findOne({ id: targetUserId }).session(session).exec();
    if (!userDoc) throw new Error('Target user not found');

    userDoc.cards = userDoc.cards || [];

    const removals = await computeRemovalsFromLog(logDoc, userDoc);

    // Discrepancy checks
    for (const r of removals) {
      if (r.existingCount < r.removeCount) {
        const msg = `Insufficient cards for ${r.rarity} ${r.name}: have ${r.existingCount}, need ${r.removeCount}`;
        if (options.skipOnDiscrepancy) {
          await session.abortTransaction();
          session.endSession();
          return { ok: false, skipped: true, reason: msg, removals };
        } else {
          throw new Error(msg);
        }
      }
    }

    if (options.dryRun) {
      await session.abortTransaction();
      session.endSession();
      return { ok: true, dryRun: true, removals };
    }

    // Apply removals
    for (const r of removals) {
      const idx = userDoc.cards.findIndex(c => String(c.name) === r.name && String((c.rarity || '')).toUpperCase() === r.rarity);
      if (idx === -1) throw new Error(`Missing stack during apply: ${r.rarity} ${r.name}`);
      userDoc.cards[idx].count = (userDoc.cards[idx].count || 0) - r.removeCount;
      if (userDoc.cards[idx].count <= 0) {
        userDoc.cards.splice(idx, 1);
      } else {
        userDoc.cards[idx].timestamps = userDoc.cards[idx].timestamps || [];
        userDoc.cards[idx].timestamps.push(new Date());
      }
    }

    // Save user
    await userDoc.save({ session });

    // Add undo audit to BurnLog (inventory-only undo)
    const undoMeta = {
      undoneAt: new Date(),
      undoneBy: invokerId,
      undoReason: 'undo-inventory-by-timestamp'
    };

    await BurnLog.updateOne(
      { _id: logDoc._id },
      { $set: { undo: undoMeta } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return { ok: true, undone: true, removals };
  } catch (err) {
    try { await session.abortTransaction(); } catch (e) {}
    session.endSession();
    return { ok: false, error: err.message || String(err) };
  }
}

async function main() {
  const args = parseArgs();
  if (!args.targetUserId || !args.cutoff) {
    console.error('Usage: node undo-inventory-by-timestamp.js <TARGET_USER_ID> <CUTOFF_ISO> [--dry-run] [--skip-on-discrepancy] [--invoker=NAME]');
    process.exit(1);
  }

  const cutoffDate = new Date(args.cutoff);
  if (isNaN(cutoffDate.getTime())) {
    console.error('Invalid cutoff date. Use ISO format like 2025-12-18 or 2025-12-18T00:00:00Z');
    process.exit(1);
  }

  console.log('Connecting to DB...');
  await mongoose.connect(MONGO_URI);

  // Use timestamp < cutoff (strictly before)
  let logs = await BurnLog.find({ userId: args.targetUserId, timestamp: { $lt: cutoffDate } }).sort({ timestamp: 1 }).lean().exec();

  if (!logs || logs.length === 0) {
    console.log('No matching logs found before cutoff (by timestamp). Nothing to do.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`Found ${logs.length} logs to process (by timestamp).`);
  const report = { totalLogs: logs.length, processed: [] };

  for (const log of logs) {
    console.log(`Processing log ${log._id} (timestamp=${log.timestamp || 'N/A'})...`);
    const res = await undoInventoryForLog(log._id, args.invoker, { skipOnDiscrepancy: !!args.skipOnDiscrepancy, dryRun: !!args.dryRun });
    report.processed.push({ logId: String(log._id), result: res });
    if (res.ok === false && !args.skipOnDiscrepancy) {
      console.error('Aborting due to error:', res.error || res.reason);
      break;
    }
  }

  const outFile = `undo-inventory-report-${args.targetUserId}-${Date.now()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log('Operation complete. Report written to', outFile);
  console.log(JSON.stringify(report, null, 2));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error', err);
  process.exit(1);
});
