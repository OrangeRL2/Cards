// jobs/bossManager.js
// Centralized boss manager implementing scheduled spawns, announcements, actions, and settlement.

const { nanoid } = require('nanoid');
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

const ASSETS_BASE = path.join(__dirname, '..', 'assets', 'images');

// Tunables
const SUPERCHAT_BASE = Number(process.env.BOSS_SUPERCHAT_BASE ?? 100);
const SUPERCHAT_ESCALATION = Number(process.env.BOSS_SUPERCHAT_ESCALATION ?? 0);
const LIKE_RATE_LIMIT_MS = Number(process.env.BOSS_LIKE_RATE_LIMIT_MS ?? 5000);
const IMAGE_BASE = process.env.BOSS_IMAGE_BASE ?? 'http://152.69.195.48/images';
const CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;

// Debug duration support
const DEBUG_DURATION_MS = process.env.BOSS_DEBUG_DURATION_MS
  ? Number(process.env.BOSS_DEBUG_DURATION_MS)
  : (process.env.BOSS_DEBUG ? 60 * 1000 : null);

function eventDurationMs() {
  return DEBUG_DURATION_MS ?? (24 * 60 * 60 * 1000);
}

// In-memory rate limit map (per user per event)
const lastLikeAt = new Map();

// -------------------- Rarity / Participation config --------------------

const RARITY_ORDER = [
  'C', 'U', 'R', 'S', 'RR', 'OC', 'SR', 'OSR', 'P', 'SP', 'SY', 'UR', 'OUR', 'HR', 'BDAY', 'UP', 'SEC'
];

const RARITY_EXCLUDE = new Set(['P', 'SP', 'UP']);

const ASSETS_BASE_BY_RARITY = {
  BDAY: process.env.BDAY_ASSETS_BASE ?? path.join(__dirname, '..', 'assets', 'montlybdays'),
  OSR: process.env.OSR_ASSETS_BASE ?? path.join(__dirname, '..', 'assets', 'montlybdays')
};

function getAssetsBaseForRarity(rarity) {
  if (!rarity) return ASSETS_BASE;
  const key = String(rarity).trim().toUpperCase();
  return ASSETS_BASE_BY_RARITY[key] ?? ASSETS_BASE;
}

const PARTICIPATION_WEIGHTS = {
  C: 35, U: 25, R: 15, S: 10, RR: 5, OC: 5, SR: 2.5, OSR: 2.5,
  SY: 0, UR: 0, OUR: 0, HR: 0, BDAY: 0, SEC: 0.0
};

const THIRDPLACE_WEIGHTS = {
  C: 0, U: 0, R: 0, S: 0, RR: 0, OC: 0,
  SR: 35, OSR: 25, SY: 15, UR: 10, OUR: 5, HR: 5, BDAY: 4, SEC: 1
};

const SECONDPLACE_WEIGHTS = {
  C: 0, U: 0, R: 0, S: 0, RR: 0, OC: 0,
  SR: 20, OSR: 15, SY: 15, UR: 15, OUR: 11, HR: 11, BDAY: 8, SEC: 5
};

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

function pickWeighted(options) {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of options) {
    if (r <= o.weight) return o.key;
    r -= o.weight;
  }
  return options[options.length - 1].key;
}

function buildWeightedOptionsFromMap(weightMap) {
  return Object.entries(weightMap)
    .map(([key, w]) => ({ key, weight: Number(w) || 0 }))
    .filter(o => o.weight > 0 && !RARITY_EXCLUDE.has(o.key));
}

// -------------------- User card helper --------------------

async function addCardToUser(userId, cardName, rarity, count = 1) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    let user = await User.findOne({ id: userId }).session(session).exec();
    if (!user) {
      const newCard = { name: cardName, rarity, count, firstAcquiredAt: new Date(), lastAcquiredAt: new Date() };
      await User.updateOne({ id: userId }, { $push: { cards: newCard } }, { upsert: true, session });
      await session.commitTransaction();
      return;
    }

    const idx = (user.cards || []).findIndex(c => c.name === cardName && c.rarity === rarity);
    if (idx !== -1) {
      const update = {};
      update[`cards.${idx}.count`] = (user.cards[idx].count || 0) + count;
      update[`cards.${idx}.lastAcquiredAt`] = new Date();
      await User.updateOne({ id: userId }, { $set: update }, { session });
    } else {
      const newCard = { name: cardName, rarity, count, firstAcquiredAt: new Date(), lastAcquiredAt: new Date() };
      await User.updateOne({ id: userId }, { $push: { cards: newCard } }, { upsert: true, session });
    }

    await session.commitTransaction();
  } catch (err) {
    try { await session.abortTransaction(); } catch (_) {}
    throw err;
  } finally {
    session.endSession();
  }
}

