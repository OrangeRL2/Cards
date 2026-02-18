// utils/liveAsync.js
const { nanoid } = require('nanoid');
const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');

const STAGE_FOR_RARITY = { C:1, OC:1, U:1, S:2, R:2, RR:2, SR:3, OSR:3, UR:4, OUR:4, SY:4, SEC:5 };
const STAGE_NAMES = {1:'Galaxy',2:'SPACE',3:'CiRCLE',4:'RiNG',5:'Budokan'};

// success chance per rarity (unchanged)
const SUCCESS_RATES = { C:0.01, OC:0.09, U:0.05, S:0.29, R:0.19, RR:0.39, SR:0.49, OSR:0.59, UR:0.79, OUR:0.89, SY:0.69, SEC:0.99 };

// DURATIONS (UPDATED)
// 3: 3h -> 2h
// 4: 8h -> 4h
// 5: 22h -> 12h
const DURATION_MS = {
1: 30 * 60 * 1000,
2: 3.6e6,
3: 2 * 3.6e6,
4: 4 * 3.6e6,
5: 12 * 3.6e6,
};

// Stage 5 reward setup (UPDATED)
const STAGE5_CARD_RARITY = 'SP';
const STAGE5_POOL_DIRNAME = 'SP';

// On success: gain 50 fans OR SP; SP chance lowered because faster
const STAGE5_SUCCESS_POINTS = 50;
const STAGE5_SP_CHANCE = 0.55; // was 0.66; tweak as desired

// If SP pick fails for any reason, fallback to 50 points so "50 fans OR SP" still holds
const STAGE5_PICK_FALLBACK_POINTS = STAGE5_SUCCESS_POINTS;

// Stage 3/4 promo behavior (UPDATED)
const STAGE3_TWO_PROMO_CHANCE = 0.5; // 50% chance stage 3 gives 2 promos instead of 1
const STAGE4_PROMO_COUNT = 2;        // always 2 promos on success

function getStageForRarity(r){ return STAGE_FOR_RARITY[String(r)] ?? null; }
function getStageName(s){ return STAGE_NAMES[s] ?? `Stage ${s}`; }
function getDurationForStage(s){ return DURATION_MS[s] ?? 0; }
function getSuccessChance(r){ return SUCCESS_RATES[String(r)] ?? 0; }

function normalizeCardName(raw){
  if(!raw) return '';
  return String(raw).trim().replace(/[_\-]+/g,' ').replace(/\s+/g,' ').normalize('NFC');
}

function modifiedCountOf(res){ return res && (res.modifiedCount ?? res.nModified ?? res.n ?? 0); }

async function pickRandomFromDir(dirname) {
  try {
    const base = path.join(__dirname, '..', 'assets', 'images', dirname);
    console.log('[live] pickRandomFromDir using base path:', base);

    const stat = await fs.stat(base).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      console.log('[live] directory missing or invalid');
      return null;
    }

    const filesRaw = await fs.readdir(base);
    console.log('[live] filesRaw:', filesRaw);

    const files = filesRaw.filter(f => /\.(png|jpe?g|gif)$/i.test(f));
    console.log('[live] filtered files:', files);

    if (!files.length) return null;

    const chosen = files[Math.floor(Math.random() * files.length)];
    const displayName = normalizeCardName(path.basename(chosen, path.extname(chosen)));
    console.log('[live] picked file:', chosen);

    return { file: path.join(base, chosen), displayName };
  } catch (e) {
    console.warn('[live] pickRandomFromDir error', e);
    return null;
  }
}

async function pickRandomPCard(){ return pickRandomFromDir('P'); }
async function pickRandomStage5Card(){ return pickRandomFromDir(STAGE5_POOL_DIRNAME); }

