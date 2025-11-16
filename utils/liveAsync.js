// utils/liveAsync.js
const { nanoid } = require('nanoid');
const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');

const STAGE_FOR_RARITY = { C:1, OC:1, U:1, S:2, R:2, RR:2, SR:3, OSR:3, UR:4, OUR:4, SY:4, SEC:5 };
const STAGE_NAMES = {1:'Galaxy',2:'SPACE',3:'CiRCLE',4:'RiNG',5:'Budokan'};
const SUCCESS_RATES = { C:0.01, OC:0.05, U:0.02, S:0.29, R:0.11, RR:0.30, SR:0.46, OSR:0.48, UR:0.66, OUR:0.77, SY:0.57, SEC:0.99 };
const DURATION_MS = {
  1:30 * 60 * 1000,
  2:3.6e6,
  3:5*3.6e6,
  4:12*3.6e6,
  5:24*3.6e6
}; // keep same shape; adjust 5 for prod
const STAGE5_CARD_RARITY = 'SP';
const STAGE5_POOL_DIRNAME = 'SP';
const STAGE5_PICK_FALLBACK_POINTS = 25;

function getStageForRarity(r){ return STAGE_FOR_RARITY[String(r)] || null; }
function getStageName(s){ return STAGE_NAMES[s] || `Stage ${s}`; }
function getDurationForStage(s){ return DURATION_MS[s] || 0; }
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
// Inc-or-upsert card. Returns { card, path, raw } or null
async function incOrUpsertCard(userId, name, rarity, opts = {}) {
  const session = opts.session || null;
  const origin = opts.origin ? String(opts.origin) : null;
  const ts = new Date();
  const normalized = normalizeCardName(name);

  const findInArray = (cards) => {
    if (!Array.isArray(cards)) return null;
    return cards.find(c => normalizeCardName(c.name) === normalized && String(c.rarity) === String(rarity));
  };

  // 1) Fast insert-if-missing via findOneAndUpdate (returns updated doc)
  try {
    const pushTimestamps = origin ? [{ ts, origin }] : [ts];
    const pushDoc = { name: normalized, rarity, count: 1, timestamps: pushTimestamps };

    const pushFilter = { id: userId, $nor: [{ cards: { $elemMatch: { name: normalized, rarity } } }] };
    const pushUpdate = { $push: { cards: pushDoc } };
    const pushOpts = session ? { session, returnDocument: 'after' } : { returnDocument: 'after' };

    console.debug('[live] incOrUpsertCard push (findOneAndUpdate)', { userId, normalized, rarity, hasSession: !!session });
    const pushedDoc = await User.findOneAndUpdate(pushFilter, pushUpdate, pushOpts).lean().exec();

    if (pushedDoc) {
      const cardElem = findInArray(pushedDoc.cards);
      if (cardElem) return { card: cardElem, path: 'push', raw: { acknowledged: true, matchedCount: 1, modifiedCount: 1 } };
      console.warn('[live] push returned doc but card not found in returned array; falling through', { userId, normalized, rarity });
    }
  } catch (err) {
    console.error('[live] incOrUpsertCard push error', err);
  }

  // 2) Deterministic: fetch user's cards, find best match with normalizeCardName, then increment by _id
  try {
    const userDoc = await User.findOne({ id: userId }, { cards: 1 }, session ? { session } : {}).lean();
    if (userDoc && Array.isArray(userDoc.cards) && userDoc.cards.length) {
      const found = findInArray(userDoc.cards);
      if (found) {
        const arrayFilters = [{ 'elem._id': found._id }];
        const incUpdate = {
          $inc: { 'cards.$[elem].count': 1 },
          $push: { 'cards.$[elem].timestamps': origin ? { ts, origin } : ts }
        };
        const optsFNU = session ? { session, arrayFilters, returnDocument: 'after' } : { arrayFilters, returnDocument: 'after' };

        console.debug('[live] incOrUpsertCard increment-by-id (findOneAndUpdate)', { userId, normalized, rarity, cardId: found._id });
        const updated = await User.findOneAndUpdate({ id: userId }, incUpdate, optsFNU).lean().exec();

        if (updated && Array.isArray(updated.cards)) {
          const updatedElem = (updated.cards || []).find(c => String(c._id) === String(found._id));
          if (updatedElem) return { card: updatedElem, path: 'inc-by-id', raw: { acknowledged: true, matchedCount: 1, modifiedCount: 1 } };
        }

        console.warn('[live] increment-by-id succeeded but returned doc missing element', { userId, normalized, rarity, cardId: found._id });
      } else {
        console.debug('[live] no matching card found in user cards for normalized name; will try name-based inc', { userId, normalized, rarity });
      }
    }
  } catch (err) {
    console.error('[live] incOrUpsertCard increment-by-id error', err);
  }

  // 3) Name-based arrayFilters fallback (try to increment by name/rarity)
  try {
    const arrayFilters = [{ 'elem.name': normalized, 'elem.rarity': rarity }];
    const incUpdate = {
      $inc: { 'cards.$[elem].count': 1 },
      $push: { 'cards.$[elem].timestamps': origin ? { ts, origin } : ts }
    };

    console.debug('[live] incOrUpsertCard arrayFilters fallback update', { userId, normalized, rarity });
    const incRes = await User.updateOne({ id: userId }, incUpdate, session ? { session, arrayFilters } : { arrayFilters }).exec();

    if (modifiedCountOf(incRes) > 0) {
      const doc = await User.findOne({ id: userId }, { cards: 1 }, session ? { session } : {}).lean();
      const card = findInArray(doc?.cards);
      if (card) return { card, path: 'inc', raw: incRes };
      console.error('[live] incOrUpsertCard fallback reported modified but fetched element mismatch', { userId, normalized, rarity, raw: incRes });
      return { card: null, path: 'inc-mismatch', raw: incRes };
    }
  } catch (err) {
    console.error('[live] incOrUpsertCard arrayFilters fallback error', err);
  }

  // 4) Final: maybe concurrently inserted by other process — fetch and return if present
  try {
    const doc2 = await User.findOne({ id: userId }, { cards: 1 }, session ? { session } : {}).lean();
    const card2 = findInArray(doc2?.cards);
    return card2 ? { card: card2, path: 'fetch' } : null;
  } catch (err) {
    console.error('[live] incOrUpsertCard final-fetch error', err);
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
    if (session) {
      try {
        const uSnap = await User.findOne({ id: userId }, null, { session }).lean();
        console.debug('[live] user card snapshot (session) after failed incOrUpsertCard:', {
          userId,
          cardsCount: (uSnap && Array.isArray(uSnap.cards)) ? uSnap.cards.length : 0,
          sampleCards: (uSnap && uSnap.cards) ? uSnap.cards.slice(0,6) : []
        });
        trace.notes.push('P-insert-miss-session-snapshot');
      } catch (e) {
        console.warn('[live] failed to fetch user snapshot after incOrUpsertCard null', e);
        trace.notes.push('P-insert-miss-snapshot-fail');
      }
    }
    const delta = 5;
    trace.awardedPoints = (trace.awardedPoints || 0) + delta;
    await User.updateOne({ id: userId }, { $inc: { points: delta } }, session ? { session } : {}).exec();
    return null;
  }

  const pElem = pRes.card ? pRes.card : pRes;
  trace.awardedPCard = { name: pElem.name, rarity: pElem.rarity };
  return pElem;
}

