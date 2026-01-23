// jobs/bossManager.js
// Centralized boss manager implementing scheduled spawns, announcements, actions, and settlement.
const { nanoid } = require('nanoid');
let seedrandom;
try { seedrandom = require('seedrandom'); } catch (e) { seedrandom = (s) => () => Math.random(); }
const crypto = require('crypto');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');

const BossEvent = require('../models/BossEvent');
const BossPointLog = require('../models/BossPointLog');
const User = require('../models/User');
const oshis = require('../config/oshis');
const config = require('../config.json');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { addOshiOsrToUser } = require('../utils/oshiRewards');
const Oshi = require('../models/Oshi');
const { postBossResults } = require('../utils/postBossResults');
const ASSETS_BASE = path.join(__dirname, '..', 'assets', 'images'); // adjust if needed

// Tunables
const SUPERCHAT_BASE = Number(process.env.BOSS_SUPERCHAT_BASE || 100);
const SUPERCHAT_ESCALATION = Number(process.env.BOSS_SUPERCHAT_ESCALATION || 1.0);
const LIKE_RATE_LIMIT_MS = Number(process.env.BOSS_LIKE_RATE_LIMIT_MS || 5000);
const IMAGE_BASE = process.env.BOSS_IMAGE_BASE || 'http://152.69.195.48/images';
const CONFIRM_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
// Debug duration support
const DEBUG_DURATION_MS = process.env.BOSS_DEBUG_DURATION_MS
  ? Number(process.env.BOSS_DEBUG_DURATION_MS)
  : (process.env.BOSS_DEBUG ? 60 * 1000 : null);

function eventDurationMs() {
  return DEBUG_DURATION_MS || 24 * 60 * 60 * 1000;
}

// In-memory rate limit map (replace with Redis for multi-process)
const lastLikeAt = new Map();

// -------------------- Rarity / Participation config --------------------
// Canonical rarity order provided by user
const RARITY_ORDER = [
  'C', 'U', 'R', 'S', 'RR', 'OC', 'SR', 'OSR', 'P', 'SP', 'SY', 'UR', 'OUR', 'HR', 'BDAY', 'UP', 'SEC'
];

// Exclude these rarities from settlement selection
const RARITY_EXCLUDE = new Set(['P', 'SP', 'UP']);

// Optional per-rarity asset base overrides. Keys are rarity strings.
// Values may be absolute paths or paths relative to project root.
// You can also set these via environment variables for deployment flexibility.
const ASSETS_BASE_BY_RARITY = {
  // Example: use a dedicated folder for birthday cards
  BDAY: process.env.BDAY_ASSETS_BASE || path.join(__dirname, '..', 'assets', 'montlybdays')
};

// Helper to resolve the asset base for a given rarity
function getAssetsBaseForRarity(rarity) {
  if (!rarity) return ASSETS_BASE;
  const key = String(rarity).trim().toUpperCase();
  if (ASSETS_BASE_BY_RARITY[key]) return ASSETS_BASE_BY_RARITY[key];
  // default fallback
  return ASSETS_BASE;
}


// Default participation weights
const PARTICIPATION_WEIGHTS = {
  C: 35,
  U: 25,
  R: 15,
  S: 10,
  RR: 5,
  OC: 5,
  SR: 2.5,
  OSR: 2.5,
  SY: 0,
  UR: 0,
  OUR: 0,
  HR: 0,
  BDAY: 0,
  SEC: 0.0
};
const PARTICIPATION_WEIGHTS1 = {

  C:   0,
  U:   0,
  R:   1,
  S:   1,
  RR:  0,
  OC:  0,
  SR:  0,
  OSR: 0,
  SY:  0,
  UR:  0,
  OUR: 0,
  HR:  0,
  BDAY:0,
  SEC: 0

};

const THIRDPLACE_WEIGHTS = {
  C: 0,
  U: 0,
  R: 0,
  S: 0,
  RR: 0,
  OC: 0,
  SR:  35,
  OSR: 25,
  SY:  15,
  UR:  10,
  OUR: 5,
  HR:  5,
  BDAY:4,
  SEC: 1
};

const SECONDPLACE_WEIGHTS = {
  C: 0,
  U: 0,
  R: 0,
  S: 0,
  RR: 0,
  OC: 0,
  SR:  20,
  OSR: 15,
  SY:  15,
  UR:  15,
  OUR: 11,
  HR:  11,
  BDAY:800,
  SEC: 5
};

/**
 * EXCEPTIONS map:
 * - keys are normalized primary labels (lowercase)
 * - values are arrays of alternative names or prefixes to allow when searching
 *
 * Example:
 *   // when searching for "chloe" also allow files that contain "Ruka"
 *   'chloe': ['Ruka'],
 *
 * Prefix entries: add a trailing '*' to indicate prefix matching (case-insensitive)
 *   'chloe': ['Ruka*']  // matches "Ruka 001", "Rukami", etc.
 *
 * When a rarity folder contains no files that match the primary oshi token,
 * the picker will try these exception tokens (chosen uniformly at random).
 */
const EXCEPTIONS = {
  Rushia: ['Pekora', 'Marine', 'Flare', 'Noel', 'Fantasy'],
  Mel: ['Fubuki', 'Matsuri', 'Haato', 'Aki', 'Gen 1'],
  Aqua: ['Ayame', 'Choco', 'Subaru', 'Shion', 'Gen 2'],
  Shion: ['Ayame', 'Choco', 'Subaru', 'Aqua', 'Gen 2'],
  Coco: ['Watame', 'Towa', 'Kanata', 'Luna', 'holoForce'],
  Kanata: ['Watame', 'Towa', 'Luna', 'Coco', 'holoForce'],
  Aloe: ['Lamy', 'Nene', 'Botan', 'Polka', 'NePoLaBo'],
  Amelia: ['Calli', 'Kiara', 'Ina', 'Gura', 'Myth'],
  Gura: ['Calli', 'Kiara', 'Ina', 'Amelia', 'Myth'],
  Sana: ['Kronii', 'Baelz', 'Fauna', 'Mumei'],
  Mumei: ['Kronii', 'Baelz', 'IRyS', 'Fauna', 'Promise'],
  Fauna: ['IRyS', 'Kronii', 'Baelz', 'Mumei', 'Promise'],
  Ao: ['Kanade', 'Ririka', 'Raden', 'Hajime', 'ReGLOSS'],
  achan: ['Kanade', 'Ririka', 'Raden', 'Hajime', 'ReGLOSS'],
};

// pickWeighted (same algorithm as your pulls)
function pickWeighted(options) {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of options) {
    if (r <= o.weight) return o.key;
    r -= o.weight;
  }
  return options[options.length - 1].key;
}

// Build options array from a weight map, respecting RARITY_EXCLUDE
function buildWeightedOptionsFromMap(weightMap) {
  return Object.entries(weightMap)
    .map(([key, w]) => ({ key, weight: Number(w) || 0 }))
    .filter(o => o.weight > 0 && !RARITY_EXCLUDE.has(o.key));
}

// -------------------- User card helper (transactional, robust) --------------------
/**
 * Add a card to a user's inventory. If the user already has a card with the same
 * name and rarity, increment its count and update lastAcquiredAt. Otherwise push a new card entry.
 * Uses a MongoDB transaction to avoid duplicate array entries under concurrency.
 *
 * Requires MongoDB deployment that supports transactions (replica set).
 */
