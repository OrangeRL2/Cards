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
/*
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
  );*/

  // Every 10,20,30,... -> 1 card from the oshi pool
// Insert milestone definitions for levels 1..100 per provided table.
// Assumes upsertMilestone(filter, doc) is available in scope.

await upsertMilestone(
  { level: 1, oshiId: null, awardType: 'card' },
  {
    level: 1,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OSR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 2, oshiId: null, awardType: 'eventPulls' },
  {
    level: 2,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 3, oshiId: null, awardType: 'card' },
  {
    level: 3,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OC", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 4, oshiId: null, awardType: 'eventPulls' },
  {
    level: 4,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 5, oshiId: null, awardType: 'card' },
  {
    level: 5,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 6, oshiId: null, awardType: 'eventPulls' },
  {
    level: 6,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 7, oshiId: null, awardType: 'card',priority: 5 },
  {
    level: 7,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);
await upsertMilestone(
  { level: 7, oshiId: null, awardType: 'card',priority: 3 },
  {
    level: 7,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 4
  }
);
await upsertMilestone(
  { level: 7, oshiId: null, awardType: 'card',priority: 3 },
  {
    level: 7,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 3
  }
);

await upsertMilestone(
  { level: 8, oshiId: null, awardType: 'eventPulls' },
  {
    level: 8,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 9, oshiId: null, awardType: 'card' },
  {
    level: 9,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/P", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 10, oshiId: null, awardType: 'card' },
  {
    level: 10,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 11, oshiId: null, awardType: 'card' },
  {
    level: 11,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OSR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 12, oshiId: null, awardType: 'eventPulls' },
  {
    level: 12,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 13, oshiId: null, awardType: 'card' },
  {
    level: 13,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OC", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 14, oshiId: null, awardType: 'eventPulls' },
  {
    level: 14,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 15, oshiId: null, awardType: 'card' },
  {
    level: 15,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 16, oshiId: null, awardType: 'eventPulls' },
  {
    level: 16,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 17, oshiId: null, awardType: 'card',priority: 5 },
  {
    level: 17,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);
await upsertMilestone(
  { level: 17, oshiId: null, awardType: 'card',priority: 4 },
  {
    level: 17,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 4
  }
);
await upsertMilestone(
  { level: 17, oshiId: null, awardType: 'card',priority: 3 },
  {
    level: 17,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 3
  }
);

await upsertMilestone(
  { level: 18, oshiId: null, awardType: 'eventPulls' },
  {
    level: 18,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 19, oshiId: null, awardType: 'card' },
  {
    level: 19,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/P", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 20, oshiId: null, awardType: 'card' },
  {
    level: 20,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 21, oshiId: null, awardType: 'eventPulls' },
  {
    level: 21,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 22, oshiId: null, awardType: 'card' },
  {
    level: 22,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OSR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 23, oshiId: null, awardType: 'card' },
  {
    level: 23,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OC", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 24, oshiId: null, awardType: 'eventPulls' },
  {
    level: 24,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 25, oshiId: null, awardType: 'card' },
  {
    level: 25,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/UR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 26, oshiId: null, awardType: 'eventPulls' },
  {
    level: 26,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 27, oshiId: null, awardType: 'card', priority: 5 },
  {
    level: 27,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);
await upsertMilestone(
  { level: 27, oshiId: null, awardType: 'card', priority: 4 },
  {
    level: 27,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 4
  }
);

await upsertMilestone(
  { level: 27, oshiId: null, awardType: 'card', priority: 3 },
  {
    level: 27,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 3
  }
);


await upsertMilestone(
  { level: 28, oshiId: null, awardType: 'eventPulls' },
  {
    level: 28,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 29, oshiId: null, awardType: 'card' },
  {
    level: 29,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/P", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 30, oshiId: null, awardType: 'card' },
  {
    level: 30,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 31, oshiId: null, awardType: 'card' },
  {
    level: 31,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/HR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 32, oshiId: null, awardType: 'eventPulls' },
  {
    level: 32,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 33, oshiId: null, awardType: 'card' },
  {
    level: 33,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OUR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 34, oshiId: null, awardType: 'eventPulls' },
  {
    level: 34,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 35, oshiId: null, awardType: 'card' },
  {
    level: 35,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 36, oshiId: null, awardType: 'eventPulls' },
  {
    level: 36,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 37, oshiId: null, awardType: 'card', priority: 5 },
  {
    level: 37,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1, priority: 4 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);
await upsertMilestone(
  { level: 37, oshiId: null, awardType: 'card', priority: 4 },
  {
    level: 37,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 4
  }
);
await upsertMilestone(
  { level: 37, oshiId: null, awardType: 'card', priority: 3 },
  {
    level: 37,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 3
  }
);

await upsertMilestone(
  { level: 38, oshiId: null, awardType: 'eventPulls' },
  {
    level: 38,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 39, oshiId: null, awardType: 'card' },
  {
    level: 39,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/P", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 40, oshiId: null, awardType: 'card' },
  {
    level: 40,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 41, oshiId: null, awardType: 'eventPulls' },
  {
    level: 41,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 42, oshiId: null, awardType: 'eventPulls' },
  {
    level: 42,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 43, oshiId: null, awardType: 'card' },
  {
    level: 43,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OC", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 44, oshiId: null, awardType: 'card' },
  {
    level: 44,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OSR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 45, oshiId: null, awardType: 'card' },
  {
    level: 45,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 46, oshiId: null, awardType: 'eventPulls' },
  {
    level: 46,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 47, oshiId: null, awardType: 'card', priority: 5 },
  {
    level: 47,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);
await upsertMilestone(
  { level: 47, oshiId: null, awardType: 'card', priority: 4 },
  {
    level: 47,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 4
  }
);
await upsertMilestone(
  { level: 47, oshiId: null, awardType: 'card', priority: 3 },
  {
    level: 47,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 3
  }
);

await upsertMilestone(
  { level: 48, oshiId: null, awardType: 'eventPulls' },
  {
    level: 48,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 49, oshiId: null, awardType: 'card' },
  {
    level: 49,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/P", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

// Level 50: BDAY (oshi) — use poolFolder null so award uses oshi.oshiId at award time
// Upsert a level-50 birthday card milestone for every oshi.
// Assumes upsertMilestone(filter, doc) is available in scope.

await upsertMilestone(
  { level: 50, oshiId: 'miko', awardType: 'card' },
  {
    level: 50,
    oshiId: 'miko',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/miko/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'suisei', awardType: 'card' },
  {
    level: 50,
    oshiId: 'suisei',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/suisei/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'sora', awardType: 'card' },
  {
    level: 50,
    oshiId: 'sora',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/sora/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'roboco', awardType: 'card' },
  {
    level: 50,
    oshiId: 'roboco',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/roboco/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'azki', awardType: 'card' },
  {
    level: 50,
    oshiId: 'azki',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/azki/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'aki', awardType: 'card' },
  {
    level: 50,
    oshiId: 'aki',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/aki/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'matsuri', awardType: 'card' },
  {
    level: 50,
    oshiId: 'matsuri',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/matsuri/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'haato', awardType: 'card' },
  {
    level: 50,
    oshiId: 'haato',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/haato/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'fubuki', awardType: 'card' },
  {
    level: 50,
    oshiId: 'fubuki',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/fubuki/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'mel', awardType: 'card' },
  {
    level: 50,
    oshiId: 'mel',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/mel/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'choco', awardType: 'card' },
  {
    level: 50,
    oshiId: 'choco',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/choco/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'subaru', awardType: 'card' },
  {
    level: 50,
    oshiId: 'subaru',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/subaru/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'aqua', awardType: 'card' },
  {
    level: 50,
    oshiId: 'aqua',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/aqua/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'shion', awardType: 'card' },
  {
    level: 50,
    oshiId: 'shion',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/shion/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'ayame', awardType: 'card' },
  {
    level: 50,
    oshiId: 'ayame',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/ayame/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'okayu', awardType: 'card' },
  {
    level: 50,
    oshiId: 'okayu',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/okayu/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'mio', awardType: 'card' },
  {
    level: 50,
    oshiId: 'mio',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/mio/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'korone', awardType: 'card' },
  {
    level: 50,
    oshiId: 'korone',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/korone/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'pekora', awardType: 'card' },
  {
    level: 50,
    oshiId: 'pekora',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/pekora/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'rushia', awardType: 'card' },
  {
    level: 50,
    oshiId: 'rushia',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/rushia/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'flare', awardType: 'card' },
  {
    level: 50,
    oshiId: 'flare',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/flare/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'marine', awardType: 'card' },
  {
    level: 50,
    oshiId: 'marine',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/marine/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'noel', awardType: 'card' },
  {
    level: 50,
    oshiId: 'noel',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/noel/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'kanata', awardType: 'card' },
  {
    level: 50,
    oshiId: 'kanata',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/kanata/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'watame', awardType: 'card' },
  {
    level: 50,
    oshiId: 'watame',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/watame/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'coco', awardType: 'card' },
  {
    level: 50,
    oshiId: 'coco',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/coco/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'towa', awardType: 'card' },
  {
    level: 50,
    oshiId: 'towa',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/towa/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'luna', awardType: 'card' },
  {
    level: 50,
    oshiId: 'luna',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/luna/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'polka', awardType: 'card' },
  {
    level: 50,
    oshiId: 'polka',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/polka/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'nene', awardType: 'card' },
  {
    level: 50,
    oshiId: 'nene',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/nene/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'botan', awardType: 'card' },
  {
    level: 50,
    oshiId: 'botan',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/botan/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'aloe', awardType: 'card' },
  {
    level: 50,
    oshiId: 'aloe',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/aloe/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'lamy', awardType: 'card' },
  {
    level: 50,
    oshiId: 'lamy',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/lamy/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'koyori', awardType: 'card' },
  {
    level: 50,
    oshiId: 'koyori',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/koyori/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'chloe', awardType: 'card' },
  {
    level: 50,
    oshiId: 'chloe',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/chloe/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'laplus', awardType: 'card' },
  {
    level: 50,
    oshiId: 'laplus',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/laplus/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'lui', awardType: 'card' },
  {
    level: 50,
    oshiId: 'lui',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/lui/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'iroha', awardType: 'card' },
  {
    level: 50,
    oshiId: 'iroha',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/iroha/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'raden', awardType: 'card' },
  {
    level: 50,
    oshiId: 'raden',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/raden/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'ao', awardType: 'card' },
  {
    level: 50,
    oshiId: 'ao',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/ao/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'kanade', awardType: 'card' },
  {
    level: 50,
    oshiId: 'kanade',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/kanade/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'ririka', awardType: 'card' },
  {
    level: 50,
    oshiId: 'ririka',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/ririka/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'hajime', awardType: 'card' },
  {
    level: 50,
    oshiId: 'hajime',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/hajime/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'riona', awardType: 'card' },
  {
    level: 50,
    oshiId: 'riona',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/riona/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'su', awardType: 'card' },
  {
    level: 50,
    oshiId: 'su',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/su/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'chihaya', awardType: 'card' },
  {
    level: 50,
    oshiId: 'chihaya',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/chihaya/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'niko', awardType: 'card' },
  {
    level: 50,
    oshiId: 'niko',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/niko/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'vivi', awardType: 'card' },
  {
    level: 50,
    oshiId: 'vivi',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/vivi/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'risu', awardType: 'card' },
  {
    level: 50,
    oshiId: 'risu',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/risu/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'moona', awardType: 'card' },
  {
    level: 50,
    oshiId: 'moona',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/moona/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'iofi', awardType: 'card' },
  {
    level: 50,
    oshiId: 'iofi',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/iofi/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'anya', awardType: 'card' },
  {
    level: 50,
    oshiId: 'anya',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/anya/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'reine', awardType: 'card' },
  {
    level: 50,
    oshiId: 'reine',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/reine/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'ollie', awardType: 'card' },
  {
    level: 50,
    oshiId: 'ollie',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/ollie/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'kaela', awardType: 'card' },
  {
    level: 50,
    oshiId: 'kaela',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/kaela/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'zeta', awardType: 'card' },
  {
    level: 50,
    oshiId: 'zeta',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/zeta/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'kobo', awardType: 'card' },
  {
    level: 50,
    oshiId: 'kobo',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/kobo/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'amelia', awardType: 'card' },
  {
    level: 50,
    oshiId: 'amelia',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/amelia/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'calli', awardType: 'card' },
  {
    level: 50,
    oshiId: 'calli',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/calli/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'ina', awardType: 'card' },
  {
    level: 50,
    oshiId: 'ina',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/ina/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'gura', awardType: 'card' },
  {
    level: 50,
    oshiId: 'gura',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/gura/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'kiara', awardType: 'card' },
  {
    level: 50,
    oshiId: 'kiara',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/kiara/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'baelz', awardType: 'card' },
  {
    level: 50,
    oshiId: 'baelz',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/baelz/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'irys', awardType: 'card' },
  {
    level: 50,
    oshiId: 'irys',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/irys/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'kronii', awardType: 'card' },
  {
    level: 50,
    oshiId: 'kronii',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/kronii/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'fauna', awardType: 'card' },
  {
    level: 50,
    oshiId: 'fauna',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/fauna/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'sana', awardType: 'card' },
  {
    level: 50,
    oshiId: 'sana',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/sana/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'mumei', awardType: 'card' },
  {
    level: 50,
    oshiId: 'mumei',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/mumei/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'fuwawa', awardType: 'card' },
  {
    level: 50,
    oshiId: 'fuwawa',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/fuwawa/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'mococo', awardType: 'card' },
  {
    level: 50,
    oshiId: 'mococo',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/mococo/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'bijou', awardType: 'card' },
  {
    level: 50,
    oshiId: 'bijou',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/bijou/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'shiori', awardType: 'card' },
  {
    level: 50,
    oshiId: 'shiori',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/shiori/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'nerissa', awardType: 'card' },
  {
    level: 50,
    oshiId: 'nerissa',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/nerissa/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'liz', awardType: 'card' },
  {
    level: 50,
    oshiId: 'liz',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/liz/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'raora', awardType: 'card' },
  {
    level: 50,
    oshiId: 'raora',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/raora/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'gigi', awardType: 'card' },
  {
    level: 50,
    oshiId: 'gigi',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/gigi/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'cecilia', awardType: 'card' },
  {
    level: 50,
    oshiId: 'cecilia',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/cecilia/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'a-chan', awardType: 'card' },
  {
    level: 50,
    oshiId: 'a-chan',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/a-chan/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 50, oshiId: 'nodoka', awardType: 'card' },
  {
    level: 50,
    oshiId: 'nodoka',
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/oshi/nodoka/bday", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);


await upsertMilestone(
  { level: 51, oshiId: null, awardType: 'eventPulls' },
  {
    level: 51,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 52, oshiId: null, awardType: 'eventPulls' },
  {
    level: 52,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 53, oshiId: null, awardType: 'card' },
  {
    level: 53,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OC", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 54, oshiId: null, awardType: 'eventPulls' },
  {
    level: 54,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 55, oshiId: null, awardType: 'card' },
  {
    level: 55,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OSR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 56, oshiId: null, awardType: 'eventPulls' },
  {
    level: 56,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 57, oshiId: null, awardType: 'card', priority: 5 },
  {
    level: 57,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);
await upsertMilestone(
  { level: 57, oshiId: null, awardType: 'card', priority: 4 },
  {
    level: 57,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 4
  }
);
await upsertMilestone(
  { level: 57, oshiId: null, awardType: 'card', priority: 3 },
  {
    level: 57,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 3
  }
);

await upsertMilestone(
  { level: 58, oshiId: null, awardType: 'eventPulls' },
  {
    level: 58,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 59, oshiId: null, awardType: 'card' },
  {
    level: 59,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/P", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 60, oshiId: null, awardType: 'card' },
  {
    level: 60,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 61, oshiId: null, awardType: 'card' },
  {
    level: 61,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/HR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 62, oshiId: null, awardType: 'eventPulls' },
  {
    level: 62,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 63, oshiId: null, awardType: 'eventPulls' },
  {
    level: 63,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 64, oshiId: null, awardType: 'eventPulls' },
  {
    level: 64,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 65, oshiId: null, awardType: 'card' },
  {
    level: 65,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 66, oshiId: null, awardType: 'card' },
  {
    level: 66,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OUR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 67, oshiId: null, awardType: 'card' },
  {
    level: 67,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);
await upsertMilestone(
  { level: 67, oshiId: null, awardType: 'card' },
  {
    level: 67,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);
await upsertMilestone(
  { level: 67, oshiId: null, awardType: 'card' },
  {
    level: 67,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 68, oshiId: null, awardType: 'eventPulls' },
  {
    level: 68,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 69, oshiId: null, awardType: 'card' },
  {
    level: 69,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/P", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 70, oshiId: null, awardType: 'card' },
  {
    level: 70,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 71, oshiId: null, awardType: 'eventPulls' },
  {
    level: 71,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 72, oshiId: null, awardType: 'eventPulls' },
  {
    level: 72,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 73, oshiId: null, awardType: 'card' },
  {
    level: 73,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OC", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 74, oshiId: null, awardType: 'eventPulls' },
  {
    level: 74,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 75, oshiId: null, awardType: 'card' },
  {
    level: 75,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/UR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 76, oshiId: null, awardType: 'eventPulls' },
  {
    level: 76,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 77, oshiId: null, awardType: 'card' },
  {
    level: 77,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OSR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 78, oshiId: null, awardType: 'eventPulls' },
  {
    level: 78,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 79, oshiId: null, awardType: 'card' },
  {
    level: 79,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/P", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 80, oshiId: null, awardType: 'card' },
  {
    level: 80,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 81, oshiId: null, awardType: 'eventPulls' },
  {
    level: 81,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 82, oshiId: null, awardType: 'eventPulls' },
  {
    level: 82,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 83, oshiId: null, awardType: 'card' },
  {
    level: 83,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OC", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 84, oshiId: null, awardType: 'eventPulls' },
  {
    level: 84,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 85, oshiId: null, awardType: 'card' },
  {
    level: 85,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 86, oshiId: null, awardType: 'eventPulls' },
  {
    level: 86,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 87, oshiId: null, awardType: 'card' },
  {
    level: 87,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);
await upsertMilestone(
  { level: 87, oshiId: null, awardType: 'card' },
  {
    level: 87,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);
await upsertMilestone(
  { level: 87, oshiId: null, awardType: 'card' },
  {
    level: 87,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/S", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 88, oshiId: null, awardType: 'card' },
  {
    level: 88,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OSR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 89, oshiId: null, awardType: 'card' },
  {
    level: 89,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/P", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 90, oshiId: null, awardType: 'card' },
  {
    level: 90,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

// Level 91: BDAY (entire pool) — use a poolFolder pointing to the entire images root
await upsertMilestone(
  { level: 91, oshiId: null, awardType: 'card' },
  {
    level: 91,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/bday", count: 1 }, // BDAY for entire pool
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 92, oshiId: null, awardType: 'eventPulls' },
  {
    level: 92,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 93, oshiId: null, awardType: 'card' },
  {
    level: 93,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OSR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 94, oshiId: null, awardType: 'eventPulls' },
  {
    level: 94,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 95, oshiId: null, awardType: 'card' },
  {
    level: 95,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 96, oshiId: null, awardType: 'eventPulls' },
  {
    level: 96,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 97, oshiId: null, awardType: 'card' },
  {
    level: 97,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SP", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 98, oshiId: null, awardType: 'eventPulls' },
  {
    level: 98,
    oshiId: null,
    awardType: 'eventPulls',
    awardValue: 1,
    oneTime: true,
    enabled: true,
    priority: 10
  }
);

await upsertMilestone(
  { level: 99, oshiId: null, awardType: 'card' },
  {
    level: 99,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/OUR", count: 1 },
    oneTime: true,
    enabled: true,
    priority: 5
  }
);

await upsertMilestone(
  { level: 100, oshiId: null, awardType: 'card' },
  {
    level: 100,
    oshiId: null,
    awardType: 'card',
    awardValue: { poolFolder: "./assets/images/SEC", count: 1 },
    oneTime: true,
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
