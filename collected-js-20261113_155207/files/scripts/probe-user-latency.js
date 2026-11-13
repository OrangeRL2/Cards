'use strict';

// Read-only MongoDB Atlas latency probe for the Discord Cards bot.
// Run from the repository root: node scripts/probe-user-latency.js
// Uses the repo's existing config.json mongoUri. Does not start Discord,
// acquire any change streams, or write anything to the database.

const mongoose = require('mongoose');
const config = require('../config.json');
const User = require('../models/User');
const { performance } = require('node:perf_hooks');

const SAMPLES = 4;
const MAX_TIME_MS = 12000;
const DURATIONS = {};

function round(ms) { return Math.round(ms * 10) / 10; }
function stats(numbers) {
  if (!numbers.length) return 'no successful samples';
  const sorted = [...numbers].sort((a, b) => a - b);
  const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  return `min=${round(sorted[0])}ms avg=${round(mean)}ms max=${round(sorted.at(-1))}ms`;
}

async function measure(label, work) {
  const start = performance.now();
  try {
    const result = await work();
    const elapsed = performance.now() - start;
    (DURATIONS[label] ||= []).push(elapsed);
    console.log(`${label}: ${round(elapsed)}ms`);
    return result;
  } catch (err) {
    console.log(`${label}: FAILED after ${round(performance.now() - start)}ms (${err.name || 'Error'}: ${String(err.message || '').slice(0, 180)})`);
    return null;
  }
}

async function main() {
  if (typeof config.mongoUri !== 'string' || !config.mongoUri) {
    throw new Error('config.json needs its existing mongoUri setting.');
  }
  console.log('Read-only latency probe. No bot started, no database writes.');
  await measure('connect', () => mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 12000,
    socketTimeoutMS: 18000,
    maxPoolSize: 2,
    minPoolSize: 0,
  }));
  if (mongoose.connection.readyState !== 1) return;

  const largest = await measure('find-largest-user-document', async () => {
    const rows = await User.aggregate([
      { $project: { id: 1, bytes: { $bsonSize: '$$ROOT' } } },
      { $sort: { bytes: -1 } },
      { $limit: 1 },
    ]).option({ maxTimeMS: MAX_TIME_MS }).exec();
    return rows[0] || null;
  });
  if (!largest || !largest.id) {
    console.log('No user document was available; skipping user lookups.');
    return;
  }
  console.log(`Largest user document: ${round(largest.bytes / 1048576)} MiB (user ID intentionally omitted)`);

  for (let i = 1; i <= SAMPLES; i++) {
    console.log(`Sample ${i}/${SAMPLES}`);
    await measure('ping', () => mongoose.connection.db.admin().command({ ping: 1 }));
    await measure('indexed-user-id-only', () => User.findOne({ id: largest.id }, { id: 1 }).lean().maxTimeMS(MAX_TIME_MS).exec());
    const cardsDoc = await measure('same-user-entire-cards-array', () => User.findOne({ id: largest.id }, { cards: 1 }).lean().maxTimeMS(MAX_TIME_MS).exec());
    if (cardsDoc) console.log(`  cards array entries: ${cardsDoc.cards?.length ?? 0}`);
  }

  console.log('\nSummary:');
  for (const [label, durations] of Object.entries(DURATIONS)) {
    console.log(`  ${label}: ${stats(durations)}`);
  }
  console.log('A slow ping suggests connection/cluster/network trouble. Fast ping and ID-only lookup but slow cards-array reads suggests inventory transfer or document handling overhead.');
}

main().catch(err => {
  console.error('Probe could not complete:', err?.name || 'Error', String(err?.message || '').slice(0, 180));
  process.exitCode = 1;
}).finally(async () => {
  try { await mongoose.disconnect(); } catch (_) {}
});