async function addCardToUser(userId, cardName, rarity, count = 1) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    // Load user doc with the cards array inside the transaction
    let user = await User.findOne({ id: userId }).session(session).exec();

    if (!user) {
      // create user with the card
      const newCard = {
        name: cardName,
        rarity,
        count,
        firstAcquiredAt: new Date(),
        lastAcquiredAt: new Date()
      };
      await User.updateOne({ id: userId }, { $push: { cards: newCard } }, { upsert: true, session });
      await session.commitTransaction();
      return;
    }

    // Try to find an existing card entry
    const idx = (user.cards || []).findIndex(c => c.name === cardName && c.rarity === rarity);

    if (idx !== -1) {
      // increment existing entry
      const update = {};
      update[`cards.${idx}.count`] = (user.cards[idx].count || 0) + count;
      update[`cards.${idx}.lastAcquiredAt`] = new Date();
      await User.updateOne({ id: userId }, { $set: update }, { session });
    } else {
      // push new card
      const newCard = {
        name: cardName,
        rarity,
        count,
        firstAcquiredAt: new Date(),
        lastAcquiredAt: new Date()
      };
      await User.updateOne({ id: userId }, { $push: { cards: newCard } }, { upsert: true, session });
    }

    await session.commitTransaction();
  } catch (err) {
    try { await session.abortTransaction(); } catch (e) { /* ignore */ }
    throw err;
  } finally {
    session.endSession();
  }
}

// -------------------- Helpers --------------------
function nextDateForWeekday(weekday, hour) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, 0, 0, 0);
  const delta = (weekday - target.getDay() + 7) % 7;
  if (delta === 0 && target <= now) target.setDate(target.getDate() + 7);
  else target.setDate(target.getDate() + delta);
  return target;
}
function pickRandomFrom(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }
function superchatCost(n) { return Math.ceil(SUPERCHAT_BASE * (1 + SUPERCHAT_ESCALATION * (n - 1))); }

function buildOshiOsrImageUrl(oshiLabel, rarity = 'OSR') {
  const baseName = typeof oshiLabel === 'string' ? oshiLabel.trim() : String(oshiLabel);
  const cardName = `${baseName} 001`;
  const encodedCardName = encodeURIComponent(cardName);
  const rarityPart = encodeURIComponent(String(rarity).trim());
  return `${IMAGE_BASE.replace(/\/$/, '')}/${rarityPart}/${encodedCardName}.png`;
}

function renderHappinessBar(value) {
  const max = 100;
  const filled = Math.round((Math.max(0, Math.min(value, max)) / max) * 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return `${bar} ${value} happiness`;
}

// near top-level config in bossManager.js
const OSHI_DESCRIPTIONS = {
  Rushia: 'Konrushi!',
  Mumei: '**{oshi}** stream marathon: support Mumei and earn special cards!',
  Lamy: 'I love Yoi',
  __default: 'Support **{oshi}** with all you got for special rewards!'
};

// helper to format a template with simple placeholders
function formatTemplate(tpl, vars = {}) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

// replacement build function
function buildBossEmbedAndButtons(ev, oshiLabel) {
  // choose template by label (fall back to default)
  const tpl = OSHI_DESCRIPTIONS[oshiLabel] ?? OSHI_DESCRIPTIONS.__default;

  // compute dynamic values you want available in templates
  const durationSeconds = Math.round((ev.endsAt.getTime() - ev.spawnAt.getTime()) / 1000);
  const vars = {
    oshi: oshiLabel,
    duration: `${durationSeconds}s`,
    endsAtRelative: `<t:${Math.floor(ev.endsAt.getTime() / 1000)}:R>`
  };

  const description = formatTemplate(tpl, vars);

  const embed = new EmbedBuilder()
    .setTitle(`${oshiLabel} has started a 24 hour stream!`)
    .setDescription(description)
    .setColor(0x5AB3F4)
    .setImage(ev.imageUrl || buildOshiOsrImageUrl(oshiLabel, 'ORI'))
    .addFields(
      { name: 'Ends', value: vars.endsAtRelative, inline: true },
      { name: 'Happiness', value: renderHappinessBar(typeof ev.happiness === 'number' ? ev.happiness : 0), inline: true },
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`boss|${ev.eventId}|like`).setLabel('Like').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`boss|${ev.eventId}|sub`).setLabel('Sub').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`boss|${ev.eventId}|superchat`).setLabel('Superchat').setStyle(ButtonStyle.Danger)
  );

  return { embed, components: [row] };
}


// -------------------- Activator --------------------
async function activateAndEndEvents() {
  const now = new Date();
  await BossEvent.updateMany(
    { status: 'scheduled', spawnAt: { $lte: now }, endsAt: { $gt: now } },
    { $set: { status: 'active' } }
  );
  await BossEvent.updateMany(
    { status: 'active', endsAt: { $lte: now } },
    { $set: { status: 'ended' } }
  );
}

// -------------------- Announcer --------------------
async function announceActivatedEvents(client) {
  const now = new Date();
  const toActivate = await BossEvent.find({ status: 'scheduled', spawnAt: { $lte: now }, endsAt: { $gt: now } });
  if (!toActivate.length) return;

  for (const ev of toActivate) {
    const oshiCfg = oshis.find(o => o.id === ev.oshiId);
    const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;
    const imageUrl = buildOshiOsrImageUrl(oshiLabel, 'ORI');

    ev.status = 'active';
    ev.imageUrl = imageUrl;
    ev.happiness = ev.happiness || 0;
    await ev.save();

    const { embed, components } = buildBossEmbedAndButtons(ev, oshiLabel);

    try {
      const channelId = config.bossChannelId;
      if (!channelId) {
        console.warn('bossChannelId not set in config.json; skipping announcement for', ev.eventId);
        continue;
      }
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch || !ch.isTextBased?.()) {
        console.warn('Configured boss channel is not text-based or could not be fetched:', channelId);
        continue;
      }
      const msg = await ch.send({ embeds: [embed], components: components || [] });
      ev.announceMessageId = msg.id;
      await ev.save();
      console.log(`[announce] event ${ev.eventId} announced as message ${msg.id}`);
    } catch (err) {
      console.error('announceActivatedEvents send error', err);
    }
  }
}

// -------------------- Refresh helper --------------------
async function refreshEventMessage(client, eventId, evOverride = null) {
  try {
    const ev = evOverride || await BossEvent.findOne({ eventId }).lean();
    if (!ev) {
      console.warn(`[refresh] no event found for ${eventId}`);
      return false;
    }
    if (!ev.announceMessageId) {
      console.warn(`[refresh] event ${eventId} has no announceMessageId`);
      return false;
    }

    const oshiCfg = oshis.find(o => o.id === ev.oshiId);
    const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;
    const { embed, components } = buildBossEmbedAndButtons(ev, oshiLabel);

    const ch = await client.channels.fetch(config.bossChannelId).catch(err => {
      console.error(`[refresh] failed to fetch channel ${config.bossChannelId}`, err);
      return null;
    });
    if (!ch || !ch.isTextBased?.()) {
      console.warn(`[refresh] invalid channel ${config.bossChannelId}`);
      return false;
    }

    const msg = await ch.messages.fetch(ev.announceMessageId).catch(err => {
      console.error(`[refresh] failed to fetch message ${ev.announceMessageId}`, err);
      return null;
    });
    if (!msg) {
      console.warn(`[refresh] announcement message ${ev.announceMessageId} not found`);
      return false;
    }

    try {
      await msg.edit({ embeds: [embed], components: components || [] });
      console.log(`[refresh] updated announcement ${ev.announceMessageId} for event ${eventId} (happiness=${ev.happiness})`);
      return true;
    } catch (err) {
      console.error(`[refresh] failed to edit message ${ev.announceMessageId}`, err);
      return false;
    }
  } catch (err) {
    console.error('[refresh] unexpected error', err);
    return false;
  }
}

