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
// Array positions are needed for processing small change-stream updates without
// downloading the entire inventory again. The original snapshots remain the
// authoritative aggregate counts used by fallback full refreshes.
const cardPositionsByDocument = new Map();
const userIdByDocument = new Map();
const pendingGains = new Map();
const saveChains = new Map();
const pendingRefreshes = new Map();
// A debounce timer alone does not prevent an already-running refresh from
// overlapping another read of the same multi-thousand-card inventory.
const refreshQueue = new Map();
const activeRefreshes = new Set();
const followUpRefreshes = new Map();

let changeStream = null;
let started = false;
let stopping = false;
let restartTimer = null;
let restartAttempt = 0;
let generation = 0;

const REFRESH_DEBOUNCE_MS = 750;
const GAINS_DEBOUNCE_MS = 750;
// Bound simultaneous full-inventory downloads across the bot. Keep both caps
// conservative on shared MongoDB Atlas tiers.
const MAX_CONCURRENT_REFRESHES = 2;
const SLOW_REFRESH_WARNING_MS = 2_000;
const SLOW_WARNING_INTERVAL_MS = 60_000;
const MAX_RESTART_DELAY_MS = 60_000;
let lastSlowWarningAt = 0;

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

function snapshotPositions(cards) {
  return (Array.isArray(cards) ? cards : []).map(card => ({
    name: String(card?.name ?? '').trim(),
    rarity: normalizeRarity(card?.rarity),
    variant: card?.variant ?? null,
    count: Math.max(0, Number(card?.count || 0)),
  }));
}

async function hydrateSnapshots() {
  snapshots.clear();
  cardPositionsByDocument.clear();
  userIdByDocument.clear();

  // Only read the two fields the watcher actually needs.
  const cursor = User.find({}, { id: 1, cards: 1 }).lean().cursor();
  let count = 0;

  for await (const doc of cursor) {
    if (!doc?.id) continue;
    snapshots.set(String(doc.id), snapshotCards(doc.cards));
    const documentId = String(doc._id);
    cardPositionsByDocument.set(documentId, snapshotPositions(doc.cards));
    userIdByDocument.set(documentId, String(doc.id));
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
  const documentKey = String(doc._id);
  cardPositionsByDocument.set(documentKey, snapshotPositions(doc.cards));
  userIdByDocument.set(documentKey, userId);

  if (gained.length) {
    await saveAcquisition(userId, gained, new Date());
  }
}

function drainRefreshQueue() {
  while (!stopping && activeRefreshes.size < MAX_CONCURRENT_REFRESHES && refreshQueue.size) {
    const [key, documentId] = refreshQueue.entries().next().value;
    refreshQueue.delete(key);

    if (activeRefreshes.has(key)) {
      followUpRefreshes.set(key, documentId);
      continue;
    }

    activeRefreshes.add(key);
    const beganAt = Date.now();
    void refreshDocument(documentId)
      .catch(err => {
        console.error('[acquisitionWatcher] failed to refresh changed inventory:', err);
      })
      .finally(() => {
        const elapsedMs = Date.now() - beganAt;
        if (elapsedMs >= SLOW_REFRESH_WARNING_MS &&
            Date.now() - lastSlowWarningAt >= SLOW_WARNING_INTERVAL_MS) {
          lastSlowWarningAt = Date.now();
          console.warn(`[acquisitionWatcher] slow inventory refresh: ${elapsedMs}ms; ` +
            'limiting concurrent inventory reads to prevent overload.');
        }

        activeRefreshes.delete(key);
        const followUpId = followUpRefreshes.get(key);
        followUpRefreshes.delete(key);
        // A write received while the read was in-flight may not have been
        // visible in its snapshot. Recheck once after the debounce window.
        if (!stopping && followUpId) scheduleDocumentRefresh(followUpId);
        drainRefreshQueue();
      });
  }
}

function scheduleDocumentRefresh(documentId) {
  const key = String(documentId ?? '');
  if (!key || stopping) return;

  // A queued read will see the newest state; scheduling another one would
  // only repeat the same full inventory download.
  if (refreshQueue.has(key)) return;
  // Do not start another read while one for this user is still in progress.
  if (activeRefreshes.has(key)) {
    followUpRefreshes.set(key, documentId);
    return;
  }

  const existing = pendingRefreshes.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingRefreshes.delete(key);
    if (stopping) return;
    if (activeRefreshes.has(key)) {
      followUpRefreshes.set(key, documentId);
    } else {
      refreshQueue.set(key, documentId);
      drainRefreshQueue();
    }
  }, REFRESH_DEBOUNCE_MS);

  timer.unref?.();
  pendingRefreshes.set(key, timer);
}

function enqueueAcquisitionSave(userId, cards) {
  const previous = saveChains.get(userId) || Promise.resolve();
  const next = previous.then(() => saveAcquisition(userId, cards))
    .catch(err => console.error('[acquisitionWatcher] incremental save failed:', err))
    .finally(() => { if (saveChains.get(userId) === next) saveChains.delete(userId); });
  saveChains.set(userId, next);
}

