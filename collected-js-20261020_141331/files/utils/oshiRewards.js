// utils/oshiRewards.js
const User = require('../models/User');

/**
 * Atomically give an OSR card for the given oshi to a user.
 * - If an OSR card for that oshi exists, increment its count and push a timestamp.
 * - Otherwise push a new card object and upsert the user document if missing.
 * - Card name will be "<oshiLabel> 001" (matching birthday naming pattern) and rarity will be "OSR" (uppercase).
 * Returns a simple result object describing the outcome.
 */
async function addOshiOsrToUser(userId, oshiLabel) {
  try {
    const now = new Date();
    const baseName = typeof oshiLabel === 'string'
      ? oshiLabel.trim()
      : String(oshiLabel);

    const cardName = `${baseName} 001`;
    const rarity = 'OSR';

    // 1) Try to increment existing OSR card
    const updated = await User.findOneAndUpdate(
      { id: userId, 'cards.name': cardName, 'cards.rarity': rarity },
      {
        $inc: { 'cards.$.count': 1 },
        $set: { 'cards.$.lastAcquiredAt': now }
      },
      { new: true }
    ).exec();

    if (updated) {
      return { gave: true, created: false, name: cardName, rarity };
    }

    // 2) Otherwise insert new card (upsert user)
    const inserted = await User.findOneAndUpdate(
      { id: userId },
      {
        $setOnInsert: { id: userId },
        $push: {
          cards: {
            name: cardName,
            rarity,
            count: 1,
            firstAcquiredAt: now,
            lastAcquiredAt: now,
            locked: false,
          }
        }
      },
      { upsert: true, new: true }
    ).exec();

    if (inserted) {
      return { gave: true, created: true, name: cardName, rarity };
    }

    return { gave: false };
  } catch (err) {
    console.error('[addOshiOsrToUser] error', err);
    return { gave: false, error: err };
  }
}

module.exports = { addOshiOsrToUser };
