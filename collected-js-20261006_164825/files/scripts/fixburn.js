// restore-all-burns-for-user.js
// Usage:
//   node restore-all-burns-for-user.js <TARGET_USER_ID>
// or run without args and follow prompts.

const mongoose = require('mongoose');
const readline = require('readline');

// Adjust these requires to match your project structure
const User = require('../models/User');
const BurnLog = require('../models/BurnLog');
const PullQuota = require('../models/PullQuota');
const { token, mongoUri } = require('../config.json');
// MongoDB URI: set via env or edit here
const MONGO_URI = process.env.MONGO_URI || mongoUri;

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function restoreAllBurnsForUser(targetUserId, invokerId = 'script') {
  if (!targetUserId) throw new Error('targetUserId required');

  // Find all BurnLogs for the user that are not restored
  const logs = await BurnLog.find({ userId: targetUserId, restoredAt: { $exists: false } }).sort({ timestamp: 1 }).lean().exec();
  if (!logs || logs.length === 0) {
    return { ok: true, restoredLogs: 0, restoredCards: 0, restoredEventPulls: 0, details: [] };
  }

  let totalRestoredCards = 0;
  let totalRestoredEventPulls = 0;
  const restoredDetails = [];

  // We'll process logs one-by-one in their own transaction to avoid long transactions
  for (const log of logs) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      // Re-fetch the log inside the session to ensure up-to-date state
      const logDoc = await BurnLog.findById(log._id).session(session).exec();
      if (!logDoc) {
        await session.abortTransaction();
        session.endSession();
        restoredDetails.push({ logId: String(log._id), status: 'missing' });
        continue;
      }

      if (logDoc.restoredAt) {
        // already restored by someone else
        await session.abortTransaction();
        session.endSession();
        restoredDetails.push({ logId: String(log._id), status: 'already_restored', restoredAt: logDoc.restoredAt, restoredBy: logDoc.restoredBy });
        continue;
      }

      // Load target user doc in transaction
      const userDoc = await User.findOne({ id: targetUserId }).session(session).exec();
      if (!userDoc) {
        await session.abortTransaction();
        session.endSession();
        restoredDetails.push({ logId: String(log._id), status: 'target_user_missing' });
        continue;
      }

      userDoc.cards = userDoc.cards || [];

      // Restore burned entries
      const burned = Array.isArray(logDoc.burned) ? logDoc.burned : [];
      let restoredCountThisLog = 0;
      for (const entry of burned) {
        const name = String(entry.name || '').trim();
        const rarity = String(entry.rarity || '').toUpperCase();
        const count = Number(entry.count || 0);
        if (!name || !rarity || count <= 0) continue;

        const existing = userDoc.cards.find(c => String(c.name) === name && String((c.rarity || '')).toUpperCase() === rarity);
        if (existing) {
          existing.count = (existing.count || 0) + count;
          existing.timestamps = existing.timestamps || [];
          existing.timestamps.push(new Date());
        } else {
          userDoc.cards.push({
            name,
            rarity,
            count,
            timestamps: [new Date()],
            sourceFile: entry.sourceFile || undefined
          });
        }

        restoredCountThisLog += count;
      }

      // Restore event pulls if present in awardedMilestones or eventPulls field
      let restoredEventPullsThisLog = 0;
      if (Array.isArray(logDoc.awardedMilestones)) {
        for (const m of logDoc.awardedMilestones) {
          if (m && m.awardType === 'eventPulls') {
            const n = Number(m.awardValue || 0);
            if (n > 0) restoredEventPullsThisLog += n;
          }
        }
      }
      if (typeof logDoc.eventPulls === 'number' && logDoc.eventPulls > 0) restoredEventPullsThisLog += logDoc.eventPulls;

      if (restoredEventPullsThisLog > 0) {
        await PullQuota.findOneAndUpdate(
          { userId: targetUserId },
          { $inc: { eventPulls: restoredEventPullsThisLog } },
          { upsert: true, new: true, session }
        );
      }

      // Save user doc
      await userDoc.save({ session });

      // Mark BurnLog as restored
      await BurnLog.updateOne(
        { _id: logDoc._id },
        { $set: { restoredAt: new Date(), restoredBy: invokerId, restoredTo: targetUserId } },
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      totalRestoredCards += restoredCountThisLog;
      totalRestoredEventPulls += restoredEventPullsThisLog;
      restoredDetails.push({ logId: String(logDoc._id), status: 'restored', restoredCards: restoredCountThisLog, restoredEventPulls: restoredEventPullsThisLog });
    } catch (err) {
      try { await session.abortTransaction(); } catch (e) {}
      session.endSession();
      restoredDetails.push({ logId: String(log._id), status: 'failed', error: err.message || String(err) });
    }
  }

  return {
    ok: true,
    restoredLogs: restoredDetails.filter(d => d.status === 'restored').length,
    restoredCards: totalRestoredCards,
    restoredEventPulls: totalRestoredEventPulls,
    details: restoredDetails
  };
}

(async () => {
  try {
    await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

    const args = process.argv.slice(2);
    let targetUserId = args[0];
    if (!targetUserId) {
      targetUserId = await prompt('Enter target user ID to restore all burns for: ');
    }
    if (!targetUserId) {
      console.error('No target user id provided. Exiting.');
      process.exit(1);
    }

    console.log(`Finding BurnLogs for user ${targetUserId}...`);
    const res = await restoreAllBurnsForUser(targetUserId, 'manual-script');

    console.log(`Done. Restored logs: ${res.restoredLogs}`);
    console.log(`Total cards restored: ${res.restoredCards}`);
    if (res.restoredEventPulls) console.log(`Total event pulls restored: ${res.restoredEventPulls}`);
    console.log('Details per log:');
    for (const d of res.details) {
      console.log(` - ${d.logId}: ${d.status}` + (d.restoredCards ? `, cards=${d.restoredCards}` : '') + (d.restoredEventPulls ? `, pulls=${d.restoredEventPulls}` : '') + (d.error ? `, error=${d.error}` : ''));
    }

    process.exit(0);
  } catch (err) {
    console.error('Restore-all-burns failed:', err.message || err);
    process.exit(1);
  }
})();
