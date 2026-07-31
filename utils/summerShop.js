const crypto = require('crypto');
const SummerUser = require('../models/SummerUser');
const PullQuota = require('../models/PullQuota');

const SHOP_ITEMS = Object.freeze({
  event_pull: Object.freeze({
    id: 'event_pull',
    label: 'Event Pull',
    price: 25,
    description: 'Adds 1 Event Pull to your existing PullQuota balance.',
  }),
  sun_pull: Object.freeze({
    id: 'sun_pull',
    label: 'SUN Pull',
    price: 50,
    description: 'Adds 1 guaranteed SUN Pull to your Summer balance.',
  }),
});

function getShopItem(itemId) {
  return SHOP_ITEMS[String(itemId || '').trim()] || null;
}

function createPurchaseToken() {
  return crypto.randomBytes(12).toString('hex');
}

async function buySunPull(userId, item, token) {
  const updated = await SummerUser.findOneAndUpdate(
    {
      userId: String(userId),
      summerShells: { $gte: item.price },
      shopPurchaseIds: { $ne: token },
    },
    {
      $inc: {
        summerShells: -item.price,
        sunPulls: 1,
        'stats.shopPurchases': 1,
      },
      $addToSet: { shopPurchaseIds: token },
    },
    { new: true }
  ).lean().exec();

  if (!updated) {
    const current = await SummerUser.findOne({ userId: String(userId) }).lean().exec();
    if (current?.shopPurchaseIds?.includes(token)) {
      return { success: false, reason: 'ALREADY_PROCESSED' };
    }
    return {
      success: false,
      reason: 'NOT_ENOUGH_SHELLS',
      balance: current?.summerShells || 0,
    };
  }

  return {
    success: true,
    item,
    remainingShells: updated.summerShells,
    sunPulls: updated.sunPulls,
  };
}

async function buyEventPull(userId, item, token) {
  const charged = await SummerUser.findOneAndUpdate(
    {
      userId: String(userId),
      summerShells: { $gte: item.price },
      shopPurchaseIds: { $ne: token },
    },
    {
      $inc: {
        summerShells: -item.price,
        'stats.shopPurchases': 1,
      },
      $addToSet: { shopPurchaseIds: token },
    },
    { new: true }
  ).lean().exec();

  if (!charged) {
    const current = await SummerUser.findOne({ userId: String(userId) }).lean().exec();
    if (current?.shopPurchaseIds?.includes(token)) {
      return { success: false, reason: 'ALREADY_PROCESSED' };
    }
    return {
      success: false,
      reason: 'NOT_ENOUGH_SHELLS',
      balance: current?.summerShells || 0,
    };
  }

  try {
    const quota = await PullQuota.findOneAndUpdate(
      { userId: String(userId) },
      {
        $inc: { eventPulls: 1 },
        $setOnInsert: {
          userId: String(userId),
          pulls: 6,
          lastRefill: new Date(),
          specialPulls: {},
          pausedRemainingMs: null,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean().exec();

    return {
      success: true,
      item,
      remainingShells: charged.summerShells,
      eventPulls: quota?.eventPulls || 0,
    };
  } catch (error) {
    await SummerUser.updateOne(
      { userId: String(userId), shopPurchaseIds: token },
      {
        $inc: {
          summerShells: item.price,
          'stats.shopPurchases': -1,
        },
        $pull: { shopPurchaseIds: token },
      }
    ).exec().catch(() => null);

    throw error;
  }
}

async function purchaseShopItem(userId, itemId, token) {
  const item = getShopItem(itemId);
  if (!item) return { success: false, reason: 'INVALID_ITEM' };
  if (!token) return { success: false, reason: 'INVALID_TOKEN' };

  if (item.id === 'sun_pull') {
    return buySunPull(userId, item, token);
  }

  if (item.id === 'event_pull') {
    return buyEventPull(userId, item, token);
  }

  return { success: false, reason: 'INVALID_ITEM' };
}

module.exports = {
  SHOP_ITEMS,
  getShopItem,
  createPurchaseToken,
  purchaseShopItem,
};