// Inc-or-upsert card. Returns { card, path, raw } or null
async function incOrUpsertCard(userId, name, rarity, opts = {}) {
  const session = opts.session ?? null;
  const ts = new Date();
  const normalized = normalizeCardName(name);

  const findInArray = (cards) => {
    if (!Array.isArray(cards)) return null;
    return cards.find(
      c => normalizeCardName(c.name) === normalized &&
      String(c.rarity) === String(rarity)
    );
  };

  // 1) Fast insert-if-missing
  try {
    const pushDoc = {
      name: normalized,
      rarity,
      count: 1,
      firstAcquiredAt: ts,
      lastAcquiredAt: ts,
    };

    const pushFilter = {
      id: userId,
      $nor: [{ cards: { $elemMatch: { name: normalized, rarity } } }]
    };

    const pushUpdate = { $push: { cards: pushDoc } };
    const pushOpts = session ? { session, returnDocument: 'after' } : { returnDocument: 'after' };

    const pushedDoc = await User
      .findOneAndUpdate(pushFilter, pushUpdate, pushOpts)
      .lean()
      .exec();

    if (pushedDoc) {
      const cardElem = findInArray(pushedDoc.cards);
      if (cardElem) return { card: cardElem, path: 'push', raw: { ok: 1 } };
    }
  } catch (err) {
    console.error('[incOrUpsertCard] push error', err);
  }

  // 2) Increment by _id (safe)
  try {
    const userDoc = await User
      .findOne({ id: userId }, { cards: 1 }, session ? { session } : {})
      .lean();

    if (userDoc?.cards?.length) {
      const found = findInArray(userDoc.cards);
      if (found) {
        const arrayFilters = [{ 'elem._id': found._id }];
        const incUpdate = {
          $inc: { 'cards.$[elem].count': 1 },
          $set: { 'cards.$[elem].lastAcquiredAt': ts },
        };
        const optsFNU = session ? { session, arrayFilters, returnDocument: 'after' } : { arrayFilters, returnDocument: 'after' };

        const updated = await User
          .findOneAndUpdate({ id: userId }, incUpdate, optsFNU)
          .lean()
          .exec();

        if (updated?.cards) {
          const updatedElem = updated.cards.find(c => String(c._id) === String(found._id));
          if (updatedElem) return { card: updatedElem, path: 'inc-by-id', raw: { ok: 1 } };
        }
      }
    }
  } catch (err) {
    console.error('[incOrUpsertCard] inc-by-id error', err);
  }

  // 3) Name-based fallback
  try {
    const arrayFilters = [{ 'elem.name': normalized, 'elem.rarity': rarity }];
    const incUpdate = {
      $inc: { 'cards.$[elem].count': 1 },
      $set: { 'cards.$[elem].lastAcquiredAt': ts },
    };

    const incRes = await User.updateOne(
      { id: userId },
      incUpdate,
      session ? { session, arrayFilters } : { arrayFilters }
    ).exec();

    if (modifiedCountOf(incRes) > 0) {
      const doc = await User
        .findOne({ id: userId }, { cards: 1 }, session ? { session } : {})
        .lean();

      const card = findInArray(doc?.cards);
      if (card) return { card, path: 'inc', raw: incRes };
    }
  } catch (err) {
    console.error('[incOrUpsertCard] fallback error', err);
  }

  // 4) Final fetch
  try {
    const doc2 = await User
      .findOne({ id: userId }, { cards: 1 }, session ? { session } : {})
      .lean();

    const card2 = findInArray(doc2?.cards);
    return card2 ? { card: card2, path: 'fetch' } : null;
  } catch (err) {
    console.error('[incOrUpsertCard] final-fetch error', err);
    return null;
  }
}

// Central helper to award a P card (session-aware), returns awarded card element or null
async function tryAwardPCard({ userId, picked, session, trace }) {
  if (!picked) {
    trace.notes.push('P-pick-null');
    const delta = 5;
    trace.awardedPoints = (trace.awardedPoints || 0) + delta;
    await User.updateOne({ id: userId }, { $inc: { points: delta } }, session ? { session } : {}).exec();
    return null;
  }

  const pickedName = normalizeCardName(picked.displayName);
  const pRes = await incOrUpsertCard(userId, pickedName, 'P', session ? { session } : {});
  console.debug('[live] incOrUpsertCard result for pickedName:', { pickedName, pRes });

  if (!pRes) {
    trace.notes.push('P-insert-miss');
    const delta = 5;
    trace.awardedPoints = (trace.awardedPoints || 0) + delta;
    await User.updateOne({ id: userId }, { $inc: { points: delta } }, session ? { session } : {}).exec();
    return null;
  }

  const pElem = pRes.card ? pRes.card : pRes;
  trace.awardedPCard = { name: pElem.name, rarity: pElem.rarity };
  console.debug('[live] awarded-p raw result:', pElem);
  return pElem;
}

