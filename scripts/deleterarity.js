#!/usr/bin/env node

/**
 * scripts/remove-mococo-001.js
 *
 * Removes all cards where rarity === "Mococo 001" from every user document.
 *
 * Usage:
 *   node scripts/remove-mococo-001.js
 */

const mongoose = require('mongoose');
const { mongoUri } = require('../config.json');

// --- Load your User model (adjust path if needed) ---
const User = require('../models/User');

if (!mongoUri) {
  console.error('mongoUri missing in config.json');
  process.exit(1);
}

async function main() {
  await mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });

  console.log('Connected to MongoDB.');

  // Remove all cards with rarity "Mococo 001"
  const res = await User.updateMany(
    {},
    { $pull: { cards: { rarity: 'Mococo 501' } } }
  );

  console.log(`Done. Modified ${res.modifiedCount || res.nModified} user(s).`);

  await mongoose.disconnect();
  console.log('Disconnected.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