// Start attempt: normalize input, decrement card, push pendingAttempt
async function startAttemptAtomic(userId, name, rarity){
  const normalized = normalizeCardName(name);
  const stage = getStageForRarity(rarity);
  if(!stage) return { success:false, reason:'invalid-rarity' };
  const now = Date.now();
  const readyAt = new Date(now + getDurationForStage(stage));
  const attemptId = nanoid();

  const query = {
    id: userId,
    $or: [
      { pendingAttempts: { $exists: false } },
      { pendingAttempts: { $not: { $elemMatch: { stage: stage, resolved: false } } } }
    ]
  };
  const update = {
    $inc: { 'cards.$[elem].count': -1 },
    $push: {
      'cards.$[elem].timestamps': new Date(),
      pendingAttempts: {
        id: attemptId, name: normalized, rarity, stage, startedAt: new Date(), readyAt, resolved:false, success:null, effectsApplied:false, effectsTrace:{}
      }
    }
  };
  const arrayFilters = [{ 'elem.name': normalized, 'elem.rarity': rarity, 'elem.count': { $gt: 0 } }];
  const res = await User.findOneAndUpdate(query, update, { arrayFilters, returnDocument: 'after' }).exec();
  if(!res){
    const u = await User.findOne({ id: userId }).lean();
    if(u){
      const existing = (u.pendingAttempts||[]).find(a=>!a.resolved && Number(a.stage)===Number(stage));
      if(existing) return { success:false, reason:'stage-busy', nextReadyAt: existing.readyAt };
      return { success:false, reason:'no-card' };
    }
    return { success:false, reason:'no-user' };
  }
  const added = (res.pendingAttempts||[]).find(a=>a.id===attemptId);
  if(!added) return { success:false, reason:'no-card' };

  // cleanup zero-count cards best-effort
  User.updateOne({ id: userId }, { $pull: { cards: { count: { $lte: 0 } } } }).exec().catch(()=>{});
  return { success:true, attemptId, readyAt, stage };
}