// -------------------- Core: award points + happiness --------------------
async function _upsertUserPointsAndHappiness(eventId, userId, pointsDelta, happinessDelta, session = null, superchatIncrement = 0) {
  // Try to increment an existing pointsByUser entry and return the updated event doc
  const incUpdate = { $inc: {} };
  if (typeof pointsDelta === 'number' && pointsDelta !== 0) incUpdate.$inc['pointsTotal'] = pointsDelta;
  if (typeof happinessDelta === 'number' && happinessDelta !== 0) incUpdate.$inc['happiness'] = happinessDelta;
  if (typeof pointsDelta === 'number' && pointsDelta !== 0) incUpdate.$inc['pointsByUser.$.points'] = pointsDelta;
  if (superchatIncrement) incUpdate.$inc['pointsByUser.$.superchatCount'] = superchatIncrement;

  // Attempt to update an existing pointsByUser entry
  const updatedIfExists = await BossEvent.findOneAndUpdate(
    { eventId, 'pointsByUser.userId': userId },
    incUpdate,
    { session, new: true }
  ).lean();

  if (updatedIfExists) return updatedIfExists;

  // No existing entry: push a new pointsByUser entry and increment totals
  const pushUpdate = {
    $push: { pointsByUser: { userId, points: pointsDelta || 0, superchatCount: superchatIncrement || 0, firstPointAt: new Date() } },
    $inc: {}
  };
  if (typeof pointsDelta === 'number' && pointsDelta !== 0) pushUpdate.$inc.pointsTotal = pointsDelta;
  if (typeof happinessDelta === 'number' && happinessDelta !== 0) pushUpdate.$inc.happiness = happinessDelta;

  const newDoc = await BossEvent.findOneAndUpdate(
    { eventId },
    pushUpdate,
    { session, new: true }
  ).lean();

  return newDoc;
}

// -------------------- Card consumption helpers --------------------
async function consumeCard(userId, allowedRarities = ['OSR','SR'], session = null) {
  const user = await User.findOne({ id: userId }).session(session);
  if (!user || !Array.isArray(user.cards)) return false;
  const idx = user.cards.findIndex(c => allowedRarities.includes(c.rarity) && (c.count || 0) > 0);
  if (idx === -1) return false;
  const card = user.cards[idx];
  if ((card.count || 0) > 1) {
    const update = {};
    update[`cards.${idx}.count`] = (card.count || 0) - 1;
    await User.updateOne({ id: userId }, { $set: update }).session(session);
  } else {
    await User.updateOne({ id: userId }, { $pull: { cards: { name: card.name, rarity: card.rarity } } }).session(session);
  }
  return true;
}

async function consumeCardByName(userId, cardName, cardRarity = null, session = null) {
  const user = await User.findOne({ id: userId }).session(session);
  if (!user || !Array.isArray(user.cards)) return false;

  const idx = user.cards.findIndex(c => {
    if (cardRarity) {
      return c.name === cardName && c.rarity === cardRarity && (c.count || 0) > 0;
    }
    return c.name === cardName && (c.count || 0) > 0;
  });

  if (idx === -1) return false;

  const card = user.cards[idx];
  if ((card.count || 0) > 1) {
    const update = {};
    update[`cards.${idx}.count`] = (card.count || 0) - 1;
    await User.updateOne({ id: userId }, { $set: update }).session(session);
  } else {
    await User.updateOne({ id: userId }, { $pull: { cards: { name: card.name, rarity: card.rarity } } }).session(session);
  }
  return true;
}

// -------------------- Find active event --------------------
async function findActiveEventForOshi(oshiId) {
  const now = new Date();
  return BossEvent.findOne({ oshiId, spawnAt: { $lte: now }, endsAt: { $gt: now }, status: 'active' });
}

// -------------------- Action handlers --------------------
// LIKE: only once per user per event. Like adds points = oshiLevel and happiness = min(oshiLevel, 100).
// If the user has chosen this oshi as their member/oshi, they get an extra member bonus.
async function handleLike({ userId, oshiId, client = null }) {
  const ev = await findActiveEventForOshi(oshiId);
  if (!ev) throw new Error('No active 24h stream for this oshi');

  // Rate limit
  const now = Date.now();
  const last = lastLikeAt.get(userId) || 0;
  if (now - last < LIKE_RATE_LIMIT_MS) throw new Error('Rate limited');
  lastLikeAt.set(userId, now);

  // Prevent duplicate like per user per event
  const existingLike = await BossPointLog.findOne({ eventId: ev.eventId, userId, action: 'like' }).lean();
  if (existingLike) throw new Error('You have already liked this 24h stream (one like per person).');

  // Pull oshi data from Oshi collection
  // Always fetch the user's chosen oshi record
  const oshiDoc = await Oshi.findOne({ userId }).lean();
  const oshiLevel = oshiDoc ? oshiDoc.level : 1;

  // Member bonus only if boss oshi matches user's chosen oshi
  const isMemberOfOshi = oshiDoc && String(oshiDoc.oshiId) === String(oshiId);

  // Cap oshi level contribution to 100 for happiness
  const cappedLevel = Math.max(0, Math.min(100, Math.floor(oshiLevel || 1)));
  let basePoints = cappedLevel;
  let baseHappiness = cappedLevel;

  // Member bonus values (tunable)
  const MEMBER_BONUS_POINTS = 50;
  const MEMBER_BONUS_HAPPINESS = 50;

  // Apply member bonus if applicable
  const memberBonusPoints = isMemberOfOshi ? MEMBER_BONUS_POINTS : 0;
  const memberBonusHappiness = isMemberOfOshi ? MEMBER_BONUS_HAPPINESS : 0;

  const totalPoints = basePoints + memberBonusPoints;
  const totalHappiness = baseHappiness + memberBonusHappiness;

  // Update event points and per-user points/happiness
  const updatedEv = await _upsertUserPointsAndHappiness(ev.eventId, userId, totalPoints, totalHappiness);

  // Log the like action including whether member bonus applied
  await BossPointLog.create({
    eventId: ev.eventId,
    userId,
    oshiId,
    action: 'like',
    points: totalPoints,
    meta: {
      oshiLevel: cappedLevel,
      memberBonus: isMemberOfOshi ? { points: memberBonusPoints, happiness: memberBonusHappiness } : undefined
    }
  });

  // Refresh announcement embed
  if (client) {
    const ok = await refreshEventMessage(client, ev.eventId, updatedEv);
    if (!ok) console.warn(`[handleLike] refreshEventMessage returned false for ${ev.eventId}`);
  }

  // Return a friendly message you can send to the user
  const memberMsg = isMemberOfOshi ? `You are a member of **${oshiId}** +${MEMBER_BONUS_POINTS}` : null;
  return { points: totalPoints, happinessDelta: totalHappiness, memberMsg };
}