// -------------------- Helpers --------------------

function superchatCost(n) {
  return Math.ceil(SUPERCHAT_BASE * (1 + SUPERCHAT_ESCALATION * (n - 1)));
}

function buildOshiOsrImageUrl(oshiLabel, rarity = 'OSR') {
  const baseName = typeof oshiLabel === 'string' ? oshiLabel.trim() : String(oshiLabel);
  const cardName = `${baseName} 001`;
  return `${IMAGE_BASE.replace(/\/$/, '')}/${encodeURIComponent(String(rarity).trim())}/${encodeURIComponent(cardName)}.png`;
}

function renderHappinessBar(value) {
  const max = 100;
  const filled = Math.round((Math.max(0, Math.min(value, max)) / max) * 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  return `${bar} ${value} happiness`;
}

const OSHI_DESCRIPTIONS = {
  Rushia: 'Konrushi!',
  Mumei: '**{oshi}** stream marathon: support Mumei and earn special cards!',
  Lamy: 'I love Yoi',
  Hajime: 'Vroom, vroom, vroom!',
  Hajime: 'Niko Niko nii',
  __default: 'Support **{oshi}** with all you got for special rewards!'
};

function formatTemplate(tpl, vars = {}) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

function buildBossEmbedAndButtons(ev, oshiLabel) {
  const tpl = OSHI_DESCRIPTIONS[oshiLabel] ?? OSHI_DESCRIPTIONS.__default;
  const durationSeconds = Math.round((new Date(ev.endsAt).getTime() - new Date(ev.spawnAt).getTime()) / 1000);

  const vars = {
    oshi: oshiLabel,
    duration: `${durationSeconds}s`,
    endsAtRelative: `<t:${Math.floor(new Date(ev.endsAt).getTime() / 1000)}:R>`
  };

  const embed = new EmbedBuilder()
    .setTitle(`${oshiLabel} has started a 24 hour stream!`)
    .setDescription(formatTemplate(tpl, vars))
    .setColor(0x5AB3F4)
    .setImage(ev.imageUrl || buildOshiOsrImageUrl(oshiLabel, 'ORI'))
    .addFields(
      { name: 'Ends', value: vars.endsAtRelative, inline: true },
      { name: 'Happiness', value: renderHappinessBar(typeof ev.happiness === 'number' ? ev.happiness : 0), inline: true },
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`boss\n${ev.eventId}\nlike`).setLabel('Like').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`boss\n${ev.eventId}\nsub`).setLabel('Sub').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`boss\n${ev.eventId}\nsuperchat`).setLabel('Superchat').setStyle(ButtonStyle.Danger)
  );

  return { embed, components: [row] };
}

// -------------------- Activator / Announcer --------------------

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

async function announceActivatedEvents(client) {
  const now = new Date();
  const toActivate = await BossEvent.find({ status: 'scheduled', spawnAt: { $lte: now }, endsAt: { $gt: now } });
  if (!toActivate.length) return;

  for (const ev of toActivate) {
    const oshiCfg = oshis.find(o => o.id === ev.oshiId);
    const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

    ev.status = 'active';
    ev.imageUrl = buildOshiOsrImageUrl(oshiLabel, 'ORI');
    ev.happiness = ev.happiness || 0;
    await ev.save();

    const { embed, components } = buildBossEmbedAndButtons(ev, oshiLabel);

    try {
      const channelId = config.bossChannelId;
      if (!channelId) continue;

      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (!ch || !ch.isTextBased?.()) continue;

      const msg = await ch.send({ embeds: [embed], components: components || [] });
      ev.announceMessageId = msg.id;
      await ev.save();
      console.log(`[announce] event ${ev.eventId} announced as message ${msg.id}`);
    } catch (err) {
      console.error('announceActivatedEvents send error', err);
    }
  }
}