// Resolve attempt: read inside transaction to avoid race windows. Use arrayFilters for safe updates.
async function resolveAttemptAtomic(userId, attemptId){
  const session = await mongoose.startSession().catch(()=>null);
  const trace = { restoredCard:null, awardedPoints:0, awardedPCard:null, notes:[] };

  // helper to perform the core logic inside a session when available
  if(session){
    try{
      let out = null;
      await session.withTransaction(async ()=>{
        // re-read user inside session
        const userDoc = await User.findOne({ id: userId }).session(session).exec();
        if(!userDoc) throw new Error('no-user');
        const attempt = (userDoc.pendingAttempts || []).find(a => a.id === attemptId);
        if(!attempt) throw new Error('no-attempt');
        if(attempt.resolved) throw new Error('already-resolved');
        const now = Date.now();
        if(new Date(attempt.readyAt).getTime() > now) throw new Error('not-ready|' + attempt.readyAt);

        const normalizedAttemptName = normalizeCardName(attempt.name);
        const successChance = getSuccessChance(attempt.rarity);
        const successResult = Math.random() <= successChance;

        // mark resolved first (target exact element via arrayFilters)
        const mark = await User.updateOne(
          { id: userId, 'pendingAttempts.id': attemptId, 'pendingAttempts.resolved': false },
          { $set: { 'pendingAttempts.$[p].resolved': true, 'pendingAttempts.$[p].success': successResult, 'pendingAttempts.$[p].effectsApplied': false } },
          { arrayFilters: [{ 'p.id': attemptId }], session }
        ).exec();
        if(modifiedCountOf(mark) === 0) throw new Error('already-resolved');

        // restore card
        const restored = await incOrUpsertCard(userId, normalizedAttemptName, attempt.rarity, { session });
        if(restored) trace.restoredCard = { name: restored.name, rarity: restored.rarity };
        else trace.notes.push('restore-missing');

        let awardedPoints = 0;
        let awardedP = null;

        if(successResult){
          if(Number(attempt.stage) === 5){
            const roll = Math.random();
            if(roll <= 0.66){
              const picked = await pickRandomStage5Card();
              if(!picked){
                trace.notes.push('stage5-pick-null');
                awardedPoints += STAGE5_PICK_FALLBACK_POINTS;
                await User.updateOne({ id: userId }, { $inc:{ points: STAGE5_PICK_FALLBACK_POINTS } }, { session }).exec();
              }else{
                const pickedName = normalizeCardName(picked.displayName);
                const pElem = await incOrUpsertCard(userId, pickedName, STAGE5_CARD_RARITY, { session });
                if(pElem) awardedP = pElem;
                else { trace.notes.push('stage5-insert-miss'); awardedPoints += STAGE5_PICK_FALLBACK_POINTS; await User.updateOne({ id: userId }, { $inc:{ points: STAGE5_PICK_FALLBACK_POINTS } }, { session }).exec(); }
              }
            }else{
              awardedPoints += 25;
              await User.updateOne({ id: userId }, { $inc:{ points:25 } }, { session }).exec();
            }
          }else{
            const picked = await pickRandomPCard();
            if(!picked){ trace.notes.push('P-pick-null'); awardedPoints += 5; await User.updateOne({ id: userId }, { $inc:{ points:5 } }, { session }).exec(); }
            else{
              const pickedName = normalizeCardName(picked.displayName);
              const pElem = await incOrUpsertCard(userId, pickedName, 'P', { session });
              if(pElem) awardedP = pElem; else { trace.notes.push('P-insert-miss'); awardedPoints += 5; await User.updateOne({ id: userId }, { $inc:{ points:5 } }, { session }).exec(); }
            }
          }
        }else{
          const cf = getSuccessChance(attempt.rarity);
          const s = Number(attempt.stage);
          if(s === 5) awardedPoints = 1000;
          else if(s === 1) awardedPoints = Math.max(0, Math.round(Number(cf) * 100));
          else if(s === 2 || s === 3) awardedPoints = Math.round(Math.max(0, Math.round(Number(cf) * 100)) * 0.5);
          else if(s === 4) awardedPoints = Math.max(0, Math.round(Number(cf) * 100));
          else awardedPoints = Math.round(Math.max(0, Math.round(Number(cf) * 100)) * 0.5);
          if(awardedPoints > 0) await User.updateOne({ id: userId }, { $inc:{ points: awardedPoints } }, { session }).exec();
        }

        trace.awardedPoints = awardedPoints;
        if(awardedP) trace.awardedPCard = { name: awardedP.name, rarity: awardedP.rarity };

        await User.updateOne(
          { id: userId, 'pendingAttempts.id': attemptId },
          { $set: { 'pendingAttempts.$[p].effectsApplied': true, 'pendingAttempts.$[p].effectsTrace': trace } },
          { arrayFilters: [{ 'p.id': attemptId }], session }
        ).exec();

        out = { success:true, resolved:true, attemptId, successResult, pCard:trace.awardedPCard, awardedPoints: trace.awardedPoints || 0 };
      });
      return out;
    }catch(err){
      const msg = String(err?.message || err);
      if(msg === 'no-user') return { success:false, reason:'no-user' };
      if(msg === 'no-attempt') return { success:false, reason:'no-attempt' };
      if(msg === 'already-resolved') return { success:false, reason:'already-resolved' };
      if(msg.startsWith('not-ready')) return { success:false, reason:'not-ready', readyAt: new Date(msg.split('|')[1]) };
      console.error('[live] resolveAttemptAtomic transaction error', err);
      return { success:false, reason:'internal-error' };
    }finally{
      session.endSession();
    }
  }else{
    // fallback no-session path (idempotent)
    try{
      const snapshot = await User.findOne({ id: userId }).lean();
      if(!snapshot) return { success:false, reason:'no-user' };
      const attempt = (snapshot.pendingAttempts||[]).find(a=>a.id===attemptId);
      if(!attempt) return { success:false, reason:'no-attempt' };
      if(attempt.resolved) return { success:false, reason:'already-resolved' };
      const now = Date.now();
      if(new Date(attempt.readyAt).getTime() > now) return { success:false, reason:'not-ready', readyAt: attempt.readyAt };

      const normalizedAttemptName = normalizeCardName(attempt.name);
      const successChance = getSuccessChance(attempt.rarity);
      const successResult = Math.random() <= successChance;

      const mark = await User.updateOne(
        { id: userId, 'pendingAttempts.id': attemptId, 'pendingAttempts.resolved': false },
        { $set: { 'pendingAttempts.$.resolved': true, 'pendingAttempts.$.success': successResult, 'pendingAttempts.$.effectsApplied': false } }
      ).exec();
      if(modifiedCountOf(mark) === 0) return { success:false, reason:'already-resolved' };

      const restored = await incOrUpsertCard(userId, normalizedAttemptName, attempt.rarity);
      if(restored) trace.restoredCard = { name: restored.name, rarity: restored.rarity };
      else trace.notes.push('restore-missing');

      let awardedPoints = 0;
      let awardedP = null;

      if(successResult){
        if(Number(attempt.stage) === 5){
          const roll = Math.random();
          if(roll <= 0.66){
            const picked = await pickRandomStage5Card();
            if(!picked){
              trace.notes.push('stage5-pick-null');
              awardedPoints += STAGE5_PICK_FALLBACK_POINTS;
              await User.updateOne({ id: userId }, { $inc:{ points: STAGE5_PICK_FALLBACK_POINTS } }).exec();
            }else{
              const pickedName = normalizeCardName(picked.displayName);
              const pElem = await incOrUpsertCard(userId, pickedName, STAGE5_CARD_RARITY);
              if(pElem) awardedP = pElem;
              else { trace.notes.push('stage5-insert-miss'); awardedPoints += STAGE5_PICK_FALLBACK_POINTS; await User.updateOne({ id: userId }, { $inc:{ points: STAGE5_PICK_FALLBACK_POINTS } }).exec(); }
            }
          }else{ awardedPoints += 25; await User.updateOne({ id: userId }, { $inc:{ points:25 } }).exec(); }
        }else{
          const picked = await pickRandomPCard();
          if(!picked){ trace.notes.push('P-pick-null'); awardedPoints += 5; await User.updateOne({ id: userId }, { $inc:{ points:5 } }).exec(); }
          else{
            const pickedName = normalizeCardName(picked.displayName);
            const pElem = await incOrUpsertCard(userId, pickedName, 'P');
            if(pElem) awardedP = pElem; else { trace.notes.push('P-insert-miss'); awardedPoints += 5; await User.updateOne({ id: userId }, { $inc:{ points:5 } }).exec(); }
          }
        }
      }else{
        const cf = getSuccessChance(attempt.rarity);
        const s = Number(attempt.stage);
        if(s === 5) awardedPoints = 1000;
        else if(s === 1) awardedPoints = Math.max(0, Math.round(Number(cf) * 100));
        else if(s === 2 || s === 3) awardedPoints = Math.round(Math.max(0, Math.round(Number(cf) * 100)) * 0.5);
        else if(s === 4) awardedPoints = Math.max(0, Math.round(Number(cf) * 100));
        else awardedPoints = Math.round(Math.max(0, Math.round(Number(cf) * 100)) * 0.5);
        if(awardedPoints > 0) await User.updateOne({ id: userId }, { $inc:{ points: awardedPoints } }).exec();
      }

      trace.awardedPoints = awardedPoints;
      if(awardedP) trace.awardedPCard = { name: awardedP.name, rarity: awardedP.rarity };

      await User.updateOne(
        { id: userId, 'pendingAttempts.id': attemptId },
        { $set: { 'pendingAttempts.$.effectsApplied': true, 'pendingAttempts.$.effectsTrace': trace } }
      ).exec();

      return { success:true, resolved:true, attemptId, successResult, pCard:trace.awardedPCard, awardedPoints: trace.awardedPoints || 0 };
    }catch(err){
      console.error('[live] resolveAttemptAtomic error (no-session)', err);
      return { success:false, reason:'internal-error' };
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
