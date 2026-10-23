'use strict';
const crypto = require('node:crypto');
const HalUser = require('../models/HalUser');
const hal = require('./halEvent');
const { collectible } = require('../config/halTarot');
const { buildHolodoriTenPull, pickHalloweenFirstPurchaseFiveStar } = require('./holodoriLoginReward');
const { addCardsToUser } = require('./halInventory');
const config = require('../config.json');

const BOO_PRICE = Number(config.halBooPullCost ?? 40);
const HOLO_PRICE = Number(config.halHolodoriTenPullCost ?? 1000);
function priceOf(item) { return item === 'boo' ? BOO_PRICE : (item === 'holodori' ? HOLO_PRICE : null); }
function purchaseToken() { return crypto.randomUUID(); }
async function purchase(userId, item, token) {
  const id = String(userId);
  const price = priceOf(item);
  if (!hal.active()) return { success: false, reason: 'EVENT_INACTIVE' };
  if (!price || price <= 0 || !Number.isInteger(price)) return { success: false, reason: 'BAD_ITEM' };
  if (!/^[0-9a-f-]{36}$/i.test(String(token))) return { success: false, reason: 'BAD_TOKEN' };
  const before = await HalUser.findOneAndUpdate(
    { userId: id, candies: { $gte: price }, processedPurchaseIds: { $ne: token } },
    { $inc: { candies: -price }, $addToSet: { processedPurchaseIds: token },
      ...(item === 'holodori' ? { $set: { firstHolodoriBought: true } } : {}) },
    { new: false }
  ).lean().exec();
  if (!before) {
    const current = await hal.getState(id);
    return { success: false, reason: (current?.processedPurchaseIds || []).includes(token)
      ? 'ALREADY_PROCESSED' : 'NOT_ENOUGH_CANDY', balance: current?.candies || 0 };
  }
  const first = item === 'holodori' && !before.firstHolodoriBought;
  try {
    let cards;
    if (item === 'boo') {
      const card = collectible();
      await hal.grantCard(id, card.name);
      cards = [card];
    } else {
      cards = buildHolodoriTenPull({ userId: id });
      if (first) {
        // Halloween FIRST 10-pull ONLY: deliberately bypass the zero-rate
        // restriction for this guaranteed card, optionally assigning the card
        // chosen by the admin in config.json. Other nine cards are unaffected.
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
module.exports = { purchase, purchaseToken, priceOf, BOO_PRICE, HOLO_PRICE };
