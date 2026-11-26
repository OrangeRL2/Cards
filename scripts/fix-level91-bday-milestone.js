// One-time, targeted correction for the existing level-91 global BDAY milestone.
// Preview: node scripts/fix-level91-bday-milestone.js
// Apply:   node scripts/fix-level91-bday-milestone.js --apply
// Safe to re-run. Does not reseed or change any other milestones.
const mongoose = require('mongoose');
const LevelMilestone = require('../models/LevelMilestone');

const OLD_PATH = './assets/montlybdays/BDAY';
const NEW_PATH = './assets/images/BDAY';
const FILTER = {
  level: 91,
  oshiId: null,
  awardType: 'card',
  'awardValue.poolFolder': OLD_PATH
};

async function main() {
  const uri = process.env.MONGO_URI || require('../config.json').mongoUri;
  if (!uri) throw new Error('Missing MongoDB connection string');
  const apply = process.argv.includes('--apply');
  await mongoose.connect(uri);
  try {
    const matches = await LevelMilestone.countDocuments(FILTER);
    console.log(`Level-91 BDAY milestones using old folder: ${matches}`);
    console.log(`  From: ${OLD_PATH}`);
    console.log(`  To:   ${NEW_PATH}`);
    if (!apply) {
      console.log('Dry run only. Pass --apply to update these records.');
      return;
    }
    if (!matches) {
      console.log('No changes needed.');
      return;
    }
    const result = await LevelMilestone.updateMany(FILTER, {
      $set: { 'awardValue.poolFolder': NEW_PATH }
    });
    console.log(`Updated: ${result.modifiedCount ?? 0} of ${result.matchedCount ?? matches} matched milestone(s).`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  console.error('Level-91 BDAY correction failed:', error);
  process.exitCode = 1;
});
