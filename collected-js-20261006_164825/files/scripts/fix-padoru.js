// scripts/fix-padoru-names.js
const mongoose = require('mongoose');
const { mongoUri } = require('../config.json');
const User = require('../models/User');

/**
 * Mapping of old card names -> new card names.
 * Edit this object to add or change mappings.
 */
const NAME_MAP = {
  'padoru 0': 'Padoru Kanata',
  'padoru 1': 'Padoru Lamy',
  'padoru 2': 'Padoru Suisei',
  'padoru 3': 'Padoru Zeta',
  'padoru 4': 'Padoru Towa',
  'padoru 5': 'Padoru Flare',
  'padoru 6': 'Padoru Moona',
  'padoru 7': 'Padoru Subaru',
  'padoru 8': 'Padoru Mumei',
  'padoru 9': 'Padoru Chloe',
  // add more mappings as needed:
  // 'padoru 5': 'Padoru Someone',
};

async function fixPadoruNames() {
  const mongoURI = process.env.MONGODB_URI || mongoUri;
  try {
    await mongoose.connect(mongoURI);
    console.log('Connected to MongoDB');

    // Build a case-insensitive query to find users who have any card name matching keys in NAME_MAP
    const nameKeys = Object.keys(NAME_MAP);
    if (nameKeys.length === 0) {
      console.log('No name mappings defined in NAME_MAP. Exiting.');
      return;
    }

    // Create regex list for query (match whole name, case-insensitive)
    const regexes = nameKeys.map(k => new RegExp(`^${escapeRegex(k)}$`, 'i'));

    // Find users who have at least one card with a name matching any of the regexes
    const users = await User.find({
      'cards.name': { $in: regexes }
    });

    console.log(`Found ${users.length} users with Padoru cards to check`);

    let totalCardsRenamed = 0;
    let totalUsersUpdated = 0;

    for (const user of users) {
      let userUpdated = false;

      for (const card of user.cards) {
        if (!card || !card.name) continue;
        const normalized = String(card.name).trim().toLowerCase();

        if (NAME_MAP.hasOwnProperty(normalized)) {
          const newName = NAME_MAP[normalized];
          if (card.name !== newName) {
            const oldName = card.name;
            card.name = newName;
            userUpdated = true;
            totalCardsRenamed++;
            console.log(`User ${user.id}: renamed "${oldName}" -> "${newName}"`);
          }
        }
      }

      if (userUpdated) {
        user.markModified('cards');
        await user.save();
        totalUsersUpdated++;
        console.log(`Saved updates for user ${user.id}`);
      }
    }

    console.log('\n=== Rename Completed ===');
    console.log(`Total users scanned: ${users.length}`);
    console.log(`Total users updated: ${totalUsersUpdated}`);
    console.log(`Total cards renamed: ${totalCardsRenamed}`);

    if (totalCardsRenamed === 0) {
      console.log('No Padoru card names required renaming.');
    }
  } catch (err) {
    console.error('Error renaming Padoru card names:', err);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

/**
 * Escape a string for use in a RegExp constructor
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Run the script if executed directly
if (require.main === module) {
  fixPadoruNames().catch(err => {
    console.error('Unhandled error in fixPadoruNames:', err);
    process.exit(1);
  });
}

module.exports = fixPadoruNames;