// SUB: consumes OSR/SR card, adds points=5, happiness=5
async function handleSub({ userId, oshiId, client = null }) {
  const ev = await findActiveEventForOshi(oshiId);
  if (!ev) throw new Error('No active 24h stream for this oshi');

  const session = await mongoose.startSession();
  let committed = false;
  try {
    session.startTransaction();

    const consumed = await consumeCard(userId, ['OSR','SR'], session);
    if (!consumed) {
      throw new Error('You need an OSR or SR card to subscribe.');
    }

    const points = 5;
    const happinessDelta = 5;

    await _upsertUserPointsAndHappiness(ev.eventId, userId, points, happinessDelta, session);
    await BossPointLog.create([{ eventId: ev.eventId, userId, oshiId, action: 'sub', points, meta: { consumedCard: true } }], { session });

    await session.commitTransaction();
    committed = true;

    const updatedEv = await BossEvent.findOne({ eventId: ev.eventId }).lean();
    if (client) {
      const ok = await refreshEventMessage(client, ev.eventId, updatedEv);
      if (!ok) console.warn(`[handleSub] refreshEventMessage returned false for ${ev.eventId}`);
    }

    return { points, happinessDelta };
  } catch (err) {
    try { if (!committed) await session.abortTransaction(); } catch (abortErr) { /* ignore */ }
    throw err;
  } finally {
    session.endSession();
  }
}

async function handleSubWithCard({ userId, oshiId, cardName, cardRarity = null, client = null }) {
  const ev = await findActiveEventForOshi(oshiId);
  if (!ev) throw new Error('No active 24h stream for this oshi');

  const session = await mongoose.startSession();
  let committed = false;
  try {
    session.startTransaction();

    const consumed = await consumeCardByName(userId, cardName, cardRarity, session);
    if (!consumed) {
      throw new Error('Selected card not found in your inventory or already used.');
    }

    const points = 5;
    const happinessDelta = 5;

    await _upsertUserPointsAndHappiness(ev.eventId, userId, points, happinessDelta, session);
    await BossPointLog.create([{ eventId: ev.eventId, userId, oshiId, action: 'sub', points, meta: { consumedCard: { name: cardName, rarity: cardRarity } } }], { session });

    await session.commitTransaction();
    committed = true;

    const updatedEv = await BossEvent.findOne({ eventId: ev.eventId }).lean();
    if (client) {
      const ok = await refreshEventMessage(client, ev.eventId, updatedEv);
      if (!ok) console.warn(`[handleSubWithCard] refreshEventMessage returned false for ${ev.eventId}`);
    }

    return { points, happinessDelta };
  } catch (err) {
    try { if (!committed) await session.abortTransaction(); } catch (abortErr) { /* ignore */ }
    throw err;
  } finally {
    session.endSession();
  }
}

// MEMBER: only if user's chosen oshi matches; adds points=50, happiness=50
async function handleMember({ userId, oshiId, client = null }) {
  const ev = await findActiveEventForOshi(oshiId);
  if (!ev) throw new Error('No active 24h stream for this oshi');

  const userDoc = await User.findOne({ id: userId }).lean();
  if (!userDoc) throw new Error('User not found');
  if (userDoc.chosenOshi !== oshiId) throw new Error('Member bonus only applies if this is your chosen oshi');

  const points = 50;
  const happinessDelta = 50;

  const updatedEv = await _upsertUserPointsAndHappiness(ev.eventId, userId, points, happinessDelta);
  await BossPointLog.create({ eventId: ev.eventId, userId, oshiId, action: 'member', points, meta: {} });

  if (client) {
    const ok = await refreshEventMessage(client, ev.eventId, updatedEv);
    if (!ok) console.warn(`[handleMember] refreshEventMessage returned false for ${ev.eventId}`);
  }
  return { points, happinessDelta };
}
async function createSuperchatConfirm(interaction, eventId) {
  try {
    const ev = await BossEvent.findOne({ eventId }).lean();
    if (!ev) {
      await interaction.reply({ content: 'This 24h stream is no longer active.', ephemeral: true });
      return;
    }

    const userId = interaction.user.id;
    const userState = (ev.pointsByUser || []).find(p => p.userId === userId);
    const currentCount = userState ? (userState.superchatCount || 0) : 0;
    const nextN = currentCount + 1;

    // current cost is the minimum for this next superchat
    const currentCost = superchatCost(nextN);
    const nextCost = superchatCost(nextN + 1);

    const oshiCfg = oshis.find(o => o.id === ev.oshiId);
    const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

    const embed = new EmbedBuilder()
      .setTitle(`Confirm Superchat for ${oshiLabel}`)
      .setDescription(`This superchat will cause **${currentCost}** fans to empty their wallets.\nIf you confirm, the next superchat will be **${nextCost}** fans wallets.`)
      .setColor(0xFF4500)
      .setTimestamp(new Date());

    const confirmId = `boss|${eventId}|superchat|confirm|${userId}`;
    const cancelId = `boss|${eventId}|superchat|cancel|${userId}`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel(`Confirm (${currentCost})`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

    // auto-disable after timeout (best-effort)
    setTimeout(async () => {
      try {
        const replyMsg = await interaction.fetchReply().catch(() => null);
        if (!replyMsg) return;
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(confirmId).setLabel(`Confirm (${currentCost})`).setStyle(ButtonStyle.Danger).setDisabled(true),
          new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary).setDisabled(true)
        );
        await replyMsg.edit({ components: [disabledRow] }).catch(() => null);
      } catch (e) { /* ignore */ }
    }, CONFIRM_TIMEOUT_MS);
  } catch (err) {
    console.error('[createSuperchatConfirm] error', err);
    try { await interaction.reply({ content: 'Failed to open superchat confirm prompt.', ephemeral: true }); } catch (e) { /* ignore */ }
  }
}
async function handleSuperchatInteraction(interaction) {
  try {
    if (!interaction.isButton?.()) return false;
    const parts = interaction.customId.split('|'); // boss|<eventId>|superchat|confirm|<userId>
    if (parts[0] !== 'boss' || parts[2] !== 'superchat') return false;

    const eventId = parts[1];
    const action = parts[3];
    const intendedUserId = parts[4];

    if (interaction.user.id !== intendedUserId) {
      await interaction.reply({ content: 'You are not authorized to confirm this superchat.', ephemeral: true });
      return true;
    }

    if (action === 'cancel') {
      await interaction.update({ content: 'Superchat cancelled.', embeds: [], components: [] }).catch(() => null);
      return true;
    }

    if (action === 'confirm') {
      const userId = interaction.user.id;
      const ev = await BossEvent.findOne({ eventId }).lean();
      if (!ev) {
        await interaction.update({ content: 'Event no longer available.', embeds: [], components: [] }).catch(() => null);
        return true;
      }

      // Recompute currentCount and currentCost at confirmation time to avoid race
      const userState = (ev.pointsByUser || []).find(p => p.userId === userId);
      const currentCount = userState ? (userState.superchatCount || 0) : 0;
      const nextN = currentCount + 1;
      const currentCost = superchatCost(nextN); // this is what we charge now
      const nextCost = superchatCost(nextN + 1);

      try {
        // call handleSuperchat but force spendFans to currentCost
        const result = await handleSuperchat({ userId, oshiId: ev.oshiId, spendFans: currentCost, client: interaction.client });

        // success message
        const successText = `Superchat sent: **${result.spendFans}** fans had their wallets emptied.\nHappiness awarded: **${result.happinessDelta}**.\nNext cost: **${result.nextSuperchatMin}**.`;
        await interaction.update({ content: successText, embeds: [], components: [] }).catch(() => null);
      } catch (err) {
        console.warn('[handleSuperchatInteraction] confirm failed', err);
        const errMsg = (err && err.message) ? `Superchat failed: ${err.message}` : 'Superchat failed.';
        await interaction.update({ content: errMsg, embeds: [], components: [] }).catch(() => null);
      }
      return true;
    }

    return false;
  } catch (err) {
    console.error('[handleSuperchatInteraction] unexpected error', err);
    try { await interaction.reply({ content: 'An error occurred handling the superchat interaction.', ephemeral: true }); } catch (e) { /* ignore */ }
    return true;
  }
}


