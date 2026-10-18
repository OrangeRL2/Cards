
// utils/sunPull.js
const path = require('path');
const User = require('../models/User');
const SummerUser = require('../models/SummerUser');
const { getAllSunCardsFromFolders } = require('./summerCardFiles');

const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';
const inFlightUsers = new Set();

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSummerImageUrl(card) {
  const base = IMAGE_BASE.replace(/\/$/, '');
  return `${base}/SUN/${encodeURIComponent(card.folder)}/${encodeURIComponent(card.cardName)}.png`;
}

function chooseRandomStandardSunCard() {
  const pool = getAllSunCardsFromFolders();
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new Error('The standard SUN card pool is empty.');
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

async function awardSunCard(userId, card) {
  const now = new Date();
  const nameRegex = new RegExp(`^${escapeRegex(card.cardName)}$`, 'i');

  await User.updateOne(
    { id: userId },
    { $setOnInsert: { id: userId, cards: [], points: 0, pulls: 0 } },
    { upsert: true },
  ).exec();

  const increment = await User.updateOne(
    {
      id: userId,
      cards: {
        $elemMatch: {
          name: { $regex: nameRegex },
          rarity: 'SUN',
        },
      },
    },
    {
      $inc: { 'cards.$.count': 1 },
      $set: { 'cards.$.lastAcquiredAt': now },
    },
  ).exec();

  if (!increment || increment.matchedCount === 0) {
    await User.updateOne(
      {
        id: userId,
        $nor: [{
          cards: {
            $elemMatch: {
              name: { $regex: nameRegex },
              rarity: 'SUN',
            },
          },
        }],
      },
      {
        $push: {
          cards: {
            name: card.cardName,
            rarity: 'SUN',
            count: 1,
            firstAcquiredAt: now,
            lastAcquiredAt: now,
            locked: false,
          },
        },
      },
    ).exec();
  }

  const user = await User.findOne(
    {
      id: userId,
      cards: {
        $elemMatch: {
          name: { $regex: nameRegex },
          rarity: 'SUN',
        },
      },
    },
    { 'cards.$': 1 },
  ).lean().exec();

  return Number(user?.cards?.[0]?.count || 1);
}

async function performSunPull(userId) {
  const key = String(userId);
  if (inFlightUsers.has(key)) {
    return { success: false, reason: 'BUSY' };
  }

  inFlightUsers.add(key);
  let deducted = false;

  try {
    // Atomically require and spend one SUN Pull.
    const summerUser = await SummerUser.findOneAndUpdate(
      {
        userId: key,
        island: { $in: ['red', 'yellow', 'green', 'blue'] },
        sunPulls: { $gte: 1 },
      },
      {
        $inc: {
          sunPulls: -1,
          'stats.sunPullsUsed': 1,
        },
        $set: {
          'stats.lastSunPullAt': new Date(),
        },
      },
      { new: true },
    ).lean().exec();

    if (!summerUser) {
      const existing = await SummerUser.findOne({ userId: key }).lean().exec();
      if (!existing?.island) return { success: false, reason: 'NO_ISLAND' };
      return {
        success: false,
        reason: 'NO_PULLS',
        remainingSunPulls: Number(existing.sunPulls || 0),
      };
    }

    deducted = true;
    const card = chooseRandomStandardSunCard();
    const currentCount = await awardSunCard(key, card);

    await SummerUser.updateOne(
      { userId: key },
      { $inc: { 'stats.sunCardsEarned': 1 } },
    ).exec();

    return {
      success: true,
      card: {
        ...card,
        imageUrl: buildSummerImageUrl(card),
      },
      currentCount,
      remainingSunPulls: Number(summerUser.sunPulls || 0),
    };
  } catch (error) {
    // Refund the balance if deduction succeeded but card delivery failed.
    if (deducted) {
      await SummerUser.updateOne(
        { userId: key },
        {
          $inc: {
            sunPulls: 1,
            'stats.sunPullsUsed': -1,
          },
        },
      ).exec().catch(() => null);
    }

    console.error('[sunPull] failed:', error);
    return { success: false, reason: 'ERROR', error };
  } finally {
    inFlightUsers.delete(key);
  }
}

module.exports = {
  buildSummerImageUrl,
  chooseRandomStandardSunCard,
  performSunPull,
  awardSunCard,
};


