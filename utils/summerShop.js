const crypto = require('crypto');
const User = require('../models/User');
const SummerUser = require('../models/SummerUser');
const PullQuota = require('../models/PullQuota');
const { SUMMER_CARDS, normalizeIsland } = require('../config/summer-cards');
const { buildHolodoriTenPull } = require('./holodoriLoginReward');

const SHOP_ITEMS = Object.freeze({
  event_pull: Object.freeze({ id: 'event_pull', label: 'Event Pull', price: 25 }),
  sun_pull: Object.freeze({ id: 'sun_pull', label: 'SUN Pull', price: 50 }),
  holodori_10: Object.freeze({ id: 'holodori_10', label: '10 HOLODORI Pulls', price: 1000 }),
});

function getShopItem(itemId) {
  return SHOP_ITEMS[String(itemId || '')] || null;
}

function createPurchaseToken() {
  return crypto.randomBytes(10).toString('hex');
}

function summarizeCards(cards) {
  const map = new Map();
  for (const card of cards || []) {
    const rarity = String(card.rarity || '').trim();
    const name = String(card.name || '').trim();
    if (!rarity || !name) continue;
    const key = `${rarity}||${name}`;
    const current = map.get(key) || { rarity, name, count: 0 };
    current.count += 1;
    map.set(key, current);
  }
  return Array.from(map.values());
}

async function addCardsToUser(userId, cards) {
  const summary = summarizeCards(cards);
  const now = new Date();

  await User.updateOne(
    { id: userId },
    { $setOnInsert: { id: userId, cards: [] } },
    { upsert: true }
  ).exec();

  for (const item of summary) {
    const existing = await User.findOne(
      { id: userId, cards: { $elemMatch: { name: item.name, rarity: item.rarity } } },
      { cards: 1 }
    ).lean().exec();

    const index = existing?.cards?.findIndex(card =>
      String(card.name) === item.name && String(card.rarity) === item.rarity
    ) ?? -1;

    if (index >= 0) {
      await User.updateOne(
        { id: userId },
        {
          $inc: { [`cards.${index}.count`]: item.count },
          $set: { [`cards.${index}.lastAcquiredAt`]: now },
        }
      ).exec();
    } else {
      await User.updateOne(
        { id: userId },
        {
          $push: {
            cards: {
              name: item.name,
              rarity: item.rarity,
              count: item.count,
              firstAcquiredAt: now,
              lastAcquiredAt: now,
              locked: false,
            },
          },
        }
      ).exec();
    }
  }
}

async function purchaseSimpleItem(userId, item, token) {
  const update = await SummerUser.findOneAndUpdate(
    {
      userId,
      summerShells: { $gte: item.price },
      shopPurchaseIds: { $ne: token },
    },
    {
      $inc: {
        summerShells: -item.price,
        ...(item.id === 'sun_pull' ? { sunPulls: 1 } : {}),
        'stats.shopPurchases': 1,
      },
      $push: { shopPurchaseIds: token },
    },
    { new: true }
  ).lean().exec();

  if (!update) {
    const current = await SummerUser.findOne({ userId }).lean().exec();
    if (current?.shopPurchaseIds?.includes(token)) return { success: false, reason: 'ALREADY_PROCESSED' };
    return { success: false, reason: 'NOT_ENOUGH_SHELLS', balance: current?.summerShells || 0 };
  }

  if (item.id === 'event_pull') {
    try {
      const quota = await PullQuota.findOneAndUpdate(
        { userId },
        {
          $inc: { eventPulls: 1 },
          $setOnInsert: { userId, pulls: 6, lastRefill: new Date() },
        },
        { upsert: true, new: true }
      ).lean().exec();

      return {
        success: true,
        item,
        remainingShells: update.summerShells,
        eventPulls: quota?.eventPulls || 0,
      };
    } catch (err) {
      await SummerUser.updateOne(
        { userId, shopPurchaseIds: token },
        {
          $inc: { summerShells: item.price, 'stats.shopPurchases': -1 },
          $pull: { shopPurchaseIds: token },
        }
      ).exec().catch(() => {});
      throw err;
    }
  }

  return {
    success: true,
    item,
    remainingShells: update.summerShells,
    sunPulls: update.sunPulls || 0,
  };
}

