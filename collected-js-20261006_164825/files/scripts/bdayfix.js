// fix-bday-rarity.js
const mongoose = require('mongoose');
const { mongoUri } = require('../config.json');
// Your User model - adjust the path as needed
const User = require('../models/User');

async function fixBdayRarity() {
  try {
    // MongoDB connection - update with your connection string
    const mongoURI = process.env.MONGODB_URI || mongoUri;
    await mongoose.connect(mongoURI);
    console.log('Connected to MongoDB');

    // Find all users who have cards with 'bday' rarity (case insensitive)
    const users = await User.find({
      'cards.rarity': { $regex: /bday/i }
    });

    console.log(`Found ${users.length} users with 'bday' rarity cards`);

    let totalCardsFixed = 0;
    let totalUsersUpdated = 0;

    for (const user of users) {
      let userUpdated = false;
      
      // Check each card in the user's collection
      for (const card of user.cards) {
        if (card.rarity && card.rarity.toLowerCase() === 'bday') {
          const oldRarity = card.rarity;
          card.rarity = 'BDAY';
          userUpdated = true;
          totalCardsFixed++;
          console.log(`Updated card: ${card.name} from '${oldRarity}' to 'BDAY' for user ${user.id}`);
        }
      }

      if (userUpdated) {
        // Mark the cards field as modified
        user.markModified('cards');
        await user.save();
        totalUsersUpdated++;
        console.log(`Saved updates for user ${user.id}`);
      }
    }

    console.log('\n=== Fix Completed ===');
    console.log(`Total users processed: ${users.length}`);
    console.log(`Total users updated: ${totalUsersUpdated}`);
    console.log(`Total cards fixed: ${totalCardsFixed}`);

    if (totalCardsFixed === 0) {
      console.log('No cards with "bday" rarity found to fix.');
    }

  } catch (error) {
    console.error('Error fixing bday rarity:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

// Run the script if this file is executed directly
if (require.main === module) {
  fixBdayRarity();
}

module.exports = fixBdayRarity;
