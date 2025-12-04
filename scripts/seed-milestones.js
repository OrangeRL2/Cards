// scripts/seed-milestones.js
const mongoose = require('mongoose');
const { mongoUri } = require('../config.json');
const LevelMilestone = require('../models/LevelMilestone');

const MONGO = process.env.MONGO_URI || mongoUri;

async function upsertMilestone(query, doc) {
  await LevelMilestone.findOneAndUpdate(query, doc, { upsert: true, new: true });
}

async function seed() {
  await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });

  // Every 5,15,25,... -> +1 event pull
  await upsertMilestone(
    { level: 5, oshiId: null, awardType: 'eventPulls' },
    {
      level: 5,
      oshiId: null,
      awardType: 'eventPulls',
      awardValue: 1,
      repeatEvery: 10,
      oneTime: false,
      enabled: true,
      priority: 10
    }
  );

  // Every 10,20,30,... -> 1 card from the oshi pool
  await upsertMilestone(
    { level: 10, oshiId: null, awardType: 'card' },
    {
      level: 10,
      oshiId: null,
      awardType: 'card',
      awardValue: { poolFolder: null, count: 1 }, // poolFolder null => use oshi.oshiId at award time
      repeatEvery: 10,
      oneTime: false,
      enabled: true,
      priority: 5
    }
  );

  console.log('Seed complete');
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('Seed failed', err);
  process.exit(1);
});