async function purchaseHolodoriTen(userId, item, token) {
  const current = await SummerUser.findOne({ userId }).lean().exec();
  if (!current) return { success: false, reason: 'NO_SUMMER_USER' };
  if (current.shopPurchaseIds?.includes(token)) return { success: false, reason: 'ALREADY_PROCESSED' };
  if ((current.summerShells || 0) < item.price) {
    return { success: false, reason: 'NOT_ENOUGH_SHELLS', balance: current.summerShells || 0 };
  }

  const island = normalizeIsland(current.island);
  const islandMembers = SUMMER_CARDS[island] || [];
  let firstPurchase = false;

  let charged = await SummerUser.findOneAndUpdate(
    {
      userId,
      summerShells: { $gte: item.price },
      shopPurchaseIds: { $ne: token },
      holodoriFirstPurchaseClaimed: { $ne: true },
    },
    {
      $inc: { summerShells: -item.price, 'stats.shopPurchases': 1, 'stats.holodoriPacksPurchased': 1 },
      $set: { holodoriFirstPurchaseClaimed: true, holodoriFirstPurchaseToken: token },
      $push: { shopPurchaseIds: token },
    },
    { new: true }
  ).lean().exec();

  if (charged) {
    firstPurchase = true;
  } else {
    charged = await SummerUser.findOneAndUpdate(
      {
        userId,
        summerShells: { $gte: item.price },
        shopPurchaseIds: { $ne: token },
      },
      {
        $inc: { summerShells: -item.price, 'stats.shopPurchases': 1, 'stats.holodoriPacksPurchased': 1 },
        $push: { shopPurchaseIds: token },
      },
      { new: true }
    ).lean().exec();
  }

  if (!charged) {
    const latest = await SummerUser.findOne({ userId }).lean().exec();
    if (latest?.shopPurchaseIds?.includes(token)) return { success: false, reason: 'ALREADY_PROCESSED' };
    return { success: false, reason: 'NOT_ENOUGH_SHELLS', balance: latest?.summerShells || 0 };
  }

  let cards;
  try {
    cards = buildHolodoriTenPull({ islandMembers, guaranteeIslandFiveStar: firstPurchase, userId });
    await addCardsToUser(userId, cards);
  } catch (err) {
    const refundUpdate = {
      $inc: { summerShells: item.price, 'stats.shopPurchases': -1, 'stats.holodoriPacksPurchased': -1 },
      $pull: { shopPurchaseIds: token },
    };

    if (firstPurchase) {
      refundUpdate.$set = { holodoriFirstPurchaseClaimed: false };
      refundUpdate.$unset = { holodoriFirstPurchaseToken: 1 };
    }

    await SummerUser.updateOne(
      {
        userId,
        shopPurchaseIds: token,
        ...(firstPurchase ? { holodoriFirstPurchaseToken: token } : {}),
      },
      refundUpdate
    ).exec().catch(() => {});

    throw err;
  }

  return {
    success: true,
    item,
    remainingShells: charged.summerShells,
    cards,
    firstPurchase,
    island,
  };
}

async function purchaseShopItem(userId, itemId, token) {
  const item = getShopItem(itemId);
  if (!item) return { success: false, reason: 'INVALID_ITEM' };
  if (!token) return { success: false, reason: 'INVALID_TOKEN' };

  if (item.id === 'holodori_10') {
    return purchaseHolodoriTen(userId, item, token);
  }

  return purchaseSimpleItem(userId, item, token);
}

module.exports = {
  SHOP_ITEMS,
  getShopItem,
  createPurchaseToken,
  purchaseShopItem,
};