async function refreshEventMessage(client, eventId, evOverride = null) {
  const ev = evOverride || await BossEvent.findOne({ eventId }).lean();
  if (!ev || !ev.announceMessageId) return false;

  const oshiCfg = oshis.find(o => o.id === ev.oshiId);
  const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

  const { embed, components } = buildBossEmbedAndButtons(ev, oshiLabel);

  const ch = await client.channels.fetch(config.bossChannelId).catch(() => null);
  if (!ch || !ch.isTextBased?.()) return false;

  const msg = await ch.messages.fetch(ev.announceMessageId).catch(() => null);
  if (!msg) return false;

  await msg.edit({ embeds: [embed], components: components || [] });
  return true;
}

// -------------------- Core updater --------------------

async function _upsertUserPointsAndHappiness(eventId, userId, pointsDelta, happinessDelta, session = null, superchatIncrement = 0) {
  const incUpdate = { $inc: {} };
  if (pointsDelta) incUpdate.$inc.pointsTotal = pointsDelta;
  if (happinessDelta) incUpdate.$inc.happiness = happinessDelta;
  if (pointsDelta) incUpdate.$inc['pointsByUser.$.points'] = pointsDelta;
  if (superchatIncrement) incUpdate.$inc['pointsByUser.$.superchatCount'] = superchatIncrement;

  const updatedIfExists = await BossEvent.findOneAndUpdate(
    { eventId, 'pointsByUser.userId': userId },
    incUpdate,
    { session, new: true }
  ).lean();

  if (updatedIfExists) return updatedIfExists;

  const pushUpdate = {
    $push: { pointsByUser: { userId, points: pointsDelta || 0, superchatCount: superchatIncrement || 0, firstPointAt: new Date() } },
    $inc: {}
  };

  if (pointsDelta) pushUpdate.$inc.pointsTotal = pointsDelta;
  if (happinessDelta) pushUpdate.$inc.happiness = happinessDelta;

  return BossEvent.findOneAndUpdate({ eventId }, pushUpdate, { session, new: true }).lean();
}

// -------------------- Card consumption --------------------

