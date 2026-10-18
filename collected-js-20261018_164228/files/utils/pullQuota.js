// utils/pullQuota.js
const PullQuota = require('../models/PullQuota');

const MAX_STOCK = 12;
const REFILL_INTERVAL_MS = 15 * 60 * 1000;


async function getOrCreate(userId) {
  // ✅ must be per-user
  let doc = await PullQuota.findOne({ userId }).exec();
  if (!doc) {
    doc = await PullQuota.create({
      userId,
      pulls: 6,
      lastRefill: new Date(),
      eventPulls: 0,
      pausedRemainingMs: null,
    });
  }
  return doc;
}

function isFrozenOpt(options) {
  return Boolean(options?.frozen || options?.isFrozen);
}

/**
 * Recalculate timed stock based on time elapsed. Does NOT touch eventPulls.
 * Returns { doc, nextRefillInMs, isFrozen }.
 */

async function getUpdatedQuota(userId, options = {}) {
  const frozen = isFrozenOpt(options);
  const doc = await getOrCreate(userId);
  const now = Date.now();

  // ✅ Frozen at 15 minutes (constant)
  if (frozen) {
    const FROZEN_MS = REFILL_INTERVAL_MS;

    if (doc.pausedRemainingMs !== FROZEN_MS) {
      doc.pausedRemainingMs = FROZEN_MS;
      doc.lastRefill = new Date(now); // prevents banking
      await doc.save();
    }

    return { doc, nextRefillInMs: FROZEN_MS, isFrozen: true };
  }

  // (optional) clear the paused flag when not frozen
  if (doc.pausedRemainingMs != null) {
    doc.pausedRemainingMs = null;
    doc.lastRefill = new Date(now); // prevents “instant refill” after unfreeze
    await doc.save();
  }

  // normal logic below...
  if (doc.pulls >= MAX_STOCK) return { doc, nextRefillInMs: 0, isFrozen: false };

  const last = doc.lastRefill ? doc.lastRefill.getTime() : now;
  const elapsed = now - last;

  if (elapsed < REFILL_INTERVAL_MS) {
    return { doc, nextRefillInMs: (REFILL_INTERVAL_MS - elapsed), isFrozen: false };
  }

  const tokensToAdd = Math.floor(elapsed / REFILL_INTERVAL_MS);
  doc.pulls = Math.min(MAX_STOCK, doc.pulls + tokensToAdd);
  doc.lastRefill = new Date(last + tokensToAdd * REFILL_INTERVAL_MS);
  await doc.save();

  const nextIn = (doc.pulls >= MAX_STOCK) ? 0 : Math.max(0, REFILL_INTERVAL_MS - (now - doc.lastRefill.getTime()));
  return { doc, nextRefillInMs: nextIn, isFrozen: false };
}

/**
 * Consume pulls preferring timed pulls first, then event pulls.
 * Returns { success, consumedFromEvent, consumedFromTimed, doc, remainingEvent, remainingTimed, nextRefillInMs, isFrozen }
 */
async function consumePulls(userId, count = 1, options = {}) {
  const { doc, nextRefillInMs, isFrozen } = await getUpdatedQuota(userId, options);

  let remainingToConsume = count;
  let consumedFromEvent = 0;
  let consumedFromTimed = 0;

  // Attempt to consume from timed pulls first
  if (doc.pulls > 0) {
    const take = Math.min(doc.pulls, remainingToConsume);
    const wasFullBefore = doc.pulls >= MAX_STOCK;

    doc.pulls -= take;
    consumedFromTimed += take;
    remainingToConsume -= take;

    // If it was full and we removed timed pulls, start the refill timer now
    // (but not if frozen, though frozen would never refill anyway)
    if (!isFrozen && wasFullBefore && take > 0) {
      doc.lastRefill = new Date();
    }
  }

  // If still need pulls, consume from eventPulls
  if (remainingToConsume > 0) {
    if (doc.eventPulls < remainingToConsume) {
      // rollback timed consumption
      doc.pulls += consumedFromTimed;
      consumedFromTimed = 0;
      await doc.save();
      return {
        success: false,
        consumedFromEvent: 0,
        consumedFromTimed: 0,
        doc,
        remainingEvent: doc.eventPulls,
        remainingTimed: doc.pulls,
        nextRefillInMs,
        isFrozen,
      };
    }

    doc.eventPulls -= remainingToConsume;
    consumedFromEvent += remainingToConsume;
    remainingToConsume = 0;
  }

  await doc.save();



 let nextIn = 0;
  if (isFrozen) {
    nextIn = REFILL_INTERVAL_MS;               // ✅ 15 minutes
  } else if (doc.pulls < MAX_STOCK) {
    const now = Date.now();
    const lastRefillTs = doc.lastRefill ? doc.lastRefill.getTime() : now;
    nextIn = Math.max(0, REFILL_INTERVAL_MS - (now - lastRefillTs));
  }

  return {
    success: true,

    consumedFromEvent,
    consumedFromTimed,
    doc,
    remainingEvent: doc.eventPulls,
    remainingTimed: doc.pulls,
    nextRefillInMs: nextIn,
    isFrozen,
  };
}
async function addPulls(userId, amount = 1) {
  if (amount <= 0) return null;
  const doc = await getOrCreate(userId);
  doc.pulls += amount;
  await doc.save();
  return doc;
}

async function setPulls(userId, amount = 1) {
  if (amount <= 0) return null;
  const doc = await getOrCreate(userId);
  doc.pulls = amount;
  await doc.save();
  return doc;
}

async function addEventPulls(userId, amount = 1) {
  if (amount <= 0) return null;
  const doc = await getOrCreate(userId);
  doc.eventPulls += amount;
  await doc.save();
  return doc;
}

async function getEventPulls(userId) {
  const doc = await getOrCreate(userId);
  return doc.eventPulls;
}

async function resetEventPulls(userId) {
  const doc = await getOrCreate(userId);
  doc.eventPulls = 0;
  await doc.save();
  return doc;
}

module.exports = {
  getUpdatedQuota,
  consumePulls,
  addPulls,
  setPulls,
  addEventPulls,
  getEventPulls,
  resetEventPulls,
  MAX_STOCK,
  REFILL_INTERVAL_MS,
};