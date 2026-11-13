const mongoose = require('mongoose');
const User = require('../models/User');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('Missing MONGO_URI or MONGODB_URI environment variable.');
  process.exit(1);
}

function extractStars(card) {
  const variant = String(card.variant || '').trim();
  const match = variant.match(/^★{3,5}/);
  return match ? match[0] : null;
}

async function main() {
  await mongoose.connect(MONGO_URI);

  const users = await User.find({ 'cards.rarity': 'HOLODORI' });
  let usersChanged = 0;
  let cardsChanged = 0;

  for (const user of users) {
    let changed = false;
    const rebuilt = [];

    for (const rawCard of user.cards) {
      const card = rawCard.toObject ? rawCard.toObject() : { ...rawCard };

      if (String(card.rarity).toUpperCase() === 'HOLODORI') {
        const stars = extractStars(card);
        if (stars) {
          card.rarity = stars;
          card.variant = null;
          changed = true;
          cardsChanged += 1;
        }
      }

      const existing = rebuilt.find(entry =>
        String(entry.name) === String(card.name) &&
        String(entry.rarity) === String(card.rarity) &&
        String(entry.variant || '') === String(card.variant || '')
      );

      if (existing) {
        existing.count = Number(existing.count || 0) + Number(card.count || 0);
        const oldLast = existing.lastAcquiredAt ? new Date(existing.lastAcquiredAt) : null;
        const newLast = card.lastAcquiredAt ? new Date(card.lastAcquiredAt) : null;
        if (!oldLast || (newLast && newLast > oldLast)) existing.lastAcquiredAt = newLast;
        changed = true;
      } else {
        rebuilt.push(card);
      }
    }

    if (changed) {
      user.cards = rebuilt;
      await user.save();
      usersChanged += 1;
    }
  }

  console.log(`Migration complete. Updated ${cardsChanged} HOLODORI card entries across ${usersChanged} users.`);
  await mongoose.disconnect();
}

main().catch(async err => {
  console.error(err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
