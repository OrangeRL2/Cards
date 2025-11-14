// utils/liveAsync.js
const { nanoid } = require('nanoid');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const STAGE_FOR_RARITY = {
  C: 1, OC: 1, U: 1,
  S: 2, R: 2, RR: 2,
  SR: 3, OSR: 3,
  UR: 4, OUR: 4, SY: 4,
  SEC: 5,
};
const STAGE_NAMES = {
  1: 'Galaxy',
  2: 'SPACE',
  3: 'CiRCLE',
  4: 'RiNG',
  5: 'Budokan'
};

function getStageName(stage) {
  return STAGE_NAMES[stage] || `Stage ${stage}`;
}
const SUCCESS_RATES = {
  C: 0.01, OC: 0.05, U: 0.05,
  S: 0.29, R: 0.11, RR: 0.30,
  SR: 0.46, OSR: 0.48,
  UR: 0.66, OUR: 0.77, SY: 0.57,
  SEC: 0.99,
};
const DURATION_MS = {
  1: 15 * 60 * 1000,
  2: 30 * 60 * 1000,
  3: 5 * 60 * 60 * 1000,
  4: 12 * 60 * 60 * 1000,
  5: 24 * 60 * 60 * 1000,
};

function getStageForRarity(rarity) {
  return STAGE_FOR_RARITY[String(rarity)] || null;
}
function getDurationForStage(stage) {
  return DURATION_MS[stage] || 0;
}
function getSuccessChance(rarity) {
  return SUCCESS_RATES[String(rarity)] ?? 0;
}

// pick random P card from assets/images/P
async function pickRandomPCard() {
  try {
    const baseDir = path.join(__dirname, '..', 'assets', 'images', 'P');
    if (!fs.existsSync(baseDir) || !fs.statSync(baseDir).isDirectory()) return null;
    const files = fs.readdirSync(baseDir).filter(f => /\.(png|jpe?g|gif)$/i.test(f));
    if (!files.length) return null;
    const chosen = files[Math.floor(Math.random() * files.length)];
    const displayName = path.basename(chosen, path.extname(chosen)).replace(/[_-]+/g, ' ').trim();
    const fullPath = path.join(baseDir, chosen);
    return { file: fullPath, displayName };
  } catch {
    return null;
  }
}

/**
 * Attempt to start an attempt atomically:
 * - Enforce one unresolved attempt per stage
 * - Decrement matching card count (name + rarity) atomically using arrayFilters
 * - Push a pendingAttempt entry
 * Returns { success, reason?, attemptId?, readyAt?, stage?, nextReadyAt? }
 */
async function startAttemptAtomic(userId, name, rarity) {
  const stage = getStageForRarity(rarity);
  if (!stage) return { success: false, reason: 'invalid-rarity' };

  const now = Date.now();
  const duration = getDurationForStage(stage);
  const readyAt = new Date(now + duration);
  const attemptId = nanoid();

  // Stronger atomic check: try to reserve slot by ensuring no unresolved pendingAttempts for stage.
  // We'll use findOneAndUpdate with a query that requires no pending unresolved attempt for that stage.
  // The update decrements the card and pushes pendingAttempt in one operation.
  const query = {
    id: userId,
    $or: [
      { pendingAttempts: { $exists: false } },
      { pendingAttempts: { $not: { $elemMatch: { stage: stage, resolved: false } } } }
    ],
    'cards.name': { $exists: true } // placeholder so arrayFilters can target element
  };

  const update = {
    $inc: { 'cards.$[elem].count': -1 },
    $push: {
      'cards.$[elem].timestamps': new Date(),
      pendingAttempts: {
        id: attemptId,
        name,
        rarity,
        stage,
        startedAt: new Date(),
        readyAt,
        resolved: false,
        success: null,
      }
    }
  };
  const arrayFilters = [{ 'elem.name': name, 'elem.rarity': rarity, 'elem.count': { $gt: 0 } }];

  // Use findOneAndUpdate so we can know whether we reserved the slot
  const res = await User.findOneAndUpdate(query, update, { arrayFilters, returnDocument: 'after' }).exec();

  // If res is null, either stage was busy OR user/card didn't meet criteria. Detect which.
  if (!res) {
    // Check stage busy specifically
    const u = await User.findOne({ id: userId }).lean();
    if (u) {
      const existing = (u.pendingAttempts || []).find(a => !a.resolved && Number(a.stage) === Number(stage));
      if (existing) {
        return { success: false, reason: 'stage-busy', nextReadyAt: existing.readyAt };
      }
      // No stage busy -> likely no matching card with count > 0
      return { success: false, reason: 'no-card' };
    }
    return { success: false, reason: 'no-user' };
  }

  // confirm update actually changed a card entry (findOneAndUpdate returns doc but we must ensure the card was decremented)
  // check for any card with same name+rarity and last timestamp equal to now (best-effort). Simpler: verify that pendingAttempts contains our attemptId.
  const added = (res.pendingAttempts || []).find(a => a.id === attemptId);
  if (!added) {
    // if not added, fail
    return { success: false, reason: 'no-card' };
  }

  // Cleanup zero-count cards asynchronously (best-effort)
  User.updateOne({ id: userId }, { $pull: { cards: { count: { $lte: 0 } } } }).exec().catch(() => {});

  return { success: true, attemptId, readyAt, stage };
}