// SUPERCHAT: uses fans; points = spendFans; happiness = floor(spendFans/2); escalating cost per user per event
// SUPERCHAT: charges the current minimum (escalating per-user per-event).
// points = spendFans; happiness = floor(spendFans / 2); increments superchatCount atomically.
async function handleSuperchat({ userId, oshiId, spendFans, client = null }) {
  // Normalize input
  spendFans = typeof spendFans === 'number' && !Number.isNaN(spendFans) ? Math.floor(spendFans) : undefined;

  // Find active event
  const ev = await findActiveEventForOshi(oshiId);
  if (!ev) throw new Error('No active 24h stream for this oshi');

  // Load user
  const userDoc = await User.findOne({ id: userId }).lean();
  if (!userDoc) throw new Error('User not found');

  // Determine current superchat count for this user in the event
  const userState = (ev.pointsByUser || []).find(p => p.userId === userId);
  const currentCount = userState ? (userState.superchatCount || 0) : 0;
  const nextN = currentCount + 1;

  // If caller didn't provide spendFans, default to the current minimum
  const minCost = superchatCost(nextN);
  if (typeof spendFans !== 'number' || Number.isNaN(spendFans)) {
    spendFans = minCost;
  }

  // Validate against minimum and balance
  if (spendFans < minCost) throw new Error(`Minimum fans required for this superchat is ${minCost}`);
  if ((userDoc.points || 0) < spendFans) throw new Error('Insufficient fans');

  // Compute awards
  const points = spendFans;
  const happinessDelta = Math.floor(spendFans / 100);

  // Transaction: debit user, update event/user totals (including superchatCount), log
  const session = await mongoose.startSession();
  let committed = false;
  try {
    session.startTransaction();

    // Debit user fans atomically (ensure sufficient balance)
    const userUpdate = await User.updateOne(
      { id: userId, points: { $gte: spendFans } },
      { $inc: { points: -spendFans } },
      { session }
    );
    if (userUpdate.matchedCount === 0) throw new Error('Insufficient fans or user not found during debit');

    // Upsert points/happiness and increment superchatCount atomically via helper
    // _upsertUserPointsAndHappiness accepts session and superchatIncrement
    const updatedEv = await _upsertUserPointsAndHappiness(ev.eventId, userId, points, happinessDelta, session, 1);
    if (!updatedEv) throw new Error('Failed to update event points');

    // Increment event-level totals if you track them separately (optional)
    await BossEvent.updateOne(
      { eventId: ev.eventId },
      { $inc: { totalPoints: points } },
      { session }
    );

    // Log the superchat with useful meta for auditing and potential reversals
    await BossPointLog.create([{
      eventId: ev.eventId,
      userId,
      oshiId,
      action: 'superchat',
      points,
      meta: {
        spendFans,
        superchatCountBefore: currentCount,
        superchatCountAfter: currentCount + 1,
        prevBalance: userDoc.points,
        newBalance: (userDoc.points || 0) - spendFans,
        awardedAt: new Date()
      }
    }], { session });

    await session.commitTransaction();
    committed = true;

    // Refresh announcement embed with the latest event doc
    const freshEv = await BossEvent.findOne({ eventId: ev.eventId }).lean();
    if (client) {
      try {
        const ok = await refreshEventMessage(client, ev.eventId, freshEv);
        if (!ok) console.warn(`[handleSuperchat] refreshEventMessage returned false for ${ev.eventId}`);
      } catch (err) {
        console.warn('[handleSuperchat] refreshEventMessage failed', err);
      }
    }

    // Return structured result
    return {
      points,
      spendFans,
      happinessDelta,
      superchatCount: currentCount + 1,
      nextSuperchatMin: superchatCost(nextN + 1)
    };
  } catch (err) {
    try { if (!committed) await session.abortTransaction(); } catch (abortErr) { /* ignore */ }
    throw err;
  } finally {
    session.endSession();
  }
}


// -------------------- Settlement helpers --------------------
// Improved filename normalization and matching to ensure awarded cards match the boss oshi
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeFilenameForMatch(filename) {
  // remove extension, underscores/hyphens -> spaces, collapse spaces, remove punctuation,
  // remove trailing numeric codes like 001/501, trim and lowercase
  return filename
    .replace(/\.(png|jpg|jpeg)$/i, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\b0*(\d{1,3})\b/g, '') // remove standalone numeric codes
    .trim()
    .toLowerCase();
}

// In-memory short-term anti-repeat map
const lastPickedByRarity = new Map();