// Start attempt: normalize input, decrement card, push pendingAttempt
async function startAttemptAtomic(userId, name, rarity) {
  const normalized = normalizeCardName(name);
  const stage = getStageForRarity(rarity);
  if (!stage) return { success: false, reason: 'invalid-rarity' };

  const now = new Date();
  const readyAt = new Date(Date.now() + getDurationForStage(stage));
  const attemptId = nanoid();

  const query = {
    id: userId,
    $or: [
      { pendingAttempts: { $exists: false } },
      { pendingAttempts: { $not: { $elemMatch: { stage, resolved: false } } } }
    ]
  };

  const update = {
    $inc: { 'cards.$[elem].count': -1 },
    $set: { 'cards.$[elem].lastAcquiredAt': now },
    $push: {
      pendingAttempts: {
        id: attemptId,
        name: normalized,
        rarity,
        stage,
        startedAt: now,
        readyAt,
        resolved: false,
        success: null,
        effectsApplied: false,
        effectsTrace: {}
      }
    }
  };

  const arrayFilters = [{ 'elem.name': normalized, 'elem.rarity': rarity, 'elem.count': { $gt: 0 } }];

  const res = await User.findOneAndUpdate(
    query,
    update,
    { arrayFilters, returnDocument: 'after' }
  ).exec();

  if (!res) {
    const u = await User.findOne({ id: userId }).lean();
    if (u) {
      const existing = (u.pendingAttempts || []).find(a => !a.resolved && Number(a.stage) === Number(stage));
      if (existing) return { success: false, reason: 'stage-busy', nextReadyAt: existing.readyAt };
      return { success: false, reason: 'no-card' };
    }
    return { success: false, reason: 'no-user' };
  }

  const added = (res.pendingAttempts || []).find(a => a.id === attemptId);
  if (!added) return { success: false, reason: 'no-card' };

  // cleanup zero-count cards (best effort)
  User.updateOne(
    { id: userId },
    { $pull: { cards: { count: { $lte: 0 } } } }
  ).exec().catch(() => {});

  return { success: true, attemptId, readyAt, stage };
}