async function consumeCard(userId, allowedRarities = ['OSR', 'SR'], session = null) {
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
    if (cardRarity) return c.name === cardName && c.rarity === cardRarity && (c.count || 0) > 0;
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

// -------------------- Event resolvers --------------------

async function findActiveEventById(eventId) {
  if (!eventId) return null;

  const ev = await BossEvent.findOne({ eventId: String(eventId) }).exec();
  if (!ev) return null;

  const now = Date.now();
  const spawn = ev.spawnAt ? new Date(ev.spawnAt).getTime() : 0;
  const end = ev.endsAt ? new Date(ev.endsAt).getTime() : 0;

  if (ev.status !== 'active') return null;
  if (spawn && spawn > now) return null;
  if (end && end <= now) return null;

  return ev;
}

async function findActiveEventForOshi(oshiId) {
  const now = new Date();
  return BossEvent.findOne({ oshiId, spawnAt: { $lte: now }, endsAt: { $gt: now }, status: 'active' });
}

async function resolveActiveEventOrThrow({ eventId, oshiId }) {
  let ev = null;
  if (eventId) ev = await findActiveEventById(eventId);
  if (!ev && oshiId) ev = await findActiveEventForOshi(oshiId);
  if (!ev) throw new Error('This stream is no longer active.');
  return ev;
}

// -------------------- Actions (eventId-based) --------------------

async function handleLike({ userId, eventId, client = null }) {
  const ev = await resolveActiveEventOrThrow({ eventId });

  // rate limit per (user,event)
  const nowMs = Date.now();
  const likeKey = `${userId}:${ev.eventId}`;
  const last = lastLikeAt.get(likeKey) || 0;
  if (nowMs - last < LIKE_RATE_LIMIT_MS) throw new Error('Rate limited');
  lastLikeAt.set(likeKey, nowMs);

  const session = await mongoose.startSession();
  let committed = false;

  // compute points
  const oshiDoc = await Oshi.findOne({ userId }).lean();
  const oshiLevel = oshiDoc ? oshiDoc.level : 1;
  const isMemberOfOshi = oshiDoc && String(oshiDoc.oshiId) === String(ev.oshiId);

  const cappedLevel = Math.max(0, Math.min(100, Math.floor(oshiLevel || 1)));
  const MEMBER_BONUS_POINTS = 50;
  const MEMBER_BONUS_HAPPINESS = 50;

  const memberBonusPoints = isMemberOfOshi ? MEMBER_BONUS_POINTS : 0;
  const memberBonusHappiness = isMemberOfOshi ? MEMBER_BONUS_HAPPINESS : 0;

  const totalPoints = cappedLevel + memberBonusPoints;
  const totalHappiness = cappedLevel + memberBonusHappiness;

  try {
    session.startTransaction();

    // hard-block duplicates even if DB index not present
    const existing = await BossPointLog.findOne({ eventId: ev.eventId, userId, action: 'like' })
      .session(session).lean();
    if (existing) throw new Error('You have already liked this boss (only once per boss spawn).');

    await BossPointLog.create([{
      eventId: ev.eventId,
      userId,
      oshiId: ev.oshiId,
      action: 'like',
      points: totalPoints,
      meta: {
        oshiLevel: cappedLevel,
        memberBonus: isMemberOfOshi ? { points: memberBonusPoints, happiness: memberBonusHappiness } : undefined
      }
    }], { session });

    const updatedEv = await _upsertUserPointsAndHappiness(ev.eventId, userId, totalPoints, totalHappiness, session);

    await session.commitTransaction();
    committed = true;

    if (client) await refreshEventMessage(client, ev.eventId, updatedEv);

    const memberMsg = isMemberOfOshi ? `You are a member of **${ev.oshiId}** +${MEMBER_BONUS_POINTS}` : null;
    return { points: totalPoints, happinessDelta: totalHappiness, memberMsg };

  } catch (e) {
    try { if (!committed) await session.abortTransaction(); } catch (_) {}
    if (e?.code === 11000) throw new Error('You have already liked this boss (only once per boss spawn).');
    throw e;
  } finally {
    session.endSession();
  }
}

async function handleSub({ userId, eventId, client = null }) {
  const ev = await resolveActiveEventOrThrow({ eventId });

  const session = await mongoose.startSession();
  let committed = false;

  try {
    session.startTransaction();

    const consumed = await consumeCard(userId, ['OSR', 'SR'], session);
    if (!consumed) throw new Error('You need an OSR or SR card to subscribe.');

    const points = 5;
    const happinessDelta = 5;

    const updatedEv = await _upsertUserPointsAndHappiness(ev.eventId, userId, points, happinessDelta, session);

    await BossPointLog.create([{
      eventId: ev.eventId,
      userId,
      oshiId: ev.oshiId,
      action: 'sub',
      points,
      meta: { consumedCard: true }
    }], { session });

    await session.commitTransaction();
    committed = true;

    if (client) await refreshEventMessage(client, ev.eventId, updatedEv);
    return { points, happinessDelta };

  } catch (e) {
    try { if (!committed) await session.abortTransaction(); } catch (_) {}
    throw e;
  } finally {
    session.endSession();
  }
}

async function handleSubWithCard({ userId, eventId, cardName, cardRarity = null, client = null }) {
  const ev = await resolveActiveEventOrThrow({ eventId });

  const session = await mongoose.startSession();
  let committed = false;

  try {
    session.startTransaction();

    const consumed = await consumeCardByName(userId, cardName, cardRarity, session);
    if (!consumed) throw new Error('Selected card not found in your inventory or already used.');

    const points = 4;
    const happinessDelta = 4;

    const updatedEv = await _upsertUserPointsAndHappiness(ev.eventId, userId, points, happinessDelta, session);

    await BossPointLog.create([{
      eventId: ev.eventId,
      userId,
      oshiId: ev.oshiId,
      action: 'sub',
      points,
      meta: { consumedCard: { name: cardName, rarity: cardRarity } }
    }], { session });

    await session.commitTransaction();
    committed = true;

    if (client) await refreshEventMessage(client, ev.eventId, updatedEv);
    return { points, happinessDelta };

  } catch (e) {
    try { if (!committed) await session.abortTransaction(); } catch (_) {}
    throw e;
  } finally {
    session.endSession();
  }
}

async function handleMember({ userId, eventId, client = null }) {
  const ev = await resolveActiveEventOrThrow({ eventId });

  const userDoc = await User.findOne({ id: userId }).lean();
  if (!userDoc) throw new Error('User not found');
  if (userDoc.chosenOshi !== ev.oshiId) throw new Error('Member bonus only applies if this is your chosen oshi');

  const points = 50;
  const happinessDelta = 50;

  const updatedEv = await _upsertUserPointsAndHappiness(ev.eventId, userId, points, happinessDelta);

  await BossPointLog.create({
    eventId: ev.eventId,
    userId,
    oshiId: ev.oshiId,
    action: 'member',
    points,
    meta: {}
  });

  if (client) await refreshEventMessage(client, ev.eventId, updatedEv);
  return { points, happinessDelta };
}

// Superchat confirm UI
async function createSuperchatConfirm(interaction, eventId) {
  const ev = await BossEvent.findOne({ eventId }).lean();
  if (!ev || ev.status !== 'active') {
    await interaction.reply({ content: 'This stream is no longer active.', ephemeral: true });
    return;
  }

  const userId = interaction.user.id;
  const userState = (ev.pointsByUser || []).find(p => p.userId === userId);
  const currentCount = userState ? (userState.superchatCount || 0) : 0;
  const nextN = currentCount + 1;
  const currentCost = superchatCost(nextN);

  const oshiCfg = oshis.find(o => o.id === ev.oshiId);
  const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

  const embed = new EmbedBuilder()
    .setTitle(`Confirm Superchat for ${oshiLabel}`)
    .setDescription(`This superchat will cause **${currentCost}** fans to empty their wallets.\nIn exchange 6 happiness points will be awarded`)
    .setColor(0xFF4500)
    .setTimestamp(new Date());

  const confirmId = `boss\n${eventId}\nsuperchat\nconfirm\n${userId}`;
  const cancelId = `boss\n${eventId}\nsuperchat\ncancel\n${userId}`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel(`Confirm (${currentCost})`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

  setTimeout(async () => {
    try {
      const replyMsg = await interaction.fetchReply().catch(() => null);
      if (!replyMsg) return;
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel(`Confirm (${currentCost})`).setStyle(ButtonStyle.Danger).setDisabled(true),
        new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary).setDisabled(true)
      );
      await replyMsg.edit({ components: [disabledRow] }).catch(() => null);
    } catch (_) {}
  }, CONFIRM_TIMEOUT_MS);
}