// Replace your existing pickCardFromRarityFolder + getNextLowerWeightRarity with this version.
// Key changes:
// - If there are NO specific matches (exact / exceptions / partial) we immediately try to
//   fall back to the next lower-weight rarity BEFORE ever falling back to "all candidates".
// - getNextLowerWeightRarity walks RARITY_ORDER leftwards (toward more-common rarities)
//   and returns the first eligible rarity (positive weight in SECONDPLACE_WEIGHTS or PARTICIPATION_WEIGHTS
//   and not in RARITY_EXCLUDE). It also accepts a visitedSet to avoid loops.
async function pickCardFromRarityFolder(rarity, oshiLabel, { avoidImmediateRepeat = true, _visited = null } = {}) {
  try {
    // visited set to avoid infinite fallback loops
    const visited = _visited instanceof Set ? _visited : new Set();
    if (visited.has(rarity)) return null;
    visited.add(rarity);

    const baseForRarity = getAssetsBaseForRarity(rarity);
    const folder = path.join(baseForRarity, String(rarity).toUpperCase());
    const files = await fs.readdir(folder).catch(() => []);
    if (!files || files.length === 0) {
      console.debug(`[pickCard] no files in folder ${folder}`);
      const fallback = getNextLowerWeightRarity(rarity, visited);
      if (fallback) {
        console.debug(`[pickCard] rarity=${rarity} empty, falling back to ${fallback}`);
        return pickCardFromRarityFolder(fallback, oshiLabel, { avoidImmediateRepeat, _visited: visited });
      }
      return null;
    }

    // Normalize target token
    const target = (oshiLabel || '').toLowerCase().replace(/[^\w\s]/g, '').trim();

    // Build list of candidates with normalized names
    const candidates = files.map(f => ({ raw: f, norm: normalizeFilenameForMatch(f) }));

    // exact token matches first (word boundary)
    const exactMatches = target ? candidates.filter(f => new RegExp(`\\b${escapeRegExp(target)}\\b`).test(f.norm)) : [];

    // partial matches (substring)
    const partialMatches = target ? candidates.filter(f => f.norm.includes(target)) : [];

    let pool = null;
    let foundAnySpecificMatch = false; // track whether any exact/exception/partial matched

    // Prefer exact matches
    if (exactMatches.length) {
      pool = exactMatches;
      foundAnySpecificMatch = true;
      console.debug(`[pickCard] rarity=${rarity} oshi=${oshiLabel} exactMatches=${exactMatches.length}`);
    } else {
      // No exact matches: try exceptions (if configured) BEFORE using partial matches
      try {
        const normKey = String(oshiLabel || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
        const exListRaw = EXCEPTIONS && (EXCEPTIONS[normKey] || EXCEPTIONS[oshiLabel] || EXCEPTIONS[capitalize(oshiLabel || '')]);
        const exList = Array.isArray(exListRaw) ? exListRaw.map(e => String(e || '').trim()).filter(Boolean) : [];

        if (exList.length > 0) {
          // Try all exceptions and collect matches
          const matchedSet = new Set();

          for (const exTokenRaw of exList) {
            const isPrefix = typeof exTokenRaw === 'string' && exTokenRaw.endsWith('*');
            const exToken = isPrefix
              ? exTokenRaw.slice(0, -1).toLowerCase().replace(/[^\w\s]/g, '').trim()
              : String(exTokenRaw || '').toLowerCase().replace(/[^\w\s]/g, '').trim();

            if (!exToken) {
              console.debug(`[pickCard] rarity=${rarity} oshi=${oshiLabel} skipping empty exception entry`);
              continue;
            }

            const exMatches = candidates.filter(c => {
              if (isPrefix) return c.norm.startsWith(exToken);
              return new RegExp(`\\b${escapeRegExp(exToken)}\\b`).test(c.norm) || c.norm.includes(exToken);
            });

            if (exMatches.length > 0) {
              for (const m of exMatches) matchedSet.add(m.raw);
              console.debug(`[pickCard] rarity=${rarity} oshi=${oshiLabel} exception="${exTokenRaw}" matches=${exMatches.length}`);
            } else {
              console.debug(`[pickCard] rarity=${rarity} oshi=${oshiLabel} exception="${exTokenRaw}" found no matches`);
            }
          }

          if (matchedSet.size > 0) {
            // Build pool from unique matched filenames
            pool = Array.from(matchedSet).map(f => ({ raw: f, norm: normalizeFilenameForMatch(f) }));
            foundAnySpecificMatch = true;
            console.debug(`[pickCard] rarity=${rarity} oshi=${oshiLabel} combinedExceptionMatches=${pool.length}`);
          } else {
            console.debug(`[pickCard] rarity=${rarity} oshi=${oshiLabel} no exceptions produced matches after checking all entries`);
          }
        } else {
          console.debug(`[pickCard] rarity=${rarity} oshi=${oshiLabel} no exceptions configured (checked keys: norm="${normKey}", raw="${oshiLabel}")`);
        }
      } catch (exErr) {
        console.error('[pickCard] exception matching error', exErr);
      }

      // If exceptions didn't produce matches, fall back to partial matches
      if (!pool && partialMatches.length) {
        pool = partialMatches;
        foundAnySpecificMatch = true;
        console.debug(`[pickCard] rarity=${rarity} oshi=${oshiLabel} using partialMatches=${partialMatches.length}`);
      }
    }

    // If there were NO specific matches (exact/exception/partial), attempt to fallback to a different rarity
    if (!foundAnySpecificMatch) {
      const fallback = getNextLowerWeightRarity(rarity, visited);
      if (fallback) {
        console.debug(`[pickCard] rarity=${rarity} oshi=${oshiLabel} had 0 specific matches, falling back to ${fallback}`);
        return pickCardFromRarityFolder(fallback, oshiLabel, { avoidImmediateRepeat, _visited: visited });
      }

      // No fallback available: now fall back to all candidates in this folder as last resort
      pool = candidates;
      console.debug(`[pickCard] rarity=${rarity} oshi=${oshiLabel} no specific matches and no fallback; falling back to all candidates (${candidates.length})`);
    }

    // Deduplicate by normalized basename but keep original filenames grouped
    const grouped = new Map();
    for (const item of pool) {
      const key = item.norm;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item.raw);
    }
    const groups = Array.from(grouped.values());
    if (!groups.length) return null;

    // Avoid immediate repeat per rarity+oshi
    const lastKey = `${rarity}::${oshiLabel || ''}`;
    const lastPicked = lastPickedByRarity.get(lastKey);

    // Choose a group index using crypto.randomInt
    let groupIndex = crypto.randomInt(0, groups.length);

    // If avoidImmediateRepeat and chosen group contains lastPicked, try a few alternatives
    if (avoidImmediateRepeat && lastPicked && groups.length > 1) {
      const chosenGroup = groups[groupIndex];
      if (chosenGroup.includes(lastPicked)) {
        for (let i = 0; i < 5; i++) {
          const alt = crypto.randomInt(0, groups.length);
          if (alt !== groupIndex && !groups[alt].includes(lastPicked)) {
            groupIndex = alt;
            break;
          }
        }
      }
    }

    const chosenGroup = groups[groupIndex];
    const rawPick = chosenGroup[crypto.randomInt(0, chosenGroup.length)];

    // Persist last pick
    lastPickedByRarity.set(lastKey, rawPick);

    console.debug(`[pickCard] rarity=${rarity} oshi=${oshiLabel} poolSize=${pool.length} groups=${groups.length} chosen=${rawPick}`);

    return { name: path.basename(rawPick, path.extname(rawPick)), rarity };
  } catch (err) {
    console.error('[pickCardFromRarityFolder] error', err);
    return null;
  }

  // small helper used above
  function capitalize(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}

// Replace your current getNextLowerWeightRarity with this order-based fallback.
// It walks RARITY_ORDER leftwards (toward more-common rarities) and returns
// the first rarity that is not excluded and not already visited.
function getNextLowerWeightRarity(currentRarity, visitedSet = null) {
  try {
    if (!currentRarity) return null;
    const curKey = String(currentRarity).trim();
    const idx = RARITY_ORDER.indexOf(curKey);
    if (idx === -1) {
      // If current rarity isn't in RARITY_ORDER, try to find any eligible rarity
      // by scanning RARITY_ORDER from the end toward the start.
      for (let i = RARITY_ORDER.length - 1; i >= 0; i--) {
        const candidate = RARITY_ORDER[i];
        if (RARITY_EXCLUDE.has(candidate)) continue;
        if (visitedSet && visitedSet.has(candidate)) continue;
        if (candidate === curKey) continue;
        return candidate;
      }
      return null;
    }

    // Walk left from current index to find the first eligible rarity
    for (let i = idx - 1; i >= 0; i--) {
      const candidate = RARITY_ORDER[i];
      if (RARITY_EXCLUDE.has(candidate)) continue;
      if (visitedSet && visitedSet.has(candidate)) continue;
      return candidate;
    }

    // nothing found
    return null;
  } catch (e) {
    console.error('[pickCard] getNextLowerWeightRarity error', e);
    return null;
  }
}


/**
 * Pick a card by first selecting a rarity by weight (from weightMap),
 * then picking a file from that rarity folder. If chosen rarity has no files
 * or yields no pick, remove it from the candidate list and try again.
 *
 * Returns { name, rarity } or null.
 */
async function pickCardByWeightedRarity(weightMap, oshiLabel, opts = {}) {
  const options = buildWeightedOptionsFromMap(weightMap);
  if (!options.length) return null;

  // copy so we can remove tried rarities
  const candidates = options.slice();

  while (candidates.length) {
    // pick a rarity by weight
    const chosenKey = pickWeighted(candidates); // returns the key string
    // remove the chosen candidate from list so we don't retry it forever
    const idx = candidates.findIndex(c => c.key === chosenKey);
    if (idx !== -1) candidates.splice(idx, 1);

    // try to pick a card from that rarity folder
    const pick = await pickCardFromRarityFolder(chosenKey, oshiLabel, opts);
    if (pick) return pick;

    // otherwise loop and try next weighted candidate
  }

  return null;
}

// -------------------- Settlement --------------------
async function settleEndedEvents(client = null) {
  const toSettle = await BossEvent.find({ status: 'ended' });
  for (const ev of toSettle) {
    try {
      const sorted = (ev.pointsByUser || []).slice().sort((a,b) => {
        if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
        const ta = a.firstPointAt ? new Date(a.firstPointAt).getTime() : 0;
        const tb = b.firstPointAt ? new Date(b.firstPointAt).getTime() : 0;
        return ta - tb;
      });

      const winners = sorted.slice(0,3);

      // Participation: pick a rarity using PARTICIPATION_WEIGHTS (excludes P, SP, UP)
      for (const p of ev.pointsByUser || []) {
        if ((p.points || 0) <= 0) continue;

        const oshiCfg = oshis.find(o => o.id === ev.oshiId);
        const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

        try {
          // pick by weighted rarity using PARTICIPATION_WEIGHTS
          const picked = await pickCardByWeightedRarity(PARTICIPATION_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true });

          if (picked && picked.name) {
            // award the picked card (increment if exists)
            await addCardToUser(p.userId, picked.name, picked.rarity, 1);
            await BossPointLog.create({
              eventId: ev.eventId,
              userId: p.userId,
              oshiId: ev.oshiId,
              action: 'reward',
              points: 0,
              meta: { tier: 'participation', reward: picked.rarity, card: picked.name, debug: { picked } }
            });
          } else {
            // fallback: give canonical C card for the oshi
            const fallback = `${oshiLabel} 001`;
            await addCardToUser(p.userId, fallback, 'C', 1);
            await BossPointLog.create({
              eventId: ev.eventId,
              userId: p.userId,
              oshiId: ev.oshiId,
              action: 'reward',
              points: 0,
              meta: { tier: 'participation', reward: 'C', card: fallback, note: 'fallback' }
            });
          }
        } catch (err) {
          console.error('[settle] participation award error for', p.userId, err);
          // continue to next participant
        }
      }

      // 3rd place: prefer SECONDPLACE_WEIGHTS (OSR semantics), fallback to PARTICIPATION_WEIGHTS
      if (winners[2]) {
        try {
          const oshiCfg = oshis.find(o => o.id === ev.oshiId);
          const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

          const picked = await pickCardByWeightedRarity(THIRDPLACE_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true })
                        || await pickCardByWeightedRarity(PARTICIPATION_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true });

          if (picked && picked.name) {
            await addCardToUser(winners[2].userId, picked.name, picked.rarity, 1);
            await BossPointLog.create({ eventId: ev.eventId, userId: winners[2].userId, oshiId: ev.oshiId, action: 'reward', points: 0, meta: { tier: 3, reward: picked.rarity, card: picked.name } });
          } else {
            await addOshiOsrToUser(winners[2].userId, oshiLabel);
            await BossPointLog.create({ eventId: ev.eventId, userId: winners[2].userId, oshiId: ev.oshiId, action: 'reward', points: 0, meta: { tier: 3, reward: 'OSR' } });
          }
        } catch (err) {
          console.error('[settle] 3rd place reward error for', winners[2]?.userId, err);
        }
      }

      // 2nd place: OSR with higher-rate variant
      if (winners[1]) {
        try {
          const oshiCfg = oshis.find(o => o.id === ev.oshiId);
          const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;
          const isHighVariant = Math.random() < 0.25;

          if (isHighVariant) {
            const picked = await pickCardByWeightedRarity(SECONDPLACE_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true });
            if (picked && picked.name) {
              await addCardToUser(winners[1].userId, picked.name, picked.rarity, 1);
              await BossPointLog.create({ eventId: ev.eventId, userId: winners[1].userId, oshiId: ev.oshiId, action: 'reward', points: 0, meta: { tier: 2, reward: picked.rarity, card: picked.name } });
            } else {
              await addOshiOsrToUser(winners[1].userId, oshiLabel);
              await BossPointLog.create({ eventId: ev.eventId, userId: winners[1].userId, oshiId: ev.oshiId, action: 'reward', points: 0, meta: { tier: 2, reward: 'OSR' } });
            }
          } else {
            const picked = await pickCardByWeightedRarity(SECONDPLACE_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true })
                          || await pickCardByWeightedRarity(PARTICIPATION_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true });
            if (picked && picked.name) {
              await addCardToUser(winners[1].userId, picked.name, picked.rarity, 1);
              await BossPointLog.create({ eventId: ev.eventId, userId: winners[1].userId, oshiId: ev.oshiId, action: 'reward', points: 0, meta: { tier: 2, reward: picked.rarity, card: picked.name } });
            } else {
              await addOshiOsrToUser(winners[1].userId, oshiLabel);
              await BossPointLog.create({ eventId: ev.eventId, userId: winners[1].userId, oshiId: ev.oshiId, action: 'reward', points: 0, meta: { tier: 2, reward: 'OSR' } });
            }
          }
        } catch (err) {
          console.error('[settle] 2nd place reward error for', winners[1]?.userId, err);
        }
      }

      // 1st place: ORI + also award a 2nd-place reward on top
