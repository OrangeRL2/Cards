// jobs/acquisitionWatcher.js
//
// Universal recent-acquisition tracker.
//
// Watches the MongoDB users collection for inventory changes and records only
// positive card-count differences. It does not care whether the card came from
// /pull, streams, login, shop, Guess, events, admin rewards, trades, or a future
// feature. If User.cards gains copies, this watcher sees them.
//
// Requires MongoDB change streams (Atlas / replica set).

const User = require('../models/User');
const {
  isTrackedRarity,
  normalizeRarity,
  getRetentionCutoff,
  MAX_ACQUISITION_BATCHES,
} = require('../utils/recentAcquisitions');

const snapshots = new Map();

let changeStream = null;
let started = false;
let stopping = false;
let restartTimer = null;

function cardKey(card) {
  const rarity = normalizeRarity(card?.rarity);
  const name = String(card?.name ?? '').trim().toLowerCase();
  const variant = String(card?.variant ?? '').trim().toLowerCase();
  return `${rarity}\u0000${name}\u0000${variant}`;
}

function snapshotCards(cards) {
  const map = new Map();

  for (const card of Array.isArray(cards) ? cards : []) {
    const name = String(card?.name ?? '').trim();
    const rarity = normalizeRarity(card?.rarity);
    if (!name || !rarity) continue;

    const count = Math.max(0, Number(card?.count || 0));
    const key = cardKey(card);

    // Defensive sum in case an old user document contains duplicate stacks.
    const existing = map.get(key);
    if (existing) {
      existing.count += count;
    } else {
      map.set(key, {
        name,
        rarity,
        variant: card?.variant ?? null,
        count,
      });
    }
  }

  return map;
}

function positiveDifferences(before, after) {
  const gained = [];

  for (const [key, current] of after.entries()) {
    const previousCount = Number(before.get(key)?.count || 0);
    const delta = Number(current.count || 0) - previousCount;

    if (delta <= 0) continue;
    if (!isTrackedRarity(current.rarity)) continue;

    gained.push({
      name: current.name,
      rarity: current.rarity,
      variant: current.variant ?? null,
      count: delta,
    });
  }

  return gained;
}

async function hydrateSnapshots() {
  snapshots.clear();

  const cursor = User.find({}, { id: 1, cards: 1 }).lean().cursor();
  let count = 0;

  for await (const doc of cursor) {
    if (!doc?.id) continue;
    snapshots.set(String(doc.id), snapshotCards(doc.cards));
    count += 1;
  }

  console.log(`[acquisitionWatcher] primed ${count} user inventory snapshot(s).`);
}

async function saveAcquisition(userId, cards, acquiredAt = new Date()) {
  if (!cards.length) return;

  const cutoff = getRetentionCutoff(acquiredAt);

  // Prune stale history first. This write also appears in the change stream,
  // but it does not change cards, so it cannot create a fake acquisition.
  await User.updateOne(
    { id: userId },
    { $pull: { recentAcquisitions: { acquiredAt: { $lt: cutoff } } } }
  ).exec();

  await User.updateOne(
    { id: userId },
    {
      $push: {
        recentAcquisitions: {
          $each: [{ acquiredAt, cards }],
          $slice: -MAX_ACQUISITION_BATCHES,
        },
      },
    }
  ).exec();

  const summary = cards
    .map(card => `${card.count}x [${card.rarity}] ${card.name}`)
    .join(', ');
  console.log(`[acquisitionWatcher] ${userId}: ${summary}`);
}

async function handleChange(change) {
  if (!change?.fullDocument?.id) return;

  const userId = String(change.fullDocument.id);
  const before = snapshots.get(userId) || new Map();
  const after = snapshotCards(change.fullDocument.cards);
  const gained = positiveDifferences(before, after);

  // Update the snapshot before writing history so the watcher's own write cannot
  // re-detect the same inventory increase.
  snapshots.set(userId, after);

  if (gained.length) {
    await saveAcquisition(userId, gained, new Date());
  }
}

function scheduleRestart() {
  if (stopping || restartTimer) return;

  restartTimer = setTimeout(async () => {
    restartTimer = null;
    try {
      await openChangeStream();
    } catch (err) {
      console.error('[acquisitionWatcher] restart failed:', err);
      scheduleRestart();
    }
  }, 5000);

  restartTimer.unref?.();
}

async function openChangeStream() {
  if (stopping) return;

  if (changeStream) {
    try { await changeStream.close(); } catch {}
    changeStream = null;
  }

  // Only inserts/updates/replaces can affect a user's inventory.
  changeStream = User.watch(
    [
      {
        $match: {
          operationType: { $in: ['insert', 'update', 'replace'] },
        },
      },
    ],
    { fullDocument: 'updateLookup' }
  );

  changeStream.on('change', change => {
    handleChange(change).catch(err => {
      console.error('[acquisitionWatcher] failed to process change:', err);
    });
  });

  changeStream.on('error', err => {
    console.error('[acquisitionWatcher] change stream error:', err);
    scheduleRestart();
  });

  changeStream.on('close', () => {
    if (!stopping) {
      console.warn('[acquisitionWatcher] change stream closed; scheduling restart.');
      scheduleRestart();
    }
  });

  console.log('[acquisitionWatcher] watching User.cards for notable acquisitions.');
}

async function startAcquisitionWatcher() {
  if (started) return;
  started = true;
  stopping = false;

  // Starting from the live inventory means bot restarts do not create fake
  // "new" acquisitions for cards users already owned.
  await hydrateSnapshots();
  await openChangeStream();
}

async function stopAcquisitionWatcher() {
  stopping = true;
  started = false;

  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;

  if (changeStream) {
    try { await changeStream.close(); } catch {}
    changeStream = null;
  }

  snapshots.clear();
}

module.exports = {
  startAcquisitionWatcher,
  stopAcquisitionWatcher,
};
