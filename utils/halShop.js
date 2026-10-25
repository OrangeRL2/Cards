'use strict';
const crypto = require('node:crypto');
const HalUser = require('../models/HalUser');
const hal = require('./halEvent');
const { collectible } = require('../config/halTarot');
const { buildHolodoriTenPull, pickHalloweenFirstPurchaseFiveStar } = require('./holodoriLoginReward');
const { addCardsToUser } = require('./halInventory');
const config = require('../config.json');

const BOO_PRICE = Number(config.halBooPullCost ?? 40);
// Ten independent BOO draws, priced at ten single exchanges by default.
const BOO_TEN_PRICE = Number(config.halBooTenPullCost ?? (10 * BOO_PRICE));
const HOLO_PRICE = Number(config.halHolodoriTenPullCost ?? 1000);
function priceOf(item) {
  if (item === 'boo') return BOO_PRICE;
  if (item === 'boo10') return BOO_TEN_PRICE;
  if (item === 'holodori') return HOLO_PRICE;
  return null;
}
function purchaseToken() { return crypto.randomUUID(); }
async function purchase(userId, item, token) {
  const id = String(userId);
  const price = priceOf(item);
  if (!hal.active()) return { success: false, reason: 'EVENT_INACTIVE' };
  if (!price || price <= 0 || !Number.isInteger(price)) return { success: false, reason: 'BAD_ITEM' };
  if (!/^[0-9a-f-]{36}$/i.test(String(token))) return { success: false, reason: 'BAD_TOKEN' };
  // The HOLODORI exchange is one-time only. Enforce this atomically at the
  // database level so a stale menu or simultaneous confirmation can't buy twice.
  const filter = { userId: id, candies: { $gte: price }, processedPurchaseIds: { $ne: token } };
  if (item === 'holodori') filter.firstHolodoriBought = { $ne: true };
  const before = await HalUser.findOneAndUpdate(
    filter,
    { $inc: { candies: -price }, $addToSet: { processedPurchaseIds: token },
      ...(item === 'holodori' ? { $set: { firstHolodoriBought: true } } : {}) },
    { new: false }
  ).lean().exec();
  if (!before) {
    const current = await hal.getState(id);
    const reason = (current?.processedPurchaseIds || []).includes(token)
      ? 'ALREADY_PROCESSED'
      : (item === 'holodori' && current?.firstHolodoriBought)
        ? 'ALREADY_PURCHASED'
        : 'NOT_ENOUGH_CANDY';
    return { success: false, reason, balance: current?.candies || 0 };
  }
  const first = item === 'holodori';
  try {
    let cards;
    if (item === 'boo' || item === 'boo10') {
      // Both options use the same per-card odds: ordinary BOO or rare ??? Halloween X.
      // Duplicates count as separate copies in the user's collection.
      const count = item === 'boo10' ? 10 : 1;
      cards = Array.from({ length: count }, () => collectible());
      await addCardsToUser(id, cards);
    } else {
      cards = buildHolodoriTenPull({ userId: id });
      if (first) {
        // The sole Halloween 10-pull purchase guarantees this configured
        // five-star card. Other cards retain their ordinary selection.
        const configuredCard = config.halFirstHolodoriFiveStarCards?.[id] ?? null;
        cards[0] = pickHalloweenFirstPurchaseFiveStar(id, { cardName: configuredCard });
      }
      await addCardsToUser(id, cards);
    }
    return { success: true, item, price, first, cards, balance: Number(before.candies) - price };
  } catch (err) {
    // Best effort compensation. If DB write partly succeeded, log for admin review.
    console.error('[HAL shop] card delivery failed; attempting to refund:', { id, item, token, err });
    await HalUser.updateOne({ userId: id, processedPurchaseIds: token },
      { $inc: { candies: price }, $pull: { processedPurchaseIds: token },
        ...(first ? { $set: { firstHolodoriBought: false } } : {}) }
    ).exec().catch(e => console.error('[HAL shop] refund failed:', e));
    throw err;
  }
}
module.exports = { purchase, purchaseToken, priceOf, BOO_PRICE, BOO_TEN_PRICE, HOLO_PRICE };