if (winners[0]) {
  try {
    const oshiCfg = oshis.find(o => o.id === ev.oshiId);
    const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

    // --- ORI awarding (existing behavior) ---
    const pickedOri = await pickCardFromRarityFolder('ORI', oshiLabel);
    let cardName = null;
    if (pickedOri && pickedOri.name) {
      const norm = normalizeFilenameForMatch(pickedOri.name);
      if (oshiLabel && new RegExp(`\\b${escapeRegExp(oshiLabel.toLowerCase())}\\b`).test(norm)) {
        cardName = pickedOri.name;
      } else {
        console.warn(`[settle] ORI picked "${pickedOri.name}" doesn't match oshi ${oshiLabel}; generating ORI id`);
        cardName = `${oshiLabel} 001`;
      }
    } else {
      cardName = `${oshiLabel} 001`;
    }

    await addCardToUser(winners[0].userId, cardName, 'ORI', 1);
    await BossPointLog.create({
      eventId: ev.eventId,
      userId: winners[0].userId,
      oshiId: ev.oshiId,
      action: 'reward',
      points: 0,
      meta: { tier: 1, reward: 'ORI', card: cardName }
    });

    // --- EXTRA: award 2nd-place reward on top of ORI ---
    try {
      // Use the same SECONDPLACE_WEIGHTS flow as for 2nd place
      const picked2 = await pickCardByWeightedRarity(SECONDPLACE_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true })
                      || await pickCardByWeightedRarity(PARTICIPATION_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true });

      if (picked2 && picked2.name) {
        await addCardToUser(winners[0].userId, picked2.name, picked2.rarity, 1);
        await BossPointLog.create({
          eventId: ev.eventId,
          userId: winners[0].userId,
          oshiId: ev.oshiId,
          action: 'reward',
          points: 0,
          meta: { tier: 2, reward: picked2.rarity, card: picked2.name, note: '1st place also awarded 2nd-place reward' }
        });
      } else {
        // fallback: give an OSR via helper if no file found
        await addOshiOsrToUser(winners[0].userId, oshiLabel);
        await BossPointLog.create({
          eventId: ev.eventId,
          userId: winners[0].userId,
          oshiId: ev.oshiId,
          action: 'reward',
          points: 0,
          meta: { tier: 2, reward: 'OSR', note: 'fallback' }
        });
      }
    } catch (err) {
      console.error('[settle] extra 2nd-place reward error for 1st place', winners[0].userId, err);
    }

  } catch (err) {
    console.error('[settle] 1st place reward error for', winners[0]?.userId, err);
  }
}


      ev.status = 'settled';
      await ev.save();
      await postBossResults(client, ev.eventId);
      // optional: post settlement summary to boss channel
      if (client && config.bossChannelId) {
        try {
          const ch = await client.channels.fetch(config.bossChannelId).catch(() => null);
          if (ch && ch.isTextBased?.() && ch.send) {
            const oshiCfg = oshis.find(o => o.id === ev.oshiId);
            const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;
            const summary = new EmbedBuilder()
              .setTitle(`Stream ended: ${oshiLabel}`)
              .setDescription(`Stream has ended. Here are the top 3 contributors for **${oshiLabel}**'s last stream:`)
              .addFields(
                { name: '1st', value: winners[0] ? `<@${winners[0].userId}>` : '—', inline: true },
                { name: '2nd', value: winners[1] ? `<@${winners[1].userId}>` : '—', inline: true },
                { name: '3rd', value: winners[2] ? `<@${winners[2].userId}>` : '—', inline: true }
              );
            await ch.send({ embeds: [summary] });
          }
        } catch (err) {
          console.error('settleEndedEvents announce error', err);
        }
      }
    } catch (err) {
      console.error('settleEndedEvents error for', ev.eventId, err);
    }
  }
}

