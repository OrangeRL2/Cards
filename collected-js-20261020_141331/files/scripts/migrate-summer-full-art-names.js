'use strict';

const mongoose = require('mongoose');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const User = require(path.join(ROOT, 'models', 'User'));

function getMongoUri() {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;

  let config = {};
  try {
    config = require(path.join(ROOT, 'config.json'));
  } catch {}

  return (
    config.mongoUri ||
    config.mongodbUri ||
    config.mongoURL ||
    config.mongodbURL ||
    config.databaseUrl ||
    null
  );
}

function earliestDate(a, b) {
  if (!a) return b || undefined;
  if (!b) return a || undefined;
  return new Date(a) <= new Date(b) ? a : b;
}

function latestDate(a, b) {
  if (!a) return b || undefined;
  if (!b) return a || undefined;
  return new Date(a) >= new Date(b) ? a : b;
}

async function main() {
  const uri = getMongoUri();
  if (!uri) {
    throw new Error('MongoDB URI not found. Set MONGO_URI or MONGODB_URI before running this script.');
  }

  await mongoose.connect(uri);

  const users = await User.find({
    cards: {
      $elemMatch: {
        rarity: 'SUN',
        name: /^Full Art:\s*/,
      },
    },
  });

  let usersChanged = 0;
  let legacyEntriesMerged = 0;

  for (const user of users) {
    let changed = false;
    const legacyCards = user.cards.filter(card =>
      String(card.rarity || '').toUpperCase() === 'SUN' &&
      String(card.name || '').startsWith('Full Art: ')
    );

    for (const legacy of legacyCards) {
      const route = String(legacy.name).slice('Full Art: '.length).trim();
      if (!route) continue;

      const modern = user.cards.find(card =>
        card !== legacy &&
        String(card.rarity || '').toUpperCase() === 'SUN' &&
        String(card.name || '').trim() === route &&
        String(card.variant || '').trim().toLowerCase() === 'full art'
      );

      if (modern) {
        modern.count = Number(modern.count || 0) + Number(legacy.count || 0);
        modern.firstAcquiredAt = earliestDate(modern.firstAcquiredAt, legacy.firstAcquiredAt);
        modern.lastAcquiredAt = latestDate(modern.lastAcquiredAt, legacy.lastAcquiredAt);
        modern.locked = Boolean(modern.locked || legacy.locked);
        legacy.count = 0;
      } else {
        legacy.name = route;
        legacy.variant = 'Full Art';
      }

      changed = true;
      legacyEntriesMerged += 1;
    }

    if (changed) {
      user.cards = user.cards.filter(card => Number(card.count || 0) > 0);
      await user.save();
      usersChanged += 1;
    }
  }

  console.log(`Migration complete. Users changed: ${usersChanged}. Full Art entries converted/merged: ${legacyEntriesMerged}.`);
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error(error);
  try { await mongoose.disconnect(); } catch {}
  process.exitCode = 1;
});
