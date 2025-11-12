// utils/pullQuota.js
const PullQuota = require('../models/PullQuota');

const MAX_STOCK = 12;
const REFILL_INTERVAL_MS = 15 * 60 * 1000;

async function getOrCreate(userId) {
	let doc = await PullQuota.findOne({ userId }).exec();
	if (!doc) {
		doc = await PullQuota.create({
			userId,
			pulls: MAX_STOCK,
			lastRefill: new Date(),
			eventPulls: 0,
		});
	}
	return doc;
}

/**
 * Recalculate timed stock based on time elapsed. Does NOT touch eventPulls.
 * Returns { doc, nextRefillInMs }.
 */
async function getUpdatedQuota(userId) {
	const doc = await getOrCreate(userId);
	const now = Date.now();

	// If already full, no change
	if (doc.pulls >= MAX_STOCK) {
		return { doc, nextRefillInMs: 0 };
	}

	const last = doc.lastRefill ? doc.lastRefill.getTime() : now;
	const elapsed = now - last;

	if (elapsed < REFILL_INTERVAL_MS) {
		const nextIn = REFILL_INTERVAL_MS - elapsed;
		return { doc, nextRefillInMs: nextIn };
	}

	const tokensToAdd = Math.floor(elapsed / REFILL_INTERVAL_MS);
	const newPulls = Math.min(MAX_STOCK, doc.pulls + tokensToAdd);
	const advanced = last + tokensToAdd * REFILL_INTERVAL_MS;

	doc.pulls = newPulls;
	doc.lastRefill = new Date(advanced);
	await doc.save();

	const nextIn = (doc.pulls >= MAX_STOCK) ? 0 : (REFILL_INTERVAL_MS - (now - advanced));
	return { doc, nextRefillInMs: nextIn };
}

/**
 * Consume pulls preferring timed pulls first, then event pulls.
 * If combined pools cannot satisfy the request, nothing is consumed.
 * Returns { success, consumedFromEvent, consumedFromTimed, doc, remainingEvent, remainingTimed, nextRefillInMs }
 */
async function consumePulls(userId, count = 1) {
	const { doc, nextRefillInMs } = await getUpdatedQuota(userId);

	let remainingToConsume = count;
	let consumedFromEvent = 0;
	let consumedFromTimed = 0;

	// Attempt to consume from timed pulls first (prioritize timed)
	if (doc.pulls > 0) {
		const take = Math.min(doc.pulls, remainingToConsume);
		const wasFullBefore = doc.pulls >= MAX_STOCK;

		doc.pulls -= take;
		consumedFromTimed += take;
		remainingToConsume -= take;

		// If it was full and we removed timed pulls, start the refill timer now
		if (wasFullBefore && take > 0) {
			doc.lastRefill = new Date();
		}
	}

	// If still need pulls, consume from eventPulls
	if (remainingToConsume > 0) {
		if (doc.eventPulls < remainingToConsume) {
			// Not enough combined pulls: rollback timed consumption and return failure
			doc.pulls += consumedFromTimed;
			consumedFromTimed = 0;
			// persist rollback
			await doc.save();
			return {
				success: false,
				consumedFromEvent: 0,
				consumedFromTimed: 0,
				doc,
				remainingEvent: doc.eventPulls,
				remainingTimed: doc.pulls,
				nextRefillInMs,
			};
		}

		// consume event pulls
		doc.eventPulls -= remainingToConsume;
		consumedFromEvent += remainingToConsume;
		remainingToConsume = 0;
	}

	// Persist mutations (timed/event/lastRefill)
	await doc.save();

	// recompute nextRefillInMs (if timed pulls < max)
	let nextIn = 0;
	if (doc.pulls < MAX_STOCK) {
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
	};
}

/** Add event pulls (can be called when user gets birthday reward, etc.) */
async function addEventPulls(userId, amount = 1) {
	if (amount <= 0) return null;
	const doc = await getOrCreate(userId);
	doc.eventPulls += amount;
	await doc.save();
	return doc;
}

/** Get current event pulls count (no mutation) */
async function getEventPulls(userId) {
	const doc = await getOrCreate(userId);
	return doc.eventPulls;
}

/** Reset event pulls to zero (rarely needed) */
async function resetEventPulls(userId) {
	const doc = await getOrCreate(userId);
	doc.eventPulls = 0;
	await doc.save();
	return doc;
}

module.exports = {
	getUpdatedQuota,
	consumePulls,
	addEventPulls,
	getEventPulls,
	resetEventPulls,
	MAX_STOCK,
	REFILL_INTERVAL_MS,
};