// -------------------- createAndAnnounceEvent helper --------------------
/**
 * Create and announce a boss event immediately.
 * @param {Client} client - discord client
 * @param {string} oshiId - oshi id to spawn
 * @param {number|null} durationMs - duration in ms; if null uses eventDurationMs()
 * @returns {Promise<{ event: Object, message: Message }>} created event doc (mongoose) and sent message
 */
async function createAndAnnounceEvent(client, oshiId, durationMs = null) {
  const now = new Date();
  const endsAt = new Date(now.getTime() + (typeof durationMs === 'number' ? durationMs : eventDurationMs()));
  const oshiCfg = oshis.find(o => o.id === oshiId) || oshis[Math.floor(Math.random() * oshis.length)];
  const oshiLabel = oshiCfg ? oshiCfg.label : oshiId;
  const imageUrl = buildOshiOsrImageUrl(oshiLabel, 'ORI');

  const eventDoc = await BossEvent.create({
    eventId: nanoid(),
    oshiId,
    spawnAt: now,
    endsAt,
    status: 'active',
    pointsTotal: 0,
    pointsByUser: [],
    imageUrl,
    happiness: 0,
    createdAt: now
  });

  const { embed, components } = buildBossEmbedAndButtons(eventDoc, oshiLabel);

  const channelId = config.bossChannelId;
  if (!channelId) throw new Error('bossChannelId not configured');

  const ch = await client.channels.fetch(channelId);
  if (!ch || !ch.isTextBased?.()) throw new Error('Configured boss channel is not text-based or unavailable');

  const msg = await ch.send({ embeds: [embed], components: components || [] });

  // persist message id
  eventDoc.announceMessageId = msg.id;
  await eventDoc.save();

  console.log(`[createAndAnnounceEvent] spawned event ${eventDoc.eventId} for ${oshiLabel}, announced as message ${msg.id}`);

  return { event: eventDoc, message: msg };
}

// -------------------- Manager start/stop --------------------
let activatorInterval = null;
let settleInterval = null;
let refresherInterval = null;

async function startBossManager(client, { weeklySeed } = {}) {
  try {
    await scheduleWeeklyBosses({ seed: weeklySeed || String(Date.now()) });
  } catch (err) {
    console.error('scheduleWeeklyBosses error', err);
  }

  // clear any existing intervals to avoid duplicates when restarting manager
  try { if (activatorInterval) clearInterval(activatorInterval); } catch (e) { /* ignore */ }
  try { if (settleInterval) clearInterval(settleInterval); } catch (e) { /* ignore */ }
  try { if (refresherInterval) clearInterval(refresherInterval); } catch (e) { /* ignore */ }

  // activator + announcer (unchanged behavior)
  activatorInterval = setInterval(async () => {
    try {
      await activateAndEndEvents();
      await announceActivatedEvents(client);
    } catch (e) {
      console.error('activator loop error', e);
    }
  }, 15_000);

  // settlement (unchanged behavior)
  settleInterval = setInterval(async () => {
    try {
      await settleEndedEvents(client);
    } catch (e) {
      console.error('settle loop error', e);
    }
  }, 15_000);

  // -------------------- Refresher (every 10 minutes) --------------------
  // In-memory map to avoid editing unchanged messages: eventId -> hash
  const crypto = require('crypto');
  const lastEmbedHashByEvent = new Map();

  function hashEmbedAndComponents(embed, components) {
    try {
      const payload = JSON.stringify({
        embed: embed ? (typeof embed.toJSON === 'function' ? embed.toJSON() : embed) : null,
        components: components || null
      });
      return crypto.createHash('sha1').update(payload).digest('hex');
    } catch (e) {
      return null;
    }
  }

  async function safeEditMessage(msg, payload) {
    try {
      if (!msg || typeof msg.edit !== 'function') return false;
      await msg.edit(payload);
      return true;
    } catch (err) {
      console.warn('[refresher] failed to edit message', msg?.id, err?.message || err);
      return false;
    }
  }

  async function interactionClientSafeFetchChannel(client, channelId) {
    try {
      if (!client || !channelId) return null;
      const ch = await client.channels.fetch(channelId).catch(() => null);
      return ch;
    } catch (e) {
      return null;
    }
  }

  // set refresher to run every 10 minutes (600000 ms)
  refresherInterval = setInterval(async () => {
    try {
      const active = await BossEvent.find({ status: 'active' });
      if (!active || active.length === 0) return;

      const BATCH_SIZE = 5;
      for (let i = 0; i < active.length; i += BATCH_SIZE) {
        const batch = active.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (ev) => {
          try {
            if (!ev || !ev.announceMessageId) return;

            const oshiCfg = oshis.find(o => o.id === ev.oshiId);
            const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;
            const { embed, components } = buildBossEmbedAndButtons(ev, oshiLabel);

            const newHash = hashEmbedAndComponents(embed, components);
            const lastHash = lastEmbedHashByEvent.get(ev.eventId);

            // Skip edit if nothing changed
            if (newHash && lastHash === newHash) return;

            const ch = await interactionClientSafeFetchChannel(client, config.bossChannelId);
            if (!ch || !ch.isTextBased?.()) return;

            const msg = await ch.messages.fetch(ev.announceMessageId).catch(() => null);
            if (!msg) {
              // message missing: clear stored id so other logic can recreate if desired
              lastEmbedHashByEvent.delete(ev.eventId);
              return;
            }

            const ok = await safeEditMessage(msg, { embeds: [embed], components: components || [] });
            if (ok && newHash) lastEmbedHashByEvent.set(ev.eventId, newHash);
          } catch (err) {
            console.error('[refresher] per-event error', ev?.eventId, err);
          }
        }));
      }
    } catch (err) {
      console.error('refresher loop error', err);
    }
  }, 600_000); // 10 minutes
}


function stopBossManager() {
  if (activatorInterval) clearInterval(activatorInterval);
  if (settleInterval) clearInterval(settleInterval);
  if (refresherInterval) clearInterval(refresherInterval);
}

// -------------------- Exports --------------------
module.exports = {
  startBossManager,
  stopBossManager,
  handleLike,
  handleSub,
  handleSubWithCard,
  handleMember,
  handleSuperchat,
  findActiveEventForOshi,
  superchatCost,
  buildOshiOsrImageUrl,
  refreshEventMessage,
  eventDurationMs,
  createAndAnnounceEvent,
  createSuperchatConfirm, 
  handleSuperchatInteraction,
};