// confirm/cancel handler
async function handleSuperchatInteraction(interaction) {
  if (!interaction.isButton?.()) return false;

  const parts = interaction.customId.split('\n');
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
    if (!ev || ev.status !== 'active') {
      await interaction.update({ content: 'Event no longer available.', embeds: [], components: [] }).catch(() => null);
      return true;
    }

    const userState = (ev.pointsByUser || []).find(p => p.userId === userId);
    const currentCount = userState ? (userState.superchatCount || 0) : 0;
    const nextN = currentCount + 1;
    const currentCost = superchatCost(nextN);

    try {
      const result = await handleSuperchat({ userId, eventId, spendFans: currentCost, client: interaction.client });
      const successText =
        `Superchat sent: **${result.spendFans}** fans had their wallets emptied.\n` +
        `Happiness awarded: **${result.happinessDelta}**.`;
      await interaction.update({ content: successText, embeds: [], components: [] }).catch(() => null);
    } catch (err) {
      const errMsg = err?.message ? `Superchat failed: ${err.message}` : 'Superchat failed.';
      await interaction.update({ content: errMsg, embeds: [], components: [] }).catch(() => null);
    }
    return true;
  }

  return false;
}

// Superchat action (eventId-based)
async function handleSuperchat({ userId, eventId, spendFans, client = null }) {
  spendFans = typeof spendFans === 'number' && !Number.isNaN(spendFans) ? Math.floor(spendFans) : undefined;

  const ev = await resolveActiveEventOrThrow({ eventId });

  const userDoc = await User.findOne({ id: userId }).lean();
  if (!userDoc) throw new Error('User not found');

  const userState = (ev.pointsByUser || []).find(p => p.userId === userId);
  const currentCount = userState ? (userState.superchatCount || 0) : 0;
  const nextN = currentCount + 1;

  const minCost = superchatCost(nextN);
  if (typeof spendFans !== 'number' || Number.isNaN(spendFans)) spendFans = minCost;

  if (spendFans < minCost) throw new Error(`Minimum fans required for this superchat is ${minCost}`);
  if ((userDoc.points || 0) < spendFans) throw new Error('Insufficient fans');

  const points = 6;
  const happinessDelta = 6;

  const session = await mongoose.startSession();
  let committed = false;

  try {
    session.startTransaction();

    const userUpdate = await User.updateOne(
      { id: userId, points: { $gte: spendFans } },
      { $inc: { points: -spendFans } },
      { session }
    );
    if (userUpdate.matchedCount === 0) throw new Error('Insufficient fans or user not found during debit');

    const updatedEv = await _upsertUserPointsAndHappiness(ev.eventId, userId, points, happinessDelta, session, 1);
    if (!updatedEv) throw new Error('Failed to update event points');

    await BossPointLog.create([{
      eventId: ev.eventId,
      userId,
      oshiId: ev.oshiId,
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

    const freshEv = await BossEvent.findOne({ eventId: ev.eventId }).lean();
    if (client) await refreshEventMessage(client, ev.eventId, freshEv);

    return {
      points,
      spendFans,
      happinessDelta,
      superchatCount: currentCount + 1,
      nextSuperchatMin: superchatCost(nextN + 1)
    };
  } catch (err) {
    try { if (!committed) await session.abortTransaction(); } catch (_) {}
    throw err;
  } finally {
    session.endSession();
  }
}

// -------------------- Settlement helpers --------------------

function escapeRegExp(string) {
  return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeFilenameForMatch(filename) {
  return String(filename)
    .replace(/\.(png|jpg|jpeg)$/i, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\b0*(\d{1,3})\b/g, '')
    .trim()
    .toLowerCase();
}

const lastPickedByRarity = new Map();

async function pickCardFromRarityFolder(rarity, oshiLabel, { avoidImmediateRepeat = true, _visited = null } = {}) {
  try {
    const visited = _visited instanceof Set ? _visited : new Set();
    if (visited.has(rarity)) return null;
    visited.add(rarity);

    const folder = path.join(getAssetsBaseForRarity(rarity), String(rarity).toUpperCase());
    const files = await fs.readdir(folder).catch(() => []);
    if (!files || files.length === 0) {
      const fallback = getNextLowerWeightRarity(rarity, visited);
      return fallback ? pickCardFromRarityFolder(fallback, oshiLabel, { avoidImmediateRepeat, _visited: visited }) : null;
    }

    const target = (oshiLabel || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
    const candidates = files.map(f => ({ raw: f, norm: normalizeFilenameForMatch(f) }));

    const exactMatches = target ? candidates.filter(f => new RegExp(`\\b${escapeRegExp(target)}\\b`).test(f.norm)) : [];
    const partialMatches = target ? candidates.filter(f => f.norm.includes(target)) : [];

    let pool = null;
    let foundAnySpecificMatch = false;

    if (exactMatches.length) {
      pool = exactMatches;
      foundAnySpecificMatch = true;
    } else {
      try {
        const normKey = String(oshiLabel || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
        const exListRaw = EXCEPTIONS[normKey] || EXCEPTIONS[oshiLabel] || EXCEPTIONS[capitalize(oshiLabel || '')];
        const exList = Array.isArray(exListRaw) ? exListRaw.map(e => String(e || '').trim()).filter(Boolean) : [];

        if (exList.length > 0) {
          const matchedSet = new Set();
          for (const exTokenRaw of exList) {
            const isPrefix = typeof exTokenRaw === 'string' && exTokenRaw.endsWith('*');
            const exToken = isPrefix
              ? exTokenRaw.slice(0, -1).toLowerCase().replace(/[^\w\s]/g, '').trim()
              : String(exTokenRaw || '').toLowerCase().replace(/[^\w\s]/g, '').trim();

            if (!exToken) continue;

            const exMatches = candidates.filter(c => {
              if (isPrefix) return c.norm.startsWith(exToken);
              return new RegExp(`\\b${escapeRegExp(exToken)}\\b`).test(c.norm) || c.norm.includes(exToken);
            });

            for (const m of exMatches) matchedSet.add(m.raw);
          }

          if (matchedSet.size > 0) {
            pool = Array.from(matchedSet).map(f => ({ raw: f, norm: normalizeFilenameForMatch(f) }));
            foundAnySpecificMatch = true;
          }
        }
      } catch (_) {}

      if (!pool && partialMatches.length) {
        pool = partialMatches;
        foundAnySpecificMatch = true;
      }
    }

    if (!foundAnySpecificMatch) {
      const fallback = getNextLowerWeightRarity(rarity, visited);
      if (fallback) return pickCardFromRarityFolder(fallback, oshiLabel, { avoidImmediateRepeat, _visited: visited });
      pool = candidates;
    }

    const grouped = new Map();
    for (const item of pool) {
      const key = item.norm;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item.raw);
    }

    const groups = Array.from(grouped.values());
    if (!groups.length) return null;

    const lastKey = `${rarity}::${oshiLabel || ''}`;
    const lastPicked = lastPickedByRarity.get(lastKey);

    let groupIndex = crypto.randomInt(0, groups.length);
    if (avoidImmediateRepeat && lastPicked && groups.length > 1) {
      if (groups[groupIndex].includes(lastPicked)) {
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
    lastPickedByRarity.set(lastKey, rawPick);

    return { name: path.basename(rawPick, path.extname(rawPick)), rarity };

    function capitalize(s) {
      if (!s) return s;
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
  } catch (err) {
    console.error('[pickCardFromRarityFolder] error', err);
    return null;
  }
}

function getNextLowerWeightRarity(currentRarity, visitedSet = null) {
  try {
    if (!currentRarity) return null;
    const curKey = String(currentRarity).trim();
    const idx = RARITY_ORDER.indexOf(curKey);

    if (idx === -1) {
      for (let i = RARITY_ORDER.length - 1; i >= 0; i--) {
        const candidate = RARITY_ORDER[i];
        if (RARITY_EXCLUDE.has(candidate)) continue;
        if (visitedSet && visitedSet.has(candidate)) continue;
        if (candidate === curKey) continue;
        return candidate;
      }
      return null;
    }

    for (let i = idx - 1; i >= 0; i--) {
      const candidate = RARITY_ORDER[i];
      if (RARITY_EXCLUDE.has(candidate)) continue;
      if (visitedSet && visitedSet.has(candidate)) continue;
      return candidate;
    }

    return null;
  } catch (e) {
    console.error('[pickCard] getNextLowerWeightRarity error', e);
    return null;
  }
}

async function pickCardByWeightedRarity(weightMap, oshiLabel, opts = {}) {
  const options = buildWeightedOptionsFromMap(weightMap);
  if (!options.length) return null;

  const candidates = options.slice();
  while (candidates.length) {
    const chosenKey = pickWeighted(candidates);
    const idx = candidates.findIndex(c => c.key === chosenKey);
    if (idx !== -1) candidates.splice(idx, 1);

    const pick = await pickCardFromRarityFolder(chosenKey, oshiLabel, opts);
    if (pick) return pick;
  }
  return null;
}

// -------------------- Settlement --------------------

async function settleEndedEvents(client = null) {
  const toSettle = await BossEvent.find({ status: 'ended' });

  for (const ev of toSettle) {
    try {
      const sorted = (ev.pointsByUser || []).slice().sort((a, b) => {
        if ((b.points || 0) !== (a.points || 0)) return (b.points || 0) - (a.points || 0);
        const ta = a.firstPointAt ? new Date(a.firstPointAt).getTime() : 0;
        const tb = b.firstPointAt ? new Date(b.firstPointAt).getTime() : 0;
        return ta - tb;
      });

      const winners = sorted.slice(0, 3);

      // Participation
      for (const p of (ev.pointsByUser || [])) {
        if ((p.points || 0) <= 0) continue;

        const oshiCfg = oshis.find(o => o.id === ev.oshiId);
        const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

        try {
          const picked = await pickCardByWeightedRarity(PARTICIPATION_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true });
          if (picked && picked.name) {
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
        }
      }

      // 3rd
      if (winners[2]) {
        try {
          const oshiCfg = oshis.find(o => o.id === ev.oshiId);
          const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

          const picked =
            await pickCardByWeightedRarity(THIRDPLACE_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true }) ||
            await pickCardByWeightedRarity(PARTICIPATION_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true });

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

      // 2nd
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
            const picked =
              await pickCardByWeightedRarity(SECONDPLACE_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true }) ||
              await pickCardByWeightedRarity(PARTICIPATION_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true });

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

      // 1st
      if (winners[0]) {
        try {
          const oshiCfg = oshis.find(o => o.id === ev.oshiId);
          const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

          const pickedOri = await pickCardFromRarityFolder('ORI', oshiLabel);
          const cardName = (pickedOri && pickedOri.name) ? pickedOri.name : `${oshiLabel} 001`;

          await addCardToUser(winners[0].userId, cardName, 'ORI', 1);
          await BossPointLog.create({
            eventId: ev.eventId,
            userId: winners[0].userId,
            oshiId: ev.oshiId,
            action: 'reward',
            points: 0,
            meta: { tier: 1, reward: 'ORI', card: cardName }
          });

          const picked2 =
            await pickCardByWeightedRarity(SECONDPLACE_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true }) ||
            await pickCardByWeightedRarity(PARTICIPATION_WEIGHTS, oshiLabel, { avoidImmediateRepeat: true });

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
          console.error('[settle] 1st place reward error for', winners[0]?.userId, err);
        }
      }

      ev.status = 'settled';
      await ev.save();

      await postBossResults(client, ev.eventId);
      //post settlement summary to boss channel
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
                { name: '1st', value: winners[0] ? `<@${winners[0].userId}>` : '-', inline: true },
                { name: '2nd', value: winners[1] ? `<@${winners[1].userId}>` : '-', inline: true },
                { name: '3rd', value: winners[2] ? `<@${winners[2].userId}>` : '-', inline: true }
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

// -------------------- createAndAnnounceEvent --------------------

async function createAndAnnounceEvent(client, oshiId, durationMs = null) {
  const now = new Date();
  const endsAt = new Date(now.getTime() + (typeof durationMs === 'number' ? durationMs : eventDurationMs()));

  const oshiCfg = oshis.find(o => o.id === oshiId) || oshis[Math.floor(Math.random() * oshis.length)];
  const oshiLabel = oshiCfg ? oshiCfg.label : oshiId;

  const eventDoc = await BossEvent.create({
    eventId: nanoid(),
    oshiId,
    spawnAt: now,
    endsAt,
    status: 'active',
    pointsTotal: 0,
    pointsByUser: [],
    imageUrl: buildOshiOsrImageUrl(oshiLabel, 'ORI'),
    happiness: 0,
    createdAt: now
  });

  const { embed, components } = buildBossEmbedAndButtons(eventDoc, oshiLabel);

  const channelId = config.bossChannelId;
  if (!channelId) throw new Error('bossChannelId not configured');

  const ch = await client.channels.fetch(channelId);
  if (!ch || !ch.isTextBased?.()) throw new Error('Configured boss channel is not text-based or unavailable');

  const msg = await ch.send({ embeds: [embed], components: components || [] });

  eventDoc.announceMessageId = msg.id;
  await eventDoc.save();

  console.log(`[createAndAnnounceEvent] spawned event ${eventDoc.eventId} for ${oshiLabel}, announced as message ${msg.id}`);
  return { event: eventDoc, message: msg };
}

// -------------------- Manager start/stop --------------------

let activatorInterval = null;
let settleInterval = null;
let refresherInterval = null;

async function startBossManager(client) {
  // avoid duplicates if hot-reloading
  try { if (activatorInterval) clearInterval(activatorInterval); } catch (_) {}
  try { if (settleInterval) clearInterval(settleInterval); } catch (_) {}
  try { if (refresherInterval) clearInterval(refresherInterval); } catch (_) {}

  activatorInterval = setInterval(async () => {
    try {
      await activateAndEndEvents();
      await announceActivatedEvents(client);
    } catch (e) {
      console.error('activator loop error', e);
    }
  }, 15_000);

  settleInterval = setInterval(async () => {
    try {
      await settleEndedEvents(client);
    } catch (e) {
      console.error('settle loop error', e);
    }
  }, 15_000);

  // refresher every 10 minutes
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

  refresherInterval = setInterval(async () => {
    try {
      const active = await BossEvent.find({ status: 'active' });
      if (!active || active.length === 0) return;

      const ch = await client.channels.fetch(config.bossChannelId).catch(() => null);
      if (!ch || !ch.isTextBased?.()) return;

      for (const ev of active) {
        if (!ev?.announceMessageId) continue;

        const oshiCfg = oshis.find(o => o.id === ev.oshiId);
        const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

        const { embed, components } = buildBossEmbedAndButtons(ev, oshiLabel);
        const newHash = hashEmbedAndComponents(embed, components);
        const lastHash = lastEmbedHashByEvent.get(ev.eventId);
        if (newHash && lastHash === newHash) continue;

        const msg = await ch.messages.fetch(ev.announceMessageId).catch(() => null);
        if (!msg) {
          lastEmbedHashByEvent.delete(ev.eventId);
          continue;
        }

        await msg.edit({ embeds: [embed], components: components || [] }).catch(() => null);
        if (newHash) lastEmbedHashByEvent.set(ev.eventId, newHash);
      }
    } catch (err) {
      console.error('refresher loop error', err);
    }
  }, 600_000);
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

  createAndAnnounceEvent,
  createSuperchatConfirm,
  handleSuperchatInteraction,

  // used elsewhere
  refreshEventMessage,
  buildOshiOsrImageUrl,
  superchatCost,

  // optional / debug
  findActiveEventById,
  findActiveEventForOshi,
  settleEndedEvents,
  eventDurationMs,
};