function queueGains(userId, gained) {
  if (!gained.length) return;
  const existing = pendingGains.get(userId) || { cards: new Map(), timer: null };
  for (const card of gained) {
    const key = cardKey(card);
    const old = existing.cards.get(key);
    if (old) old.count += card.count;
    else existing.cards.set(key, { ...card });
  }
  if (existing.timer) clearTimeout(existing.timer);
  existing.timer = setTimeout(() => {
    pendingGains.delete(userId);
    enqueueAcquisitionSave(userId, [...existing.cards.values()]);
  }, GAINS_DEBOUNCE_MS);
  existing.timer.unref?.();
  pendingGains.set(userId, existing);
}

// Most ordinary pulls modify just cards.<index>.count or append cards.<index>.
// Reconstructing those changes from the already-primed snapshot avoids a full
// cards-array read after every pull. Unknown array operations fall back to the
// existing conservative refresh (e.g. reorder, rename, deletion, replacement).
function applyIncrementalChange(change) {
  if (change?.operationType !== 'update') return false;
  const documentId = String(change?.documentKey?._id ?? '');
  const userId = userIdByDocument.get(documentId);
  const positions = cardPositionsByDocument.get(documentId);
  const counts = userId && snapshots.get(userId);
  if (!userId || !positions || !counts) return false;

  // If another event requires a full refresh, let it reconcile the latest state
  // rather than racing an incremental update against a database snapshot.
  if (activeRefreshes.has(documentId) || refreshQueue.has(documentId) ||
      pendingRefreshes.has(documentId) || followUpRefreshes.has(documentId)) return false;

  const description = change.updateDescription || {};
  if ((description.removedFields || []).some(pathTouchesCards) ||
      (description.truncatedArrays || []).some(entry => pathTouchesCards(entry?.field))) return false;

  const appends = [];
  const changes = [];
  for (const [path, value] of Object.entries(description.updatedFields || {})) {
    if (!pathTouchesCards(path)) continue;
    let match = /^cards\.(\d+)\.count$/.exec(path);
    if (match) {
      changes.push({ index: Number(match[1]), value });
      continue;
    }
    match = /^cards\.(\d+)$/.exec(path);
    if (match && value && typeof value === 'object' && !Array.isArray(value)) {
      appends.push({ index: Number(match[1]), value });
      continue;
    }
    if (/^cards\.\d+\.(?:lastAcquiredAt|firstAcquiredAt|locked|_id)$/.test(path)) continue;
    return false;
  }
  if (!appends.length && !changes.length) return true;

  appends.sort((a, b) => a.index - b.index);
  for (let i = 0; i < appends.length; i++) {
    const { index, value } = appends[i];
    if (index !== positions.length + i || !value.name || !value.rarity ||
        !Number.isFinite(Number(value.count ?? 0))) return false;
  }
  for (const { index, value } of changes) {
    if (index < 0 || index >= positions.length + appends.length ||
        !Number.isFinite(Number(value ?? 0))) return false;
  }

  const previousTotals = new Map();
  function changeTotal(card, difference) {
    const key = cardKey(card);
    const old = counts.get(key);
    if (!previousTotals.has(key)) previousTotals.set(key, old?.count || 0);
    if (old) old.count += difference;
    else counts.set(key, { ...card, count: difference });
  }
  for (const { value } of appends) {
    const card = snapshotPositions([value])[0];
    positions.push(card);
    changeTotal(card, card.count);
  }
  for (const { index, value } of changes) {
    const card = positions[index];
    const newCount = Math.max(0, Number(value || 0));
    const difference = newCount - card.count;
    card.count = newCount;
    changeTotal(card, difference);
  }

  const gained = [];
  for (const [key, previousCount] of previousTotals) {
    const current = counts.get(key);
    const difference = current.count - previousCount;
    if (difference > 0 && isTrackedRarity(current.rarity)) {
      gained.push({ name: current.name, rarity: current.rarity,
        variant: current.variant ?? null, count: difference });
    }
  }
  queueGains(userId, gained);
  return true;
}

function handleChange(change) {
  if (!changeTouchesCards(change)) return;

  const documentId = change?.documentKey?._id;
  if (!documentId) return;

  if (applyIncrementalChange(change)) return;
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
  refreshQueue.clear();
  followUpRefreshes.clear();
  for (const [userId, entry] of pendingGains) {
    if (entry.timer) clearTimeout(entry.timer);
    // A graceful stop should not discard acquisitions awaiting their debounce.
    enqueueAcquisitionSave(userId, [...entry.cards.values()]);
  }
  pendingGains.clear();
  await Promise.allSettled([...saveChains.values()]);
  saveChains.clear();

  const stream = changeStream;
  changeStream = null;
  await closeStreamSilently(stream);

  snapshots.clear();
  cardPositionsByDocument.clear();
  userIdByDocument.clear();
}

module.exports = {
  startAcquisitionWatcher,
  stopAcquisitionWatcher,
};