// Resolve attempt: transaction path + fallback no-session path
async function resolveAttemptAtomic(userId, attemptId) {
  const session = await mongoose.startSession().catch(() => null);
  const trace = { restoredCard: null, awardedPoints: 0, awardedPCard: null, awardedPCards: null, notes: [] };

  const normalizeAward = (pElem, defaultRarity = 'P') => {
    if (!pElem) return null;
    const card = (pElem && typeof pElem === 'object' && pElem.card) ? pElem.card : pElem;
    return {
      name: card?.name || card?.displayName || '',
      displayName: card?.displayName || card?.name || '',
      rarity: card?.rarity || defaultRarity
    };
  };

  // helper: base fail fans based on success chance (cf)
  const baseFailPoints = (cf) => Math.max(0, Math.round(Number(cf) * 100));

  // helper: success promo count for stage 3/4 rules
  const promoCountForStage = (stageNum) => {
    if (stageNum === 4) return STAGE4_PROMO_COUNT; // always 2
    if (stageNum === 3) return (Math.random() < STAGE3_TWO_PROMO_CHANCE) ? 2 : 1; // 50% chance 2
    return 1;
  };

  if (session) {
    try {
      let out = null;

      await session.withTransaction(async () => {
        const userDoc = await User.findOne({ id: userId }).session(session).exec();
        if (!userDoc) throw new Error('no-user');

        const attempt = (userDoc.pendingAttempts || []).find(a => a.id === attemptId);
        if (!attempt) throw new Error('no-attempt');
        if (attempt.resolved) throw new Error('already-resolved');

        const now = Date.now();
        if (new Date(attempt.readyAt).getTime() > now) throw new Error('not-ready\n' + attempt.readyAt);

        const stageNum = Number(attempt.stage);
        const normalizedAttemptName = normalizeCardName(attempt.name);
        const successChance = getSuccessChance(attempt.rarity);
        const successResult = Math.random() <= successChance;

        // mark resolved first (idempotency)
        const mark = await User.updateOne(
          { id: userId, 'pendingAttempts.id': attemptId, 'pendingAttempts.resolved': false },
          { $set: {
              'pendingAttempts.$[p].resolved': true,
              'pendingAttempts.$[p].success': successResult,
              'pendingAttempts.$[p].effectsApplied': false
            }
          },
          { arrayFilters: [{ 'p.id': attemptId }], session }
        ).exec();

        if (modifiedCountOf(mark) === 0) throw new Error('already-resolved');

        let awardedPoints = 0;
        let awardedP = null;
        let awardedPs = [];

        if (successResult) {
          // restore original staked card
          const restoredOriginal = await incOrUpsertCard(
            userId,
            normalizedAttemptName,
            attempt.rarity,
            { session }
          );

          if (restoredOriginal) {
            trace.restoredCard = {
              name: (restoredOriginal.card ? restoredOriginal.card.name : restoredOriginal.name) || '',
              rarity: (restoredOriginal.card ? restoredOriginal.card.rarity : restoredOriginal.rarity) || attempt.rarity
            };
          } else {
            trace.notes.push('restore-original-miss');
          }

          if (stageNum === 5) {
            // UPDATED Stage 5 success: SP (lower chance) OR +50 points
            const roll = Math.random();
            if (roll <= STAGE5_SP_CHANCE) {
              const picked = await pickRandomStage5Card();
              if (!picked) {
                trace.notes.push('stage5-pick-null');
                awardedPoints += STAGE5_PICK_FALLBACK_POINTS;
                await User.updateOne(
                  { id: userId },
                  { $inc: { points: STAGE5_PICK_FALLBACK_POINTS } },
                  { session }
                ).exec();
              } else {
                const pickedName = normalizeCardName(picked.displayName);
                const pElem = await incOrUpsertCard(
                  userId,
                  pickedName,
                  STAGE5_CARD_RARITY,
                  { session }
                );
                const norm = normalizeAward(pElem, STAGE5_CARD_RARITY);
                if (norm) {
                  awardedP = norm;
                } else {
                  trace.notes.push('stage5-insert-miss');
                  awardedPoints += STAGE5_PICK_FALLBACK_POINTS;
                  await User.updateOne(
                    { id: userId },
                    { $inc: { points: STAGE5_PICK_FALLBACK_POINTS } },
                    { session }
                  ).exec();
                }
              }
            } else {
              awardedPoints += STAGE5_SUCCESS_POINTS;
              await User.updateOne(
                { id: userId },
                { $inc: { points: STAGE5_SUCCESS_POINTS } },
                { session }
              ).exec();
            }
          } else {
            // Stages 1–4 success rewards: P cards
            const pAwardCount = promoCountForStage(stageNum);

            for (let i = 0; i < pAwardCount; i++) {
              const picked = await pickRandomPCard();
              if (!picked) {
                trace.notes.push(`P-pick-null-${i}`);
                awardedPoints += 5;
                await User.updateOne(
                  { id: userId },
                  { $inc: { points: 5 } },
                  { session }
                ).exec();
                continue;
              }

              const pickedName = normalizeCardName(picked.displayName);
              const pElem = await incOrUpsertCard(userId, pickedName, 'P', { session });
              const norm = normalizeAward(pElem, 'P');

              if (norm) {
                awardedPs.push({ name: norm.name, displayName: norm.displayName, rarity: norm.rarity });
              } else {
                trace.notes.push(`P-insert-miss-${i}`);
                awardedPoints += 5;
                await User.updateOne(
                  { id: userId },
                  { $inc: { points: 5 } },
                  { session }
                ).exec();
              }
            }

            if (awardedPs.length) awardedP = awardedPs[0];
          }
        } else {
          // UPDATED failure points for stages 3/4 rules
          const cf = getSuccessChance(attempt.rarity);
          const s = stageNum;

          if (s === 5) awardedPoints = 1000;
          else if (s === 1) awardedPoints = baseFailPoints(cf);
          else if (s === 2) awardedPoints = Math.round(baseFailPoints(cf) * 0.5);
          else if (s === 3) awardedPoints = baseFailPoints(cf);                 // match success rate
          else if (s === 4) awardedPoints = Math.round(baseFailPoints(cf) * 1.25); // +25%
          else awardedPoints = Math.round(baseFailPoints(cf) * 0.5);

          if (awardedPoints > 0) {
            await User.updateOne(
              { id: userId },
              { $inc: { points: awardedPoints } },
              { session }
            ).exec();
          }
        }

        trace.awardedPoints = awardedPoints;

        // set awarded card trace fields
        if (awardedP) {
          trace.awardedPCard = { name: awardedP.name, displayName: awardedP.displayName, rarity: awardedP.rarity };
        }
        if (awardedPs && awardedPs.length) {
          trace.awardedPCards = awardedPs;
        }

        // mark effects applied + store trace
        await User.updateOne(
          { id: userId, 'pendingAttempts.id': attemptId },
          { $set: { 'pendingAttempts.$[p].effectsApplied': true, 'pendingAttempts.$[p].effectsTrace': trace } },
          { arrayFilters: [{ 'p.id': attemptId }], session }
        ).exec();

        out = {
          success: true,
          resolved: true,
          attemptId,
          successResult,
          // backwards-compatible field (first card)
          pCard: trace.awardedPCard,
          // new field for multi-reward
          pCards: trace.awardedPCards || (trace.awardedPCard ? [trace.awardedPCard] : []),
          awardedPoints: trace.awardedPoints || 0
        };
      });

      return out;
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg === 'no-user') return { success: false, reason: 'no-user' };
      if (msg === 'no-attempt') return { success: false, reason: 'no-attempt' };
      if (msg === 'already-resolved') return { success: false, reason: 'already-resolved' };
      if (msg.startsWith('not-ready')) return { success: false, reason: 'not-ready', readyAt: new Date(msg.split('\n')[1]) };

      console.error('[live] resolveAttemptAtomic transaction error', err);
      return { success: false, reason: 'internal-error' };
    } finally {
      session.endSession();
    }
  } else {
    // fallback no-session path (idempotent)
    try {
      const snapshot = await User.findOne({ id: userId }).lean();
      if (!snapshot) return { success: false, reason: 'no-user' };

      const attempt = (snapshot.pendingAttempts || []).find(a => a.id === attemptId);
      if (!attempt) return { success: false, reason: 'no-attempt' };
      if (attempt.resolved) return { success: false, reason: 'already-resolved' };

      const now = Date.now();
      if (new Date(attempt.readyAt).getTime() > now) return { success: false, reason: 'not-ready', readyAt: attempt.readyAt };

      const stageNum = Number(attempt.stage);
      const normalizedAttemptName = normalizeCardName(attempt.name);
      const successChance = getSuccessChance(attempt.rarity);
      const successResult = Math.random() <= successChance;

      const mark = await User.updateOne(
        { id: userId, 'pendingAttempts.id': attemptId, 'pendingAttempts.resolved': false },
        { $set: { 'pendingAttempts.$.resolved': true, 'pendingAttempts.$.success': successResult, 'pendingAttempts.$.effectsApplied': false } }
      ).exec();

      if (modifiedCountOf(mark) === 0) return { success: false, reason: 'already-resolved' };

      let awardedPoints = 0;
      let awardedP = null;
      let awardedPs = [];

      // helper: base fail fans based on success chance (cf)
      const baseFailPoints = (cf) => Math.max(0, Math.round(Number(cf) * 100));

      // helper: success promo count for stage 3/4 rules
      const promoCountForStage = (s) => {
        if (s === 4) return STAGE4_PROMO_COUNT;
        if (s === 3) return (Math.random() < STAGE3_TWO_PROMO_CHANCE) ? 2 : 1;
        return 1;
      };

      if (successResult) {
        // NOTE: this no-session path previously didn't restore the staked card;
        // leaving behavior as-is can cause card loss on success if sessions are unavailable.
        // If you want parity with the transaction path, uncomment the restore below.
        await incOrUpsertCard(userId, normalizedAttemptName, attempt.rarity);

        if (stageNum === 5) {
          const roll = Math.random();
          if (roll <= STAGE5_SP_CHANCE) {
            const picked = await pickRandomStage5Card();
            if (!picked) {
              trace.notes.push('stage5-pick-null');
              awardedPoints += STAGE5_PICK_FALLBACK_POINTS;
              await User.updateOne(
                { id: userId },
                { $inc: { points: STAGE5_PICK_FALLBACK_POINTS } }
              ).exec();
            } else {
              const pickedName = normalizeCardName(picked.displayName);
              const pElem = await incOrUpsertCard(userId, pickedName, STAGE5_CARD_RARITY);
              const norm = normalizeAward(pElem, STAGE5_CARD_RARITY);
              if (norm) awardedP = norm;
              else {
                trace.notes.push('stage5-insert-miss');
                awardedPoints += STAGE5_PICK_FALLBACK_POINTS;
                await User.updateOne(
                  { id: userId },
                  { $inc: { points: STAGE5_PICK_FALLBACK_POINTS } }
                ).exec();
              }
            }
          } else {
            awardedPoints += STAGE5_SUCCESS_POINTS;
            await User.updateOne({ id: userId }, { $inc: { points: STAGE5_SUCCESS_POINTS } }).exec();
          }
        } else {
          const pAwardCount = promoCountForStage(stageNum);

          for (let i = 0; i < pAwardCount; i++) {
            const picked = await pickRandomPCard();
            if (!picked) {
              trace.notes.push(`P-pick-null-${i}`);
              awardedPoints += 5;
              await User.updateOne({ id: userId }, { $inc: { points: 5 } }).exec();
              continue;
            }

            const pickedName = normalizeCardName(picked.displayName);
            const pElem = await incOrUpsertCard(userId, pickedName, 'P');
            const norm = normalizeAward(pElem, 'P');

            if (norm) {
              awardedPs.push({ name: norm.name, displayName: norm.displayName, rarity: norm.rarity });
            } else {
              trace.notes.push(`P-insert-miss-${i}`);
              awardedPoints += 5;
              await User.updateOne({ id: userId }, { $inc: { points: 5 } }).exec();
            }
          }

          if (awardedPs.length) awardedP = awardedPs[0];
        }
      } else {
        const cf = getSuccessChance(attempt.rarity);
        const s = stageNum;

        if (s === 5) awardedPoints = 1000;
        else if (s === 1) awardedPoints = baseFailPoints(cf);
        else if (s === 2) awardedPoints = Math.round(baseFailPoints(cf) * 0.5);
        else if (s === 3) awardedPoints = baseFailPoints(cf);
        else if (s === 4) awardedPoints = Math.round(baseFailPoints(cf) * 1.25);
        else awardedPoints = Math.round(baseFailPoints(cf) * 0.5);

        if (awardedPoints > 0) await User.updateOne({ id: userId }, { $inc: { points: awardedPoints } }).exec();
      }

      trace.awardedPoints = awardedPoints;
      if (awardedP) trace.awardedPCard = { name: awardedP.name, displayName: awardedP.displayName, rarity: awardedP.rarity };
      if (awardedPs && awardedPs.length) trace.awardedPCards = awardedPs;

      await User.updateOne(
        { id: userId, 'pendingAttempts.id': attemptId },
        { $set: { 'pendingAttempts.$.effectsApplied': true, 'pendingAttempts.$.effectsTrace': trace } }
      ).exec();

      return {
        success: true,
        resolved: true,
        attemptId,
        successResult,
        pCard: trace.awardedPCard,
        pCards: trace.awardedPCards || (trace.awardedPCard ? [trace.awardedPCard] : []),
        awardedPoints: trace.awardedPoints || 0
      };
    } catch (err) {
      console.error('[live] resolveAttemptAtomic error (no-session)', err);
      return { success: false, reason: 'internal-error' };
    }
  }
}

module.exports = {
  startAttemptAtomic,
  resolveAttemptAtomic,
  getStageForRarity,
  getStageName,
  getDurationForStage,
  getSuccessChance,
  pickRandomPCard,
  pickRandomStage5Card,
  normalizeCardName,
  incOrUpsertCard,
};