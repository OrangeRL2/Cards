// jobs/acquisitionWatcher.js
//
// Universal recent-acquisition tracker.
//
// Watches the MongoDB users collection for inventory changes and records only
// positive card-count differences. It does not care whether the card came from
// /pull, streams, login, shop, Guess, events, admin rewards, trades, or a future
// feature. If User.cards gains copies, this watcher sees them.
//
// This version avoids fullDocument:updateLookup on every User update, coalesces
// rapid card writes into one projected inventory read, and prevents restart loops.

const User = require('../models/User');
const {
  isTrackedRarity,
  normalizeRarity,
  getRetentionCutoff,
  MAX_ACQUISITION_BATCHES,
} = require('../utils/recentAcquisitions');

const snapshots = new Map();
const pendingRefreshes = new Map();

let changeStream = null;
let started = false;
let stopping = false;
let restartTimer = null;
let restartAttempt = 0;
let generation = 0;

const REFRESH_DEBOUNCE_MS = 750;
const MAX_RESTART_DELAY_MS = 60_000;

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

  // Only read the two fields the watcher actually needs.
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

  // Keep the existing storage format so !recents continues to work unchanged.
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

function pathTouchesCards(path) {
  const value = String(path ?? '');
  return value === 'cards' || value.startsWith('cards.');
}

function changeTouchesCards(change) {
  if (!change) return false;

  if (change.operationType === 'insert' || change.operationType === 'replace') {
    return true;
  }

  if (change.operationType !== 'update') return false;

  const desc = change.updateDescription || {};

  const updatedKeys = Object.keys(desc.updatedFields || {});
  if (updatedKeys.some(pathTouchesCards)) return true;

  const removedFields = Array.isArray(desc.removedFields) ? desc.removedFields : [];
  if (removedFields.some(pathTouchesCards)) return true;

  const truncatedArrays = Array.isArray(desc.truncatedArrays) ? desc.truncatedArrays : [];
  if (truncatedArrays.some(item => pathTouchesCards(item?.field))) return true;

  return false;
}

async function refreshDocument(documentId) {
  const doc = await User.findById(documentId, { id: 1, cards: 1 }).lean();
  if (!doc?.id) return;

  const userId = String(doc.id);
  const before = snapshots.get(userId) || new Map();
  const after = snapshotCards(doc.cards);
  const gained = positiveDifferences(before, after);

  // Update before writing recentAcquisitions. Those writes do not touch cards and
  // are ignored by changeTouchesCards(), so they cannot recursively re-read inventory.
  snapshots.set(userId, after);

  if (gained.length) {
    await saveAcquisition(userId, gained, new Date());
  }
}

function scheduleDocumentRefresh(documentId) {
  const key = String(documentId ?? '');
  if (!key || stopping) return;

  const existing = pendingRefreshes.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingRefreshes.delete(key);
    refreshDocument(documentId).catch(err => {
      console.error('[acquisitionWatcher] failed to refresh changed inventory:', err);
    });
  }, REFRESH_DEBOUNCE_MS);

  timer.unref?.();
  pendingRefreshes.set(key, timer);
}

function handleChange(change) {
  if (!changeTouchesCards(change)) return;

  const documentId = change?.documentKey?._id;
  if (!documentId) return;

  scheduleDocumentRefresh(documentId);
}

function restartDelayMs() {
  // 5s, 10s, 20s, 40s, then 60s maximum.
  return Math.min(5_000 * (2 ** Math.min(restartAttempt, 4)), MAX_RESTART_DELAY_MS);
}

function scheduleRestart() {
  if (stopping || restartTimer) return;

  const delay = restartDelayMs();
  restartAttempt += 1;

  console.warn(`[acquisitionWatcher] restarting change stream in ${Math.round(delay / 1000)}s.`);

  restartTimer = setTimeout(async () => {
    restartTimer = null;
    try {
      await openChangeStream();
    } catch (err) {
      console.error('[acquisitionWatcher] restart failed:', err);
      scheduleRestart();
    }
  }, delay);

  restartTimer.unref?.();
}

async function closeStreamSilently(stream) {
  if (!stream) return;

  // Important: remove listeners before intentionally closing. Otherwise our own
  // close() can fire the close handler and schedule another restart forever.
  stream.removeAllListeners('change');
  stream.removeAllListeners('error');
  stream.removeAllListeners('close');

  try { await stream.close(); } catch {}
}

async function openChangeStream() {
  if (stopping) return;

  const oldStream = changeStream;
  changeStream = null;
  if (oldStream) await closeStreamSilently(oldStream);

  const myGeneration = ++generation;

  // Do NOT use fullDocument:'updateLookup'. That option forces MongoDB to fetch
  // the entire User document for every matching update, including points, pity,
  // recentAcquisitions, stream state, etc. Instead, only card-changing events
  // cause one projected {id,cards} read, and rapid writes are debounced together.
  const stream = User.watch([
    {
      $match: {
        operationType: { $in: ['insert', 'update', 'replace'] },
      },
    },
  ]);

  changeStream = stream;

  stream.on('change', change => {
    if (stopping || changeStream !== stream || generation !== myGeneration) return;
    restartAttempt = 0;
    handleChange(change);
  });

  stream.on('error', err => {
    if (stopping || changeStream !== stream || generation !== myGeneration) return;
    console.error('[acquisitionWatcher] change stream error:', err);
    changeStream = null;
    scheduleRestart();
  });

  stream.on('close', () => {
    if (stopping || changeStream !== stream || generation !== myGeneration) return;
    changeStream = null;
    console.warn('[acquisitionWatcher] change stream closed unexpectedly.');
    scheduleRestart();
  });

  console.log('[acquisitionWatcher] watching User.cards for notable acquisitions.');
}

async function startAcquisitionWatcher() {
  if (started) return;
  started = true;
  stopping = false;
  restartAttempt = 0;

  // Starting from live inventory means bot restarts do not create fake
  // acquisitions for cards users already owned.
  await hydrateSnapshots();
  await openChangeStream();
}

async function stopAcquisitionWatcher() {
  stopping = true;
  started = false;
  generation += 1;

  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;

  for (const timer of pendingRefreshes.values()) clearTimeout(timer);
  pendingRefreshes.clear();

  const stream = changeStream;
  changeStream = null;
  await closeStreamSilently(stream);

  snapshots.clear();
}

module.exports = {
  startAcquisitionWatcher,
  stopAcquisitionWatcher,
};