/**
 * Resolve a single attempt:
 * - Atomically mark attempt resolved
 * - On success: restore original card and award random P card
 * - On failure: original card is not restored (dies)
 */
async function resolveAttemptAtomic(userId, attemptId) {
  const user = await User.findOne({ id: userId }).exec();
  if (!user) return { success: false, reason: 'no-user' };

  const attempt = (user.pendingAttempts || []).find(a => a.id === attemptId);
  if (!attempt) return { success: false, reason: 'no-attempt' };
  if (attempt.resolved) return { success: false, reason: 'already-resolved' };

  const now = Date.now();
  if (new Date(attempt.readyAt).getTime() > now) return { success: false, reason: 'not-ready', readyAt: attempt.readyAt };

  const chance = getSuccessChance(attempt.rarity);
  const success = Math.random() <= chance;

  // Atomically mark resolved
  const upd = await User.updateOne(
    { id: userId, 'pendingAttempts.id': attemptId, 'pendingAttempts.resolved': false },
    { $set: { 'pendingAttempts.$.resolved': true, 'pendingAttempts.$.success': success } }
  ).exec();

  const modified = upd && (upd.modifiedCount ?? upd.nModified ?? upd.n ?? 0);
  if (!upd || modified === 0) return { success: false, reason: 'already-resolved' };

  let pCard = null;

  if (success) {
    // restore original card (increment or create)
    const cardName = attempt.name;
    const cardRarity = attempt.rarity;
    const incRes = await User.updateOne(
      { id: userId, 'cards.name': cardName, 'cards.rarity': cardRarity },
      { $inc: { 'cards.$.count': 1 }, $push: { 'cards.$.timestamps': new Date() } }
    ).exec();
    const incModified = incRes && (incRes.modifiedCount ?? incRes.nModified ?? incRes.n ?? 0);
    if (!incRes || incModified === 0) {
      await User.updateOne({ id: userId }, { $push: { cards: { name: cardName, rarity: cardRarity, count: 1, timestamps: [new Date()] } } }).exec();
    }

    // award random P
    const picked = await pickRandomPCard();
    if (picked) {
      const displayName = picked.displayName || 'Performance Card';
      const incP = await User.updateOne(
        { id: userId, 'cards.name': displayName, 'cards.rarity': 'P' },
        { $inc: { 'cards.$.count': 1 }, $push: { 'cards.$.timestamps': new Date() } }
      ).exec();
      const incPModified = incP && (incP.modifiedCount ?? incP.nModified ?? incP.n ?? 0);
      if (!incP || incPModified === 0) {
        await User.updateOne({ id: userId }, { $push: { cards: { name: displayName, rarity: 'P', count: 1, timestamps: [new Date()] } } }).exec();
      }
      const userAfter = await User.findOne({ id: userId }).lean();
      pCard = (userAfter.cards || []).find(c => String(c.name).toLowerCase() === String(displayName).toLowerCase() && c.rarity === 'P') || null;
    }
  } else {
    // On failure: original card remains consumed (dies). No action needed.
  }

  return { success: true, resolved: true, attemptId, successResult: success, pCard };
}

module.exports = {
  startAttemptAtomic,
  resolveAttemptAtomic,
  getStageForRarity,
  getDurationForStage,
  getSuccessChance,
  pickRandomPCard,
  getStageName,
};
