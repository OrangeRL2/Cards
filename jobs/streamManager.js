// jobs/streamManager.js
// Stream system: Like, Sub, Superchat, SEC membership, contribution tracking,
// scheduled activation, announcements, and settlement.

const { nanoid } = require('nanoid');
const crypto = require('crypto');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');

const StreamEvent = require('../models/StreamEvent');
const StreamActionLog = require('../models/StreamActionLog');
const User = require('../models/User');
const Oshi = require('../models/Oshi');
const oshis = require('../config/oshis');
const imgExceptions = require('../config/imgExceptions.excel');
const config = require('../config.json');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');
const { addOshiOsrToUser } = require('../utils/oshiRewards');
const { postStreamResults } = require('../utils/postStreamResults');

const ASSETS_BASE = path.join(__dirname, '..', 'assets', 'images');
const IMAGE_BASE = process.env.STREAM_IMAGE_BASE || process.env.BOSS_IMAGE_BASE || 'http://152.69.195.48/images';
const STREAM_CHANNEL_ID = config.streamChannelId || config.bossChannelId;
const DEBUG_DURATION_MS = process.env.STREAM_DEBUG_DURATION_MS
  ? Number(process.env.STREAM_DEBUG_DURATION_MS)
  : (process.env.STREAM_DEBUG ? 60 * 1000 : null);

const SESSION_TTL_MS = 5 * 60 * 1000;
const FINAL_ORDER_WINDOW_MS = 15 * 60 * 1000;
const REFRESH_DEBOUNCE_MS = 2000;

const SUB_VALUES = Object.freeze({
  SR: 5,
  OSR: 5,
  SY: 12,
  UR: 15,
  HR: 18,
  OUR: 20,
  BDAY: 22,
});
const SUB_RARITIES = Object.freeze(Object.keys(SUB_VALUES));
const MASS_RARITIES = new Set(SUB_RARITIES);

// Yen is deliberately identical to base Happiness. 1 yen = 10 fans.
const SUPERCHAT_YEN_OPTIONS = Object.freeze([1, 10, 100, 1000, 2500, 5000, 10000, 25000, 50000]);

const RARITY_ORDER = [
  'C', 'U', 'R', 'S', 'RR', 'OC', 'SR', 'OSR', 'P', 'SP', 'SY', 'UR', 'OUR', 'HR', 'BDAY', 'UP', 'SEC'
];
const RARITY_EXCLUDE = new Set(['P', 'SP', 'UP']);
const ASSETS_BASE_BY_RARITY = {
  BDAY: process.env.BDAY_ASSETS_BASE || path.join(__dirname, '..', 'assets', 'montlybdays'),
  OSR: process.env.OSR_ASSETS_BASE || path.join(__dirname, '..', 'assets', 'montlybdays'),
};

const PARTICIPATION_WEIGHTS = {
  C: 35, U: 25, R: 15, S: 10, RR: 5, OC: 5, SR: 2.5, OSR: 2.5,
  SY: 0, UR: 0, OUR: 0, HR: 0, BDAY: 0, SEC: 0,
};
const THIRDPLACE_WEIGHTS = {
  C: 0, U: 0, R: 0, S: 0, RR: 0, OC: 0,
  SR: 0, OSR: 0, SY: 15, UR: 10, OUR: 5, HR: 5, BDAY: 4, SEC: 1,
};
const SECONDPLACE_WEIGHTS = {
  C: 0, U: 0, R: 0, S: 0, RR: 0, OC: 0,
  SR: 0, OSR: 0, SY: 15, UR: 15, OUR: 11, HR: 11, BDAY: 8, SEC: 5,
};

const MANUAL_STREAM_GROUPS = Object.freeze({
  'Hoshimatic Project': Object.freeze([
    'suisei', 'sora', 'matsuri', 'aki', 'subaru', 'towa', 'nene', 'koyori', 'iroha', 'chloe',
  ]),
});

const BASE_EXCEPTIONS = {
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

const subSessions = new Map();
const massSessions = new Map();
const secSessions = new Map();
const refreshTimers = new Map();

function eventDurationMs() {
  return DEBUG_DURATION_MS || (24 * 60 * 60 * 1000);
}

function normalizeExceptionKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCardText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayNameFromOshiId(oshiId) {
  const id = String(oshiId || '').toLowerCase();
  const cfg = oshis.find(o => String(o.id).toLowerCase() === id);
  if (cfg?.label) return cfg.label;
  return String(oshiId || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function resolveOshiConfigByIdOrName(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const rawLower = raw.toLowerCase();
  const rawNorm = normalizeExceptionKey(raw);
  return oshis.find(o =>
    String(o.id).toLowerCase() === rawLower ||
    String(o.label).toLowerCase() === rawLower ||
    normalizeExceptionKey(o.label) === rawNorm
  ) || null;
}

function addException(out, key, values) {
  if (!key) return;
  const cleanValues = (Array.isArray(values) ? values : [values])
    .map(v => String(v || '').trim())
    .filter(Boolean);
  if (!cleanValues.length) return;
  const keys = [String(key).trim(), String(key).trim().toLowerCase(), normalizeExceptionKey(key)].filter(Boolean);
  for (const k of keys) {
    if (!out[k]) out[k] = [];
    for (const v of cleanValues) if (!out[k].includes(v)) out[k].push(v);
  }
}

function buildExceptions() {
  const out = {};
  for (const [key, values] of Object.entries(BASE_EXCEPTIONS)) addException(out, key, values);

  for (const [oshiId, values] of Object.entries(imgExceptions || {})) {
    const oshiLabel = displayNameFromOshiId(oshiId);
    addException(out, oshiLabel, values);
    addException(out, oshiId, values);
    for (const token of values || []) addException(out, token, [oshiLabel]);
  }

  for (const [groupName, memberIds] of Object.entries(MANUAL_STREAM_GROUPS)) {
    const members = memberIds.map(resolveOshiConfigByIdOrName).filter(Boolean);
    addException(out, groupName, members.map(m => m.label));
    for (const member of members) {
      addException(out, member.id, [groupName]);
      addException(out, member.label, [groupName]);
    }
  }
  return out;
}

const EXCEPTIONS = buildExceptions();

function resolveStreamTarget(input = null) {
  if (!input) {
    const random = oshis[Math.floor(Math.random() * oshis.length)];
    return { eventOshiId: random.id, label: random.label, isOshi: true };
  }
  const raw = String(input).trim();
  const rawLower = raw.toLowerCase();
  const rawNorm = normalizeExceptionKey(raw);
  const oshiCfg = resolveOshiConfigByIdOrName(raw);
  if (oshiCfg) return { eventOshiId: oshiCfg.id, label: oshiCfg.label, isOshi: true };
  const hasException = Array.isArray(EXCEPTIONS[raw]) || Array.isArray(EXCEPTIONS[rawLower]) || Array.isArray(EXCEPTIONS[rawNorm]);
  if (hasException) return { eventOshiId: raw, label: raw, isOshi: false };
  return null;
}

function getExceptionListForStreamTarget(target) {
  const raw = String(target || '').trim();
  const list = EXCEPTIONS[raw] || EXCEPTIONS[raw.toLowerCase()] || EXCEPTIONS[normalizeExceptionKey(raw)] || [];
  return Array.isArray(list) ? list : [];
}

function getStreamMemberIds(target) {
  const direct = resolveOshiConfigByIdOrName(target);
  if (direct?.id) return [String(direct.id).toLowerCase()];
  const ids = new Set();
  for (const token of getExceptionListForStreamTarget(target)) {
    const cfg = resolveOshiConfigByIdOrName(token);
    if (cfg?.id) ids.add(String(cfg.id).toLowerCase());
  }
  return Array.from(ids);
}

function formatOshiNames(ids) {
  return (ids || []).map(id => {
    const cfg = resolveOshiConfigByIdOrName(id);
    return cfg?.label || id;
  }).join(' / ');
}

function getUserState(ev, userId, create = false) {
  let state = (ev.users || []).find(s => s.userId === userId);
  if (!state && create) {
    ev.users.push({ userId });
    state = ev.users[ev.users.length - 1];
  }
  return state || null;
}

function isAutoMember(oshiDoc, ev) {
  const id = String(oshiDoc?.oshiId || '').toLowerCase();
  return Boolean(id && getStreamMemberIds(ev.oshiId).includes(id));
}

function membershipInfo(oshiDoc, ev, state = null) {
  const auto = isAutoMember(oshiDoc, ev);
  const manual = Boolean(state?.memberSince);
  return {
    active: auto || manual,
    auto,
    manual,
    memberOshiId: auto ? String(oshiDoc?.oshiId || '').toLowerCase() : (state?.memberOshiId || null),
  };
}

function memberAdjustedCardValue(base, isMember) {
  return isMember ? Math.ceil(base * 1.10) : base;
}

function isFinalOrderWindow(ev, now = Date.now()) {
  const end = new Date(ev.endsAt).getTime();
  return end > now && (end - now) <= FINAL_ORDER_WINDOW_MS;
}

function cardMatchesOshi(cardName, oshiId) {
  const cfg = resolveOshiConfigByIdOrName(oshiId);
  if (!cfg) return false;
  const card = normalizeCardText(cardName);
  const label = normalizeCardText(cfg.label);
  const id = normalizeCardText(cfg.id);
  return Boolean(
    (label && (card === label || card.startsWith(`${label} `))) ||
    (id && (card === id || card.startsWith(`${id} `)))
  );
}

function streamMemberForCard(cardName, ev) {
  return getStreamMemberIds(ev.oshiId).find(id => cardMatchesOshi(cardName, id)) || null;
}

function buildImageUrl(oshiLabel, rarity = 'ORI') {
  const cardName = `${String(oshiLabel || '').trim()} 001`;
  return `${IMAGE_BASE.replace(/\/$/, '')}/${encodeURIComponent(String(rarity).trim())}/${encodeURIComponent(cardName)}.png`;
}

function streamLabel(ev) {
  return resolveOshiConfigByIdOrName(ev.oshiId)?.label || ev.oshiId;
}

function buildStreamEmbedAndButtons(ev) {
  const label = streamLabel(ev);
  const endTs = Math.floor(new Date(ev.endsAt).getTime() / 1000);
  const embed = new EmbedBuilder()
    .setTitle(`${label} has started a 24 hour stream!`)
    .setDescription(
      `Support **${label}** with Likes, Subs, and Superchats.\n` +
      `💸 **¥1 = 10 fans = 1 Happiness**`
    )
    .setColor(0x5AB3F4)
    .setImage(ev.imageUrl || buildImageUrl(label, 'ORI'))
    .addFields(
      { name: 'Ends', value: `<t:${endTs}:R>`, inline: true },
      { name: '❤️ Happiness', value: Number(ev.happiness || 0).toLocaleString(), inline: true },
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`stream\n${ev.eventId}\nlike`).setLabel('Like').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`stream\n${ev.eventId}\nsub`).setLabel('Sub').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`stream\n${ev.eventId}\nsuperchat`).setLabel('Superchat').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`stream\n${ev.eventId}\nsec`).setLabel('SEC Gift').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`stream\n${ev.eventId}\ncontribution`).setLabel('Contribution').setStyle(ButtonStyle.Secondary),
  );
  return { embed, components: [row] };
}

async function findActiveEventById(eventId) {
  if (!eventId) return null;
  const ev = await StreamEvent.findOne({ eventId: String(eventId) }).exec();
  if (!ev) return null;
  const now = Date.now();
  if (ev.status !== 'active') return null;
  if (new Date(ev.spawnAt).getTime() > now) return null;
  if (new Date(ev.endsAt).getTime() <= now) return null;
  return ev;
}

async function requireActiveEvent(eventId) {
  const ev = await findActiveEventById(eventId);
  if (!ev) throw new Error('This stream is no longer active.');
  return ev;
}

function sessionKey(eventId, userId) {
  return `${eventId}:${userId}`;
}

function createSession(map, eventId, userId, seed = {}) {
  const key = sessionKey(eventId, userId);
  const session = { ...seed, eventId, userId, token: nanoid(8), expiresAt: Date.now() + SESSION_TTL_MS };
  map.set(key, session);
  setTimeout(() => {
    const current = map.get(key);
    if (current && current.token === session.token && current.expiresAt <= Date.now()) map.delete(key);
  }, SESSION_TTL_MS + 1000).unref?.();
  return session;
}

function getSession(map, eventId, userId) {
  const key = sessionKey(eventId, userId);
  const session = map.get(key);
  if (!session || session.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function deleteAllSessions(eventId, userId) {
  const key = sessionKey(eventId, userId);
  subSessions.delete(key);
  massSessions.delete(key);
  secSessions.delete(key);
}

async function ephemeralReply(interaction, payload) {
  const opts = { ...payload, ephemeral: true };
  if (interaction.replied || interaction.deferred) return interaction.followUp(opts);
  return interaction.reply(opts);
}

async function safeUpdate(interaction, payload) {
  if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) return interaction.update(payload);
  return interaction.editReply(payload);
}

function scheduleRefresh(client, eventId) {
  if (!client || refreshTimers.has(eventId)) return;
  const timer = setTimeout(async () => {
    refreshTimers.delete(eventId);
    try { await refreshEventMessage(client, eventId); } catch (err) { console.error('[stream] refresh error', err); }
  }, REFRESH_DEBOUNCE_MS);
  timer.unref?.();
  refreshTimers.set(eventId, timer);
}

async function refreshEventMessage(client, eventId, evOverride = null) {
  const ev = evOverride || await StreamEvent.findOne({ eventId }).lean();
  if (!ev?.announceMessageId || !STREAM_CHANNEL_ID) return false;
  const ch = await client.channels.fetch(STREAM_CHANNEL_ID).catch(() => null);
  if (!ch?.isTextBased?.()) return false;
  const msg = await ch.messages.fetch(ev.announceMessageId).catch(() => null);
  if (!msg) return false;
  const { embed, components } = buildStreamEmbedAndButtons(ev);
  await msg.edit({ embeds: [embed], components });
  return true;
}

function ensureFirstHappiness(state, delta) {
  if (delta > 0 && !state.firstHappinessAt) state.firstHappinessAt = new Date();
}

async function handleLike({ userId, eventId, client = null }) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const ev = await StreamEvent.findOne({ eventId }).session(session);
      if (!ev || ev.status !== 'active' || new Date(ev.endsAt).getTime() <= Date.now()) throw new Error('This stream is no longer active.');
      const oshiDoc = await Oshi.findOne({ userId }).session(session).lean();
      if (!oshiDoc?.oshiId) throw new Error('You need to choose an Oshi before liking a stream.');

      const level = Math.max(0, Math.floor(Number(oshiDoc.level) || 0));
      const cappedLevel = Math.min(level, 100);
      const matchingOshi = isAutoMember(oshiDoc, ev);
      const happiness = cappedLevel * (matchingOshi ? 2 : 1);

      await StreamActionLog.create([{
        eventId, userId, oshiId: ev.oshiId, action: 'like', happiness,
        meta: {
          oshiId: oshiDoc.oshiId,
          oshiLevel: level,
          effectiveLikeLevel: cappedLevel,
          matchingOshi,
          multiplier: matchingOshi ? 2 : 1,
        },
      }], { session });

      const state = getUserState(ev, userId, true);
      state.happiness += happiness;
      state.likeHappiness += happiness;
      ensureFirstHappiness(state, happiness);
      ev.happiness += happiness;
      await ev.save({ session });
      result = { happiness, level, matchingOshi };
    });
  } catch (err) {
    if (err?.code === 11000) throw new Error('You have already liked this stream.');
    throw err;
  } finally {
    await session.endSession();
  }
  scheduleRefresh(client, eventId);
  return result;
}

function summarizeCart(cart) {
  return Array.from(cart.values()).sort((a, b) => {
    const rd = SUB_RARITIES.indexOf(a.rarity) - SUB_RARITIES.indexOf(b.rarity);
    if (rd !== 0) return rd;
    return a.name.localeCompare(b.name);
  });
}

function cartText(session, member = false) {
  const items = summarizeCart(session.cart || new Map());
  if (!items.length) return '**Current offering:** Empty';
  let base = 0;
  let final = 0;
  const lines = items.map(item => {
    const b = SUB_VALUES[item.rarity] * item.count;
    const f = memberAdjustedCardValue(SUB_VALUES[item.rarity], member) * item.count;
    base += b;
    final += f;
    return `• [${item.rarity}] ${item.name} ×${item.count}`;
  });
  return `**Current offering**\n${lines.join('\n')}\n\nBase Happiness: **${base}**${member ? `\nMember Happiness: **${final}**` : ''}`;
}

async function getOwnedSubCards(userId, rarity, includeLocked = false) {
  const user = await User.findOne({ id: userId }).lean();
  if (!user) return [];
  return (user.cards || [])
    .filter(c => c.rarity === rarity && Number(c.count || 0) > 0 && (includeLocked || !c.locked))
    .sort((a, b) => {
      if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0);
      return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
    });
}

async function showSubRarityMenu(interaction, eventId, userId, useUpdate = true) {
  const ev = await requireActiveEvent(eventId);
  let session = getSession(subSessions, eventId, userId);
  if (!session) session = createSession(subSessions, eventId, userId, { cart: new Map(), rarity: null, page: 0, optionMap: new Map() });

  const user = await User.findOne({ id: userId }).lean();
  const available = new Set((user?.cards || []).filter(c => SUB_RARITIES.includes(c.rarity) && c.count > 0 && !c.locked).map(c => c.rarity));
  if (!available.size && !session.cart.size) {
    const payload = { content: 'You have no unlocked SR+ cards available to gift.', components: [] };
    return useUpdate ? safeUpdate(interaction, payload) : ephemeralReply(interaction, payload);
  }

  const options = SUB_RARITIES.filter(r => available.has(r)).map(r => ({
    label: `${r} — ${SUB_VALUES[r]} Happiness`, value: r,
  }));
  const rows = [];
  if (options.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`stream\n${eventId}\nsub_rarity\n${userId}`)
        .setPlaceholder('Choose a rarity')
        .addOptions(options)
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nsub_complete\n${userId}`).setLabel('Complete').setStyle(ButtonStyle.Success).setDisabled(!session.cart.size),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nsub_cancel\n${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  ));

  const oshiDoc = await Oshi.findOne({ userId }).lean();
  const state = getUserState(ev, userId, false);
  const member = membershipInfo(oshiDoc, ev, state).active;
  const payload = { content: `Choose the rarity you want to gift.\n\n${cartText(session, member)}`, components: rows };
  return useUpdate ? safeUpdate(interaction, payload) : ephemeralReply(interaction, payload);
}

async function showSubCardMenu(interaction, eventId, userId) {
  const ev = await requireActiveEvent(eventId);
  const session = getSession(subSessions, eventId, userId);
  if (!session?.rarity) return showSubRarityMenu(interaction, eventId, userId, true);

  const owned = await getOwnedSubCards(userId, session.rarity, false);
  const eligible = owned.filter(c => {
    const key = `${c.rarity}\u001f${c.name}`;
    return Number(c.count || 0) > Number(session.cart.get(key)?.count || 0);
  });

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(eligible.length / pageSize));
  session.page = Math.max(0, Math.min(session.page || 0, totalPages - 1));
  const pageCards = eligible.slice(session.page * pageSize, (session.page + 1) * pageSize);
  session.optionMap = new Map();

  const rows = [];
  if (pageCards.length) {
    const options = pageCards.map(card => {
      const key = `${card.rarity}\u001f${card.name}`;
      const reserved = Number(session.cart.get(key)?.count || 0);
      const remaining = Math.max(0, Number(card.count || 0) - reserved);
      const token = nanoid(8);
      session.optionMap.set(token, { name: card.name, rarity: card.rarity });
      return { label: `${card.name} ×${remaining}`.slice(0, 100), value: token, description: `${card.rarity} • ${SUB_VALUES[card.rarity]} Happiness each` };
    });
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`stream\n${eventId}\nsub_card\n${userId}`)
        .setPlaceholder(`Select a ${session.rarity} card`)
        .addOptions(options)
    ));
  }

  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nsub_prev\n${userId}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(session.page <= 0),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nsub_next\n${userId}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(session.page >= totalPages - 1),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nsub_change_rarity\n${userId}`).setLabel('Change Rarity').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nsub_complete\n${userId}`).setLabel('Complete').setStyle(ButtonStyle.Success).setDisabled(!session.cart.size),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nsub_cancel\n${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
  );
  rows.push(nav);

  const oshiDoc = await Oshi.findOne({ userId }).lean();
  const member = membershipInfo(oshiDoc, ev, getUserState(ev, userId, false)).active;
  const emptyNote = pageCards.length ? '' : `\n\n_No more ${session.rarity} cards are available in this offering._`;
  return safeUpdate(interaction, {
    content: `${cartText(session, member)}${emptyNote}\n\nPage ${session.page + 1}/${totalPages}`,
    components: rows,
  });
}

async function handleSubCardSelection(interaction, eventId, userId, token) {
  const session = getSession(subSessions, eventId, userId);
  if (!session) return safeUpdate(interaction, { content: 'This Sub selection expired. Press Sub again.', components: [] });
  const selected = session.optionMap?.get(token);
  if (!selected) return safeUpdate(interaction, { content: 'That card selection expired. Please reopen the card list.', components: [] });

  const user = await User.findOne({ id: userId }).lean();
  const card = (user?.cards || []).find(c => c.name === selected.name && c.rarity === selected.rarity && c.count > 0 && !c.locked);
  if (!card) return safeUpdate(interaction, { content: 'That card is no longer available or is locked.', components: [] });

  const key = `${card.rarity}\u001f${card.name}`;
  const reserved = Number(session.cart.get(key)?.count || 0);
  const remaining = Math.max(0, Number(card.count || 0) - reserved);
  if (remaining <= 0) return showSubCardMenu(interaction, eventId, userId);

  if (remaining === 1) {
    session.cart.set(key, { name: card.name, rarity: card.rarity, count: reserved + 1 });
    return showSubCardMenu(interaction, eventId, userId);
  }

  const options = [];
  if (remaining <= 25) {
    for (let i = 1; i <= remaining; i++) options.push({ label: String(i), value: String(i) });
  } else {
    for (let i = 1; i <= 24; i++) options.push({ label: String(i), value: String(i) });
    options.push({ label: `All (${remaining})`, value: String(remaining) });
  }
  session.pendingCard = { name: card.name, rarity: card.rarity, key, reserved, remaining };

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`stream\n${eventId}\nsub_quantity\n${userId}`)
      .setPlaceholder(`How many ${card.name}?`)
      .addOptions(options)
  );
  return safeUpdate(interaction, {
    content: `${cartText(session)}\n\nYou own **${remaining}** available copies of **[${card.rarity}] ${card.name}**. Choose a quantity.`,
    components: [row],
  });
}

async function confirmNormalSub(interaction, eventId, userId) {
  const sessionData = getSession(subSessions, eventId, userId);
  if (!sessionData?.cart?.size) return safeUpdate(interaction, { content: 'Your offering is empty.', components: [] });
  const requested = summarizeCart(sessionData.cart).map(x => ({ ...x }));

  const dbSession = await mongoose.startSession();
  let awarded = 0;
  let baseTotal = 0;
  let cardCount = 0;
  let member = false;
  try {
    await dbSession.withTransaction(async () => {
      const ev = await StreamEvent.findOne({ eventId }).session(dbSession);
      if (!ev || ev.status !== 'active' || new Date(ev.endsAt).getTime() <= Date.now()) throw new Error('This stream is no longer active.');
      const user = await User.findOne({ id: userId }).session(dbSession);
      if (!user) throw new Error('User inventory not found.');
      const oshiDoc = await Oshi.findOne({ userId }).session(dbSession).lean();
      const state = getUserState(ev, userId, true);
      member = membershipInfo(oshiDoc, ev, state).active;

      const logCards = [];
      for (const req of requested) {
        const card = user.cards.find(c => c.name === req.name && c.rarity === req.rarity);
        if (!card || card.locked || Number(card.count || 0) < req.count) throw new Error(`[${req.rarity}] ${req.name} is no longer available in the requested quantity.`);
        const baseEach = SUB_VALUES[req.rarity];
        if (!baseEach) throw new Error(`${req.rarity} is not valid for Sub.`);
        const finalEach = memberAdjustedCardValue(baseEach, member);
        card.count -= req.count;
        baseTotal += baseEach * req.count;
        awarded += finalEach * req.count;
        cardCount += req.count;
        logCards.push({ name: req.name, rarity: req.rarity, count: req.count, baseHappinessEach: baseEach, finalHappinessEach: finalEach });
      }
      user.cards = user.cards.filter(c => Number(c.count || 0) > 0);
      await user.save({ session: dbSession });

      state.happiness += awarded;
      state.subCardsGifted += cardCount;
      state.subHappiness += awarded;
      ensureFirstHappiness(state, awarded);
      ev.happiness += awarded;
      await ev.save({ session: dbSession });

      await StreamActionLog.create([{
        eventId, userId, oshiId: ev.oshiId, action: 'sub', happiness: awarded,
        meta: { mode: 'selected', cards: logCards, cardCount, baseHappiness: baseTotal, memberBonus: member, finalHappiness: awarded },
      }], { session: dbSession });
    });
  } finally {
    await dbSession.endSession();
  }

  subSessions.delete(sessionKey(eventId, userId));
  scheduleRefresh(interaction.client, eventId);
  return safeUpdate(interaction, {
    content: `Sub complete. **${cardCount}** card${cardCount === 1 ? '' : 's'} gifted for **+${awarded} Happiness**${member ? ' (membership bonus applied per card)' : ''}.`,
    components: [],
  });
}

function massEligibleStacks(userDoc, { rarity, multiOnly, allowLocked }) {
  return (userDoc?.cards || [])
    .filter(c => MASS_RARITIES.has(c.rarity) && (!rarity || c.rarity === rarity) && Number(c.count || 0) > 0 && (allowLocked || !c.locked))
    .map(c => ({
      name: c.name,
      rarity: c.rarity,
      locked: Boolean(c.locked),
      available: multiOnly ? Math.max(0, Number(c.count || 0) - 1) : Number(c.count || 0),
    }))
    .filter(c => c.available > 0);
}

function totalAvailableCopies(stacks) {
  return stacks.reduce((sum, c) => sum + c.available, 0);
}

function buildMassQuantityOptions(total) {
  if (total <= 0) return [];
  if (total <= 25) return Array.from({ length: total }, (_, i) => ({ label: String(i + 1), value: String(i + 1) }));
  const presets = [1, 5, 10, 25, 50, 100, 250, 500].filter(n => n <= total);
  const uniq = Array.from(new Set(presets));
  if (!uniq.includes(total)) uniq.push(total);
  return uniq.slice(0, 25).map(n => ({ label: n === total ? `Max (${n})` : String(n), value: String(n) }));
}

async function showMassRarityMenu(interaction, eventId, userId, useUpdate = true) {
  await requireActiveEvent(eventId);
  let session = getSession(massSessions, eventId, userId);
  if (!session) session = createSession(massSessions, eventId, userId, { rarity: null, quantity: null, multiOnly: true, allowLocked: false, preview: null });

  const user = await User.findOne({ id: userId }).lean();
  const available = new Set((user?.cards || [])
    .filter(c => MASS_RARITIES.has(c.rarity) && Number(c.count || 0) > 0)
    .map(c => c.rarity));
  const options = SUB_RARITIES
    .filter(r => available.has(r))
    .map(r => ({ label: `${r} — ${SUB_VALUES[r]} Happiness each`, value: r }));

  if (!options.length) {
    const payload = { content: 'You have no SR+ cards available for Mass Gift.', components: [] };
    return useUpdate ? safeUpdate(interaction, payload) : ephemeralReply(interaction, payload);
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`stream\n${eventId}\nmass_rarity\n${userId}`)
      .setPlaceholder(session.rarity ? `Rarity: ${session.rarity}` : 'Select rarity for Mass Gift')
      .addOptions(options)
  );
  const payload = {
    content: '**Mass Gift**\nChoose which rarity you want the random gift to use.',
    components: [row],
  };
  return useUpdate ? safeUpdate(interaction, payload) : ephemeralReply(interaction, payload);
}

async function showMassConfig(interaction, eventId, userId, useUpdate = true) {
  await requireActiveEvent(eventId);
  let session = getSession(massSessions, eventId, userId);
  if (!session) session = createSession(massSessions, eventId, userId, { rarity: null, quantity: null, multiOnly: true, allowLocked: false, preview: null });
  if (!session.rarity || !SUB_RARITIES.includes(session.rarity)) return showMassRarityMenu(interaction, eventId, userId, useUpdate);
  const user = await User.findOne({ id: userId }).lean();
  const total = totalAvailableCopies(massEligibleStacks(user, session));
  if (session.quantity && session.quantity > total) session.quantity = null;

  const quantityOptions = buildMassQuantityOptions(total);
  const rows = [];
  if (quantityOptions.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`stream\n${eventId}\nmass_quantity\n${userId}`)
        .setPlaceholder(session.quantity ? `Quantity: ${session.quantity}` : 'Select quantity')
        .addOptions(quantityOptions)
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nmass_multi\n${userId}`).setLabel(`Multi only: ${session.multiOnly ? 'ON' : 'OFF'}`).setStyle(session.multiOnly ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nmass_locked\n${userId}`).setLabel(`Allow locked: ${session.allowLocked ? 'ON' : 'OFF'}`).setStyle(session.allowLocked ? ButtonStyle.Danger : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nmass_preview\n${userId}`).setLabel('Preview').setStyle(ButtonStyle.Primary).setDisabled(!session.quantity || session.quantity > total),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nmass_change_rarity\n${userId}`).setLabel('Change Rarity').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nmass_cancel\n${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  ));

  const text = [
    `**Mass ${session.rarity} Gift**`,
    `Rarity: **${session.rarity}** (${SUB_VALUES[session.rarity]} Happiness each)`,
    `Eligible copies: **${total}**`,
    `Quantity: **${session.quantity || 'not selected'}**`,
    `Multi only: **${session.multiOnly ? 'ON' : 'OFF'}**${session.multiOnly ? ' (keeps one copy of every stack)' : ''}`,
    `Allow locked: **${session.allowLocked ? 'ON' : 'OFF'}**`,
    '',
    'Cards are selected randomly from the matching copies. Nothing is consumed until you confirm the preview.',
  ].join('\n');
  const payload = { content: text, components: rows };
  return useUpdate ? safeUpdate(interaction, payload) : ephemeralReply(interaction, payload);
}

function randomMassPreview(stacks, quantity) {
  const working = stacks.map(x => ({ ...x }));
  const picked = new Map();
  for (let i = 0; i < quantity; i++) {
    const total = totalAvailableCopies(working);
    if (total <= 0) break;
    let roll = crypto.randomInt(total);
    let chosen = null;
    for (const stack of working) {
      if (roll < stack.available) { chosen = stack; break; }
      roll -= stack.available;
    }
    if (!chosen) break;
    chosen.available -= 1;
    const key = `${chosen.rarity}\u001f${chosen.name}`;
    const old = picked.get(key) || { name: chosen.name, rarity: chosen.rarity, count: 0, locked: chosen.locked };
    old.count += 1;
    picked.set(key, old);
  }
  return Array.from(picked.values());
}

async function showMassPreview(interaction, eventId, userId) {
  const ev = await requireActiveEvent(eventId);
  const session = getSession(massSessions, eventId, userId);
  if (!session?.quantity) return showMassConfig(interaction, eventId, userId, true);
  const user = await User.findOne({ id: userId }).lean();
  const stacks = massEligibleStacks(user, session);
  const total = totalAvailableCopies(stacks);
  if (session.quantity > total) return safeUpdate(interaction, { content: `Only ${total} eligible copies remain. Choose a new quantity.`, components: [] });
  session.preview = randomMassPreview(stacks, session.quantity);

  const oshiDoc = await Oshi.findOne({ userId }).lean();
  const member = membershipInfo(oshiDoc, ev, getUserState(ev, userId, false)).active;
  const baseEach = SUB_VALUES[session.rarity];
  const base = session.quantity * baseEach;
  const final = session.quantity * memberAdjustedCardValue(baseEach, member);
  const lines = session.preview.map(x => `• [${x.rarity}] ${x.name} ×${x.count}${x.locked ? ' 🔒' : ''}`);
  const content = [
    `**Mass Gift Preview — ${session.quantity} cards**`,
    '',
    ...lines,
    '',
    `Base Happiness: **${base}**`,
    ...(member ? [`Member Happiness: **${final}**`] : []),
  ].join('\n').slice(0, 3900);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nmass_confirm\n${userId}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nmass_reroll\n${userId}`).setLabel('Reroll').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nmass_back\n${userId}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nmass_cancel\n${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
  );
  return safeUpdate(interaction, { content, components: [row] });
}

async function confirmMassSub(interaction, eventId, userId) {
  const mass = getSession(massSessions, eventId, userId);
  if (!mass?.preview?.length || !mass.quantity) return safeUpdate(interaction, { content: 'This mass-gift preview expired. Press Sub again.', components: [] });
  const preview = mass.preview.map(x => ({ ...x }));

  const dbSession = await mongoose.startSession();
  let happiness = 0;
  let member = false;
  try {
    await dbSession.withTransaction(async () => {
      const ev = await StreamEvent.findOne({ eventId }).session(dbSession);
      if (!ev || ev.status !== 'active' || new Date(ev.endsAt).getTime() <= Date.now()) throw new Error('This stream is no longer active.');
      const user = await User.findOne({ id: userId }).session(dbSession);
      if (!user) throw new Error('User inventory not found.');
      const oshiDoc = await Oshi.findOne({ userId }).session(dbSession).lean();
      const state = getUserState(ev, userId, true);
      member = membershipInfo(oshiDoc, ev, state).active;

      for (const req of preview) {
        const card = user.cards.find(c => c.name === req.name && c.rarity === req.rarity);
        if (!card || !MASS_RARITIES.has(card.rarity) || card.rarity !== mass.rarity) throw new Error(`[${req.rarity}] ${req.name} is no longer available.`);
        if (!mass.allowLocked && card.locked) throw new Error(`[${req.rarity}] ${req.name} is now locked. Generate a new preview.`);
        if (Number(card.count || 0) < req.count) throw new Error(`[${req.rarity}] ${req.name} no longer has enough copies.`);
        if (mass.multiOnly && Number(card.count || 0) - req.count < 1) throw new Error(`[${req.rarity}] ${req.name} can no longer satisfy Multi only.`);
        card.count -= req.count;
      }
      user.cards = user.cards.filter(c => Number(c.count || 0) > 0);
      await user.save({ session: dbSession });

      const baseEach = SUB_VALUES[mass.rarity];
      const finalEach = memberAdjustedCardValue(baseEach, member);
      happiness = mass.quantity * finalEach;
      state.happiness += happiness;
      state.subCardsGifted += mass.quantity;
      state.subHappiness += happiness;
      ensureFirstHappiness(state, happiness);
      ev.happiness += happiness;
      await ev.save({ session: dbSession });

      await StreamActionLog.create([{
        eventId, userId, oshiId: ev.oshiId, action: 'sub', happiness,
        meta: {
          mode: 'mass', rarity: mass.rarity, cards: preview, cardCount: mass.quantity,
          multiOnly: mass.multiOnly, allowLocked: mass.allowLocked,
          baseHappiness: mass.quantity * SUB_VALUES[mass.rarity], memberBonus: member, finalHappiness: happiness,
        },
      }], { session: dbSession });
    });
  } finally {
    await dbSession.endSession();
  }

  massSessions.delete(sessionKey(eventId, userId));
  scheduleRefresh(interaction.client, eventId);
  return safeUpdate(interaction, {
    content: `Mass Sub complete. **${mass.quantity} [${mass.rarity}]** card${mass.quantity === 1 ? '' : 's'} gifted for **+${happiness} Happiness**${member ? '\n✨ Membership bonus applied (+10% per card).' : ''}`,
    components: [],
  });
}

async function showSecGiftMenu(interaction, eventId, userId, useUpdate = false) {
  const ev = await requireActiveEvent(eventId);
  const oshiDoc = await Oshi.findOne({ userId }).lean();
  const state = getUserState(ev, userId, false);
  const member = membershipInfo(oshiDoc, ev, state);
  if (member.auto) {
    const label = resolveOshiConfigByIdOrName(oshiDoc.oshiId)?.label || oshiDoc.oshiId;
    const payload = { content: `You already have membership for this stream because **${label}** is your Oshi. No SEC is needed.`, components: [] };
    return useUpdate ? safeUpdate(interaction, payload) : ephemeralReply(interaction, payload);
  }
  if (member.manual) {
    const label = resolveOshiConfigByIdOrName(state.memberOshiId)?.label || state.memberOshiId || 'this stream';
    const payload = { content: `Your SEC membership is already active${label ? ` through **${label}**` : ''}.`, components: [] };
    return useUpdate ? safeUpdate(interaction, payload) : ephemeralReply(interaction, payload);
  }

  const user = await User.findOne({ id: userId }).lean();
  const cards = (user?.cards || []).filter(c => c.rarity === 'SEC' && c.count > 0 && !c.locked)
    .map(c => ({ ...c, streamMemberId: streamMemberForCard(c.name, ev) }))
    .filter(c => c.streamMemberId)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));

  if (!cards.length) {
    const members = formatOshiNames(getStreamMemberIds(ev.oshiId));
    const payload = { content: `You need an unlocked SEC belonging to a member of this stream${members ? ` (**${members}**)` : ''} to activate membership.`, components: [] };
    return useUpdate ? safeUpdate(interaction, payload) : ephemeralReply(interaction, payload);
  }

  let session = getSession(secSessions, eventId, userId);
  if (!session) session = createSession(secSessions, eventId, userId, { page: 0, optionMap: new Map(), selected: null });
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(cards.length / pageSize));
  session.page = Math.max(0, Math.min(session.page || 0, totalPages - 1));
  session.optionMap = new Map();
  const pageCards = cards.slice(session.page * pageSize, (session.page + 1) * pageSize);
  const options = pageCards.map(card => {
    const token = nanoid(8);
    session.optionMap.set(token, { name: card.name, memberOshiId: card.streamMemberId });
    return { label: `${card.name}${card.count > 1 ? ` ×${card.count}` : ''}`.slice(0, 100), value: token, description: 'SEC • gifts 1 copy' };
  });
  const rows = [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`stream\n${eventId}\nsec_select\n${userId}`)
      .setPlaceholder('Choose the SEC to gift')
      .addOptions(options)
  )];
  if (totalPages > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`stream\n${eventId}\nsec_prev\n${userId}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(session.page <= 0),
      new ButtonBuilder().setCustomId(`stream\n${eventId}\nsec_next\n${userId}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(session.page >= totalPages - 1),
      new ButtonBuilder().setCustomId(`stream\n${eventId}\nsec_cancel\n${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
    ));
  }
  const payload = {
    content: `Gift **1 SEC belonging to a member of this stream** to activate +10% Happiness on future Subs and Superchats.\nPage ${session.page + 1}/${totalPages}`,
    components: rows,
  };
  return useUpdate ? safeUpdate(interaction, payload) : ephemeralReply(interaction, payload);
}

async function confirmSecGift(interaction, eventId, userId) {
  const sec = getSession(secSessions, eventId, userId);
  if (!sec?.selected) return safeUpdate(interaction, { content: 'That SEC selection expired. Press SEC Gift again.', components: [] });
  const selected = { ...sec.selected };
  const dbSession = await mongoose.startSession();
  let memberLabel = selected.memberOshiId;
  try {
    await dbSession.withTransaction(async () => {
      const ev = await StreamEvent.findOne({ eventId }).session(dbSession);
      if (!ev || ev.status !== 'active' || new Date(ev.endsAt).getTime() <= Date.now()) throw new Error('This stream is no longer active.');
      const oshiDoc = await Oshi.findOne({ userId }).session(dbSession).lean();
      const state = getUserState(ev, userId, true);
      if (isAutoMember(oshiDoc, ev)) throw new Error('Your matching Oshi already gives you membership for this stream.');
      if (state.memberSince) throw new Error('Your SEC membership is already active for this stream.');
      const actualMember = streamMemberForCard(selected.name, ev);
      if (!actualMember || actualMember !== selected.memberOshiId) throw new Error('That SEC no longer matches a member of this stream.');

      const user = await User.findOne({ id: userId }).session(dbSession);
      const card = user?.cards?.find(c => c.name === selected.name && c.rarity === 'SEC');
      if (!card || card.locked || card.count < 1) throw new Error('That SEC is no longer available or is locked.');
      card.count -= 1;
      user.cards = user.cards.filter(c => Number(c.count || 0) > 0);
      await user.save({ session: dbSession });

      state.memberOshiId = actualMember;
      state.memberSince = new Date();
      await ev.save({ session: dbSession });
      await StreamActionLog.create([{
        eventId, userId, oshiId: ev.oshiId, action: 'member', happiness: 0,
        meta: { method: 'sec_gift', card: selected.name, rarity: 'SEC', memberOshiId: actualMember, activatedAt: state.memberSince },
      }], { session: dbSession });
      memberLabel = resolveOshiConfigByIdOrName(actualMember)?.label || actualMember;
    });
  } catch (err) {
    if (err?.code === 11000) throw new Error('Your SEC membership is already active for this stream.');
    throw err;
  } finally {
    await dbSession.endSession();
  }
  secSessions.delete(sessionKey(eventId, userId));
  return safeUpdate(interaction, {
    content: `Membership activated through **${memberLabel}**. Future Subs and Superchats in this stream receive **+10% Happiness**. Previous Happiness and Likes are unchanged.`,
    components: [],
  });
}

async function showSuperchatMenu(interaction, eventId, userId, useUpdate = false) {
  const ev = await requireActiveEvent(eventId);
  const oshiDoc = await Oshi.findOne({ userId }).lean();
  const state = getUserState(ev, userId, false);
  const member = membershipInfo(oshiDoc, ev, state);
  const lastOrder = isFinalOrderWindow(ev);
  const allowed = (lastOrder && !member.active) ? SUPERCHAT_YEN_OPTIONS.filter(y => y <= 10) : SUPERCHAT_YEN_OPTIONS;
  const options = allowed.map(y => ({
    label: `¥${y.toLocaleString()}`,
    value: String(y),
    description: `${(y * 10).toLocaleString()} fans • ${y.toLocaleString()} base Happiness`,
  }));
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`stream\n${eventId}\nsuperchat_select\n${userId}`)
      .setPlaceholder('Choose a Superchat amount')
      .addOptions(options)
  );
  const notes = [];
  if (lastOrder && !member.active) notes.push('⏰ Final 15 minutes: bulk Superchats require stream membership; available amounts are ¥1 / ¥10.');
  const payload = { content: `**Send a Superchat**\n¥1 = 10 fans = 1 base Happiness\n${notes.join('\n')}`, components: [row] };
  return useUpdate ? safeUpdate(interaction, payload) : ephemeralReply(interaction, payload);
}

async function showSuperchatConfirm(interaction, eventId, userId, yen) {
  const ev = await requireActiveEvent(eventId);
  if (!SUPERCHAT_YEN_OPTIONS.includes(yen)) return safeUpdate(interaction, { content: 'Invalid Superchat amount.', components: [] });
  const oshiDoc = await Oshi.findOne({ userId }).lean();
  const state = getUserState(ev, userId, false);
  const member = membershipInfo(oshiDoc, ev, state);
  if (isFinalOrderWindow(ev) && !member.active && yen > 10) {
    return safeUpdate(interaction, { content: 'Final 15 minutes: non-members can only send ¥1 or ¥10 Superchats.', components: [] });
  }
  const fans = yen * 10;
  const remainder = Number(state?.superchatBonusRemainder || 0);
  const rawBonus = member.active ? (yen * 0.10 + remainder) : 0;
  const visibleBonus = member.active ? Math.floor(rawBonus + 1e-9) : 0;
  const previewHappiness = yen + visibleBonus;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nsuperchat_confirm\n${userId}\n${yen}`).setLabel('Confirm').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nsuperchat_back\n${userId}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
  );
  return safeUpdate(interaction, {
    content: `**Confirm Superchat**\nAmount: **¥${yen.toLocaleString()}**\nCost: **${fans.toLocaleString()} fans**\nBase Happiness: **${yen.toLocaleString()}**${member.active ? `\nMembership bonus awarded now: **+${visibleBonus.toLocaleString()}**\nTotal Happiness: **${previewHappiness.toLocaleString()}**` : ''}`,
    components: [row],
  });
}

async function confirmSuperchat(interaction, eventId, userId, yen) {
  if (!SUPERCHAT_YEN_OPTIONS.includes(yen)) return safeUpdate(interaction, { content: 'Invalid Superchat amount.', components: [] });
  const dbSession = await mongoose.startSession();
  let result;
  try {
    await dbSession.withTransaction(async () => {
      const ev = await StreamEvent.findOne({ eventId }).session(dbSession);
      if (!ev || ev.status !== 'active' || new Date(ev.endsAt).getTime() <= Date.now()) throw new Error('This stream is no longer active.');
      const oshiDoc = await Oshi.findOne({ userId }).session(dbSession).lean();
      const state = getUserState(ev, userId, true);
      const member = membershipInfo(oshiDoc, ev, state);
      if (isFinalOrderWindow(ev) && !member.active && yen > 10) throw new Error('Final 15 minutes: non-members can only send ¥1 or ¥10 Superchats.');

      const fans = yen * 10;
      const userUpdate = await User.updateOne(
        { id: userId, points: { $gte: fans } },
        { $inc: { points: -fans } },
        { session: dbSession }
      );
      if (!userUpdate.matchedCount) throw new Error('Insufficient fans.');

      const previousRemainder = Number(state.superchatBonusRemainder || 0);
      const rawBonus = member.active ? (yen * 0.10 + previousRemainder) : 0;
      const bonus = member.active ? Math.floor(rawBonus + 1e-9) : 0;
      const newRemainder = member.active ? Math.max(0, rawBonus - bonus) : previousRemainder;
      const happiness = yen + bonus;

      state.happiness += happiness;
      state.superchatCount += 1;
      state.superchatFansSpent += fans;
      state.superchatYenSpent += yen;
      state.superchatHappiness += happiness;
      state.superchatBonusRemainder = newRemainder;
      ensureFirstHappiness(state, happiness);
      ev.happiness += happiness;
      await ev.save({ session: dbSession });

      await StreamActionLog.create([{
        eventId, userId, oshiId: ev.oshiId, action: 'superchat', happiness,
        meta: {
          yen, fans, baseHappiness: yen, memberBonusActive: member.active,
          bonusHappiness: bonus, remainderBefore: previousRemainder,
          remainderAfter: newRemainder, finalHappiness: happiness,
        },
      }], { session: dbSession });
      result = { yen, fans, baseHappiness: yen, bonus, happiness, member: member.active, remainder: newRemainder };
    });
  } finally {
    await dbSession.endSession();
  }
  scheduleRefresh(interaction.client, eventId);
  return safeUpdate(interaction, {
    content: `Superchat sent: **¥${result.yen.toLocaleString()}** (${result.fans.toLocaleString()} fans) → **+${result.happiness.toLocaleString()} Happiness**${result.member ? ` including +${result.bonus.toLocaleString()} membership bonus` : ''}.`,
    components: [],
  });
}

async function showContribution(interaction, eventId, userId) {
  const ev = await requireActiveEvent(eventId);
  const state = getUserState(ev, userId, false);
  const content = [
    '**Your Stream Contribution**',
    `❤️ Happiness: **${Number(state?.happiness || 0).toLocaleString()}**`,
    '',
    `Like Happiness: **${Number(state?.likeHappiness || 0).toLocaleString()}**`,
    `Cards gifted through Sub: **${Number(state?.subCardsGifted || 0).toLocaleString()}**`,
    `Sub Happiness: **${Number(state?.subHappiness || 0).toLocaleString()}**`,
    `Superchats: **${Number(state?.superchatCount || 0).toLocaleString()}**`,
    `Superchat spent: **¥${Number(state?.superchatYenSpent || 0).toLocaleString()}** / **${Number(state?.superchatFansSpent || 0).toLocaleString()} fans**`,
    `Superchat Happiness: **${Number(state?.superchatHappiness || 0).toLocaleString()}**`,
  ].filter(Boolean).join('\n');
  return ephemeralReply(interaction, { content });
}

async function openSubMenu(interaction, eventId, userId) {
  await requireActiveEvent(eventId);
  deleteAllSessions(eventId, userId);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nsub_normal\n${userId}`).setLabel('Select Cards').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`stream\n${eventId}\nsub_mass\n${userId}`).setLabel('Mass Gift').setStyle(ButtonStyle.Primary),
  );
  return ephemeralReply(interaction, {
    content: '**SUB**\nSelect individual SR+ cards, or use Mass Gift to randomly gift one rarity in bulk.',
    components: [row],
  });
}

function assertOwner(interaction, intendedUserId) {
  if (!intendedUserId || interaction.user.id !== intendedUserId) throw new Error('This control is not for you.');
}

async function handleInteraction(interaction) {
  const id = interaction.customId;
  if (!id || !id.startsWith('stream\n')) return false;
  const parts = id.split('\n');
  const eventId = parts[1];
  const action = parts[2];
  const intendedUserId = parts[3];

  try {
    if (intendedUserId) assertOwner(interaction, intendedUserId);
    const userId = interaction.user.id;

    if (interaction.isButton?.()) {
      if (action === 'like') {
        await interaction.deferReply({ ephemeral: true });
        const res = await handleLike({ userId, eventId, client: interaction.client });
        await interaction.editReply({ content: `Like sent: **+${res.happiness} Happiness**${res.matchingOshi ? ` (${res.level} Oshi level ×2)` : ` (Oshi level ${res.level})`}.` });
        return true;
      }
      if (action === 'sub') { await openSubMenu(interaction, eventId, userId); return true; }
      if (action === 'superchat') { await showSuperchatMenu(interaction, eventId, userId, false); return true; }
      if (action === 'sec') { await showSecGiftMenu(interaction, eventId, userId, false); return true; }
      if (action === 'contribution') { await showContribution(interaction, eventId, userId); return true; }

      if (action === 'sub_normal') {
        createSession(subSessions, eventId, userId, { cart: new Map(), rarity: null, page: 0, optionMap: new Map() });
        await showSubRarityMenu(interaction, eventId, userId, true); return true;
      }
      if (action === 'sub_mass') {
        createSession(massSessions, eventId, userId, { rarity: null, quantity: null, multiOnly: true, allowLocked: false, preview: null });
        await showMassRarityMenu(interaction, eventId, userId, true); return true;
      }
      if (action === 'sub_prev' || action === 'sub_next') {
        const s = getSession(subSessions, eventId, userId);
        if (!s) return safeUpdate(interaction, { content: 'This Sub selection expired. Press Sub again.', components: [] });
        s.page = Math.max(0, (s.page || 0) + (action === 'sub_next' ? 1 : -1));
        await showSubCardMenu(interaction, eventId, userId); return true;
      }
      if (action === 'sub_change_rarity') { await showSubRarityMenu(interaction, eventId, userId, true); return true; }
      if (action === 'sub_complete') {
        const s = getSession(subSessions, eventId, userId);
        if (!s?.cart?.size) return safeUpdate(interaction, { content: 'Your offering is empty.', components: [] });
        const ev = await requireActiveEvent(eventId);
        const oshiDoc = await Oshi.findOne({ userId }).lean();
        const member = membershipInfo(oshiDoc, ev, getUserState(ev, userId, false)).active;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`stream\n${eventId}\nsub_confirm\n${userId}`).setLabel('Confirm Gift').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`stream\n${eventId}\nsub_back\n${userId}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`stream\n${eventId}\nsub_cancel\n${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
        );
        await safeUpdate(interaction, { content: `${cartText(s, member)}\n\nNothing is consumed until you press **Confirm Gift**.`, components: [row] }); return true;
      }
      if (action === 'sub_confirm') { await confirmNormalSub(interaction, eventId, userId); return true; }
      if (action === 'sub_back') { await showSubCardMenu(interaction, eventId, userId); return true; }
      if (action === 'sub_cancel') { subSessions.delete(sessionKey(eventId, userId)); await safeUpdate(interaction, { content: 'Sub cancelled.', components: [] }); return true; }

      if (action === 'mass_change_rarity') {
        const s = getSession(massSessions, eventId, userId);
        if (!s) return safeUpdate(interaction, { content: 'This mass-gift setup expired. Press Sub again.', components: [] });
        s.rarity = null; s.quantity = null; s.preview = null;
        await showMassRarityMenu(interaction, eventId, userId, true); return true;
      }
      if (action === 'mass_multi' || action === 'mass_locked') {
        const s = getSession(massSessions, eventId, userId);
        if (!s) return safeUpdate(interaction, { content: 'This mass-gift setup expired. Press Sub again.', components: [] });
        if (action === 'mass_multi') s.multiOnly = !s.multiOnly;
        if (action === 'mass_locked') s.allowLocked = !s.allowLocked;
        s.preview = null;
        await showMassConfig(interaction, eventId, userId, true); return true;
      }
      if (action === 'mass_preview' || action === 'mass_reroll') { await showMassPreview(interaction, eventId, userId); return true; }
      if (action === 'mass_confirm') { await confirmMassSub(interaction, eventId, userId); return true; }
      if (action === 'mass_back') { await showMassConfig(interaction, eventId, userId, true); return true; }
      if (action === 'mass_cancel') { massSessions.delete(sessionKey(eventId, userId)); await safeUpdate(interaction, { content: 'Mass gift cancelled.', components: [] }); return true; }

      if (action === 'sec_prev' || action === 'sec_next') {
        const s = getSession(secSessions, eventId, userId);
        if (!s) return safeUpdate(interaction, { content: 'This SEC selection expired. Press SEC Gift again.', components: [] });
        s.page = Math.max(0, (s.page || 0) + (action === 'sec_next' ? 1 : -1));
        await showSecGiftMenu(interaction, eventId, userId, true); return true;
      }
      if (action === 'sec_confirm') { await confirmSecGift(interaction, eventId, userId); return true; }
      if (action === 'sec_back') { await showSecGiftMenu(interaction, eventId, userId, true); return true; }
      if (action === 'sec_cancel') { secSessions.delete(sessionKey(eventId, userId)); await safeUpdate(interaction, { content: 'SEC Gift cancelled.', components: [] }); return true; }

      if (action === 'superchat_confirm') { await confirmSuperchat(interaction, eventId, userId, Number(parts[4])); return true; }
      if (action === 'superchat_back') { await showSuperchatMenu(interaction, eventId, userId, true); return true; }
    }

    if (interaction.isStringSelectMenu?.()) {
      const selected = interaction.values?.[0];
      if (action === 'sub_rarity') {
        const s = getSession(subSessions, eventId, userId);
        if (!s || !SUB_RARITIES.includes(selected)) return safeUpdate(interaction, { content: 'This Sub selection expired. Press Sub again.', components: [] });
        s.rarity = selected; s.page = 0; await showSubCardMenu(interaction, eventId, userId); return true;
      }
      if (action === 'sub_card') { await handleSubCardSelection(interaction, eventId, userId, selected); return true; }
      if (action === 'sub_quantity') {
        const s = getSession(subSessions, eventId, userId);
        if (!s?.pendingCard) return safeUpdate(interaction, { content: 'That quantity selection expired.', components: [] });
        const qty = Math.floor(Number(selected));
        if (!Number.isFinite(qty) || qty < 1 || qty > s.pendingCard.remaining) return safeUpdate(interaction, { content: 'Invalid quantity.', components: [] });
        const p = s.pendingCard;
        s.cart.set(p.key, { name: p.name, rarity: p.rarity, count: p.reserved + qty });
        s.pendingCard = null;
        await showSubCardMenu(interaction, eventId, userId); return true;
      }
      if (action === 'mass_rarity') {
        const s = getSession(massSessions, eventId, userId);
        if (!s || !SUB_RARITIES.includes(selected)) return safeUpdate(interaction, { content: 'This Mass Gift selection expired. Press Sub again.', components: [] });
        s.rarity = selected; s.quantity = null; s.preview = null;
        await showMassConfig(interaction, eventId, userId, true); return true;
      }
      if (action === 'mass_quantity') {
        const s = getSession(massSessions, eventId, userId);
        if (!s) return safeUpdate(interaction, { content: 'This mass-gift setup expired. Press Sub again.', components: [] });
        s.quantity = Math.floor(Number(selected)); s.preview = null;
        await showMassConfig(interaction, eventId, userId, true); return true;
      }
      if (action === 'sec_select') {
        const s = getSession(secSessions, eventId, userId);
        const picked = s?.optionMap?.get(selected);
        if (!picked) return safeUpdate(interaction, { content: 'That SEC selection expired.', components: [] });
        s.selected = picked;
        const label = resolveOshiConfigByIdOrName(picked.memberOshiId)?.label || picked.memberOshiId;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`stream\n${eventId}\nsec_confirm\n${userId}`).setLabel('Gift SEC').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`stream\n${eventId}\nsec_back\n${userId}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
        );
        await safeUpdate(interaction, { content: `Gift **[SEC] ${picked.name}** for membership through **${label}**?\n\nThis consumes exactly **1 SEC** and gives +10% Happiness on future Subs and Superchats in this stream.`, components: [row] }); return true;
      }
      if (action === 'superchat_select') { await showSuperchatConfirm(interaction, eventId, userId, Number(selected)); return true; }
    }

    return false;
  } catch (err) {
    console.error('[stream interaction]', action, err);
    const content = err?.message || 'Failed to process stream interaction.';
    try {
      if (interaction.deferred) await interaction.editReply({ content, components: [] });
      else if (interaction.replied) await interaction.followUp({ content, ephemeral: true });
      else if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) await interaction.update({ content, components: [] });
      else await interaction.reply({ content, ephemeral: true });
    } catch (_) {}
    return true;
  }
}

function getAssetsBaseForRarity(rarity) {
  return ASSETS_BASE_BY_RARITY[String(rarity || '').toUpperCase()] || ASSETS_BASE;
}
function pickWeighted(options) {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of options) { if (r <= o.weight) return o.key; r -= o.weight; }
  return options[options.length - 1]?.key;
}
function buildWeightedOptionsFromMap(weightMap) {
  return Object.entries(weightMap).map(([key, w]) => ({ key, weight: Number(w) || 0 })).filter(o => o.weight > 0 && !RARITY_EXCLUDE.has(o.key));
}
function escapeRegExp(string) { return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function normalizeFilenameForMatch(filename) {
  return String(filename).replace(/\.(png|jpg|jpeg)$/i, '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').replace(/\b0*(\d{1,3})\b/g, '').trim().toLowerCase();
}
const lastPickedByRarity = new Map();
function getNextLowerWeightRarity(currentRarity, visitedSet = null, minRarity = null) {
  const idx = RARITY_ORDER.indexOf(String(currentRarity || '').trim());
  const minIdx = minRarity ? RARITY_ORDER.indexOf(String(minRarity).trim()) : -1;
  for (let i = (idx === -1 ? RARITY_ORDER.length : idx) - 1; i >= 0; i--) {
    if (minIdx >= 0 && i < minIdx) break;
    const c = RARITY_ORDER[i];
    if (RARITY_EXCLUDE.has(c) || visitedSet?.has(c)) continue;
    return c;
  }
  return null;
}
async function pickCardFromRarityFolder(rarity, oshiLabel, { avoidImmediateRepeat = true, minRarity = null, _visited = null } = {}) {
  try {
    const visited = _visited instanceof Set ? _visited : new Set();
    if (visited.has(rarity)) return null;
    visited.add(rarity);
    const folder = path.join(getAssetsBaseForRarity(rarity), String(rarity).toUpperCase());
    const files = await fs.readdir(folder).catch(() => []);
    if (!files.length) {
      const fallback = getNextLowerWeightRarity(rarity, visited, minRarity);
      return fallback ? pickCardFromRarityFolder(fallback, oshiLabel, { avoidImmediateRepeat, minRarity, _visited: visited }) : null;
    }
    const target = normalizeFilenameForMatch(oshiLabel || '');
    const candidates = files.map(f => ({ raw: f, norm: normalizeFilenameForMatch(f) }));
    const exact = target ? candidates.filter(f => new RegExp(`\\b${escapeRegExp(target)}\\b`).test(f.norm)) : [];
    const partial = target ? candidates.filter(f => f.norm.includes(target)) : [];
    let pool = exact.length ? exact : null;
    if (!pool) {
      const exList = getExceptionListForStreamTarget(oshiLabel);
      const set = new Set();
      for (const tokenRaw of exList) {
        const isPrefix = String(tokenRaw).endsWith('*');
        const token = normalizeFilenameForMatch(isPrefix ? String(tokenRaw).slice(0, -1) : tokenRaw);
        if (!token) continue;
        for (const c of candidates) {
          if ((isPrefix && c.norm.startsWith(token)) || (!isPrefix && (new RegExp(`\\b${escapeRegExp(token)}\\b`).test(c.norm) || c.norm.includes(token)))) set.add(c.raw);
        }
      }
      if (set.size) pool = Array.from(set).map(raw => ({ raw, norm: normalizeFilenameForMatch(raw) }));
    }
    if (!pool && partial.length) pool = partial;
    if (!pool) {
      const fallback = getNextLowerWeightRarity(rarity, visited, minRarity);
      if (fallback) return pickCardFromRarityFolder(fallback, oshiLabel, { avoidImmediateRepeat, minRarity, _visited: visited });
      pool = candidates;
    }
    if (!pool.length) return null;
    const lastKey = `${rarity}::${oshiLabel || ''}`;
    const last = lastPickedByRarity.get(lastKey);
    let choices = pool;
    if (avoidImmediateRepeat && last && pool.length > 1) choices = pool.filter(x => x.raw !== last);
    const pick = choices[crypto.randomInt(choices.length)];
    lastPickedByRarity.set(lastKey, pick.raw);
    return { name: path.basename(pick.raw, path.extname(pick.raw)), rarity };
  } catch (err) {
    console.error('[stream pickCard]', err);
    return null;
  }
}
async function pickCardByWeightedRarity(weightMap, oshiLabel, opts = {}) {
  const candidates = buildWeightedOptionsFromMap(weightMap);
  while (candidates.length) {
    const chosen = pickWeighted(candidates);
    candidates.splice(candidates.findIndex(c => c.key === chosen), 1);
    const pick = await pickCardFromRarityFolder(chosen, oshiLabel, opts);
    if (pick) return pick;
  }
  return null;
}

async function addCardToUser(userId, cardName, rarity, count = 1) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      let user = await User.findOne({ id: userId }).session(session);
      if (!user) user = new User({ id: userId, cards: [] });
      const card = (user.cards || []).find(c => c.name === cardName && c.rarity === rarity);
      if (card) {
        card.count = (card.count || 0) + count;
        card.lastAcquiredAt = new Date();
      } else {
        user.cards.push({ name: cardName, rarity, count, firstAcquiredAt: new Date(), lastAcquiredAt: new Date() });
      }
      await user.save({ session });
    });
  } finally { await session.endSession(); }
}

async function settleEndedEvents(client = null) {
  // Atomically claim ended streams one at a time before granting any rewards.
  // This prevents overlapping 15-second settlement ticks (or two bot processes)
  // from settling the same stream twice.
  while (true) {
    const ev = await StreamEvent.findOneAndUpdate(
      { status: 'ended' },
      { $set: { status: 'settling' } },
      { new: true, sort: { endsAt: 1 } }
    );

    if (!ev) break;

    try {
      const sorted = (ev.users || []).slice().filter(x => (x.happiness || 0) > 0).sort((a, b) => {
        if ((b.happiness || 0) !== (a.happiness || 0)) return (b.happiness || 0) - (a.happiness || 0);
        const ta = a.firstHappinessAt ? new Date(a.firstHappinessAt).getTime() : 0;
        const tb = b.firstHappinessAt ? new Date(b.firstHappinessAt).getTime() : 0;
        return ta - tb;
      });
      const winners = sorted.slice(0, 3);
      const label = streamLabel(ev);

      for (const p of sorted) {
        try {
          const picked = await pickCardByWeightedRarity(PARTICIPATION_WEIGHTS, label, { avoidImmediateRepeat: true });
          if (picked?.name) {
            await addCardToUser(p.userId, picked.name, picked.rarity, 1);
            await StreamActionLog.create({ eventId: ev.eventId, userId: p.userId, oshiId: ev.oshiId, action: 'reward', happiness: 0, meta: { tier: 'participation', reward: picked.rarity, card: picked.name } });
          } else {
            const fallback = `${label} 001`;
            await addCardToUser(p.userId, fallback, 'C', 1);
            await StreamActionLog.create({ eventId: ev.eventId, userId: p.userId, oshiId: ev.oshiId, action: 'reward', happiness: 0, meta: { tier: 'participation', reward: 'C', card: fallback, note: 'fallback' } });
          }
        } catch (err) { console.error('[stream settle] participation', p.userId, err); }
      }

      if (winners[2]) {
        try {
          const picked = await pickCardByWeightedRarity(THIRDPLACE_WEIGHTS, label, { avoidImmediateRepeat: true, minRarity: 'SY' });
          if (picked?.name) {
            await addCardToUser(winners[2].userId, picked.name, picked.rarity, 1);
            await StreamActionLog.create({ eventId: ev.eventId, userId: winners[2].userId, oshiId: ev.oshiId, action: 'reward', happiness: 0, meta: { tier: 3, reward: picked.rarity, card: picked.name } });
          } else {
            const fallback = `${label} 001`;
            await addCardToUser(winners[2].userId, fallback, 'SY', 1);
            await StreamActionLog.create({ eventId: ev.eventId, userId: winners[2].userId, oshiId: ev.oshiId, action: 'reward', happiness: 0, meta: { tier: 3, reward: 'SY', card: fallback, note: 'SY floor fallback' } });
          }
        } catch (err) { console.error('[stream settle] third', err); }
      }

      if (winners[1]) {
        try {
          const picked = await pickCardByWeightedRarity(SECONDPLACE_WEIGHTS, label, { avoidImmediateRepeat: true, minRarity: 'SY' });
          if (picked?.name) {
            await addCardToUser(winners[1].userId, picked.name, picked.rarity, 1);
            await StreamActionLog.create({ eventId: ev.eventId, userId: winners[1].userId, oshiId: ev.oshiId, action: 'reward', happiness: 0, meta: { tier: 2, reward: picked.rarity, card: picked.name } });
          } else {
            const fallback = `${label} 001`;
            await addCardToUser(winners[1].userId, fallback, 'SY', 1);
            await StreamActionLog.create({ eventId: ev.eventId, userId: winners[1].userId, oshiId: ev.oshiId, action: 'reward', happiness: 0, meta: { tier: 2, reward: 'SY', card: fallback, note: 'SY floor fallback' } });
          }
        } catch (err) { console.error('[stream settle] second', err); }
      }

      if (winners[0]) {
        try {
          const specified = ev.firstPlaceOriCardName || ev.firstPlaceRewardCardName || ev.rewardOverrides?.firstPlaceOriCardName || ev.rewardOverrides?.firstPlaceOri || ev.rewards?.firstPlaceOriCardName || ev.rewards?.firstPlaceOri;
          const cardName = String(specified || `${label} 001`).trim();
          await addCardToUser(winners[0].userId, cardName, 'ORI', 1);
          await StreamActionLog.create({ eventId: ev.eventId, userId: winners[0].userId, oshiId: ev.oshiId, action: 'reward', happiness: 0, meta: { tier: 1, reward: 'ORI', card: cardName } });

          const picked2 = await pickCardByWeightedRarity(SECONDPLACE_WEIGHTS, label, { avoidImmediateRepeat: true, minRarity: 'SY' });
          if (picked2?.name) {
            await addCardToUser(winners[0].userId, picked2.name, picked2.rarity, 1);
            await StreamActionLog.create({ eventId: ev.eventId, userId: winners[0].userId, oshiId: ev.oshiId, action: 'reward', happiness: 0, meta: { tier: 2, reward: picked2.rarity, card: picked2.name, note: '1st place also receives 2nd-place reward' } });
          } else {
            const fallback = `${label} 001`;
            await addCardToUser(winners[0].userId, fallback, 'SY', 1);
            await StreamActionLog.create({ eventId: ev.eventId, userId: winners[0].userId, oshiId: ev.oshiId, action: 'reward', happiness: 0, meta: { tier: 2, reward: 'SY', card: fallback, note: '1st place SY floor fallback' } });
          }
        } catch (err) { console.error('[stream settle] first', err); }
      }

      ev.status = 'settled';
      await ev.save();
      if (client) await postStreamResults(client, ev.eventId);

      if (client && STREAM_CHANNEL_ID) {
        const ch = await client.channels.fetch(STREAM_CHANNEL_ID).catch(() => null);
        if (ch?.isTextBased?.()) {
          const summary = new EmbedBuilder()
            .setTitle(`Stream ended: ${label}`)
            .setDescription(`Top fans who brought the most Happiness to **${label}**:`)
            .addFields(
              { name: '1st', value: winners[0] ? `<@${winners[0].userId}> — ${Number(winners[0].happiness).toLocaleString()} ❤️` : '-', inline: true },
              { name: '2nd', value: winners[1] ? `<@${winners[1].userId}> — ${Number(winners[1].happiness).toLocaleString()} ❤️` : '-', inline: true },
              { name: '3rd', value: winners[2] ? `<@${winners[2].userId}> — ${Number(winners[2].happiness).toLocaleString()} ❤️` : '-', inline: true },
            );
          await ch.send({ embeds: [summary] });
        }
      }
    } catch (err) {
      // Leave the event as "settling" on failure instead of automatically retrying
      // and risking duplicate rewards after a partial settlement.
      console.error('[stream settle]', ev.eventId, err);
    }
  }
}

async function activateAndEndEvents() {
  const now = new Date();
  await StreamEvent.updateMany({ status: 'scheduled', spawnAt: { $lte: now }, endsAt: { $gt: now } }, { $set: { status: 'active' } });
  await StreamEvent.updateMany({ status: 'active', endsAt: { $lte: now } }, { $set: { status: 'ended' } });
}

async function announceActivatedEvents(client) {
  const now = new Date();
  const events = await StreamEvent.find({ status: 'active', announceMessageId: null, spawnAt: { $lte: now }, endsAt: { $gt: now } });
  if (!events.length || !STREAM_CHANNEL_ID) return;
  const ch = await client.channels.fetch(STREAM_CHANNEL_ID).catch(() => null);
  if (!ch?.isTextBased?.()) return;
  for (const ev of events) {
    ev.imageUrl = ev.imageUrl || buildImageUrl(streamLabel(ev), 'ORI');
    await ev.save();
    const { embed, components } = buildStreamEmbedAndButtons(ev);
    const msg = await ch.send({ embeds: [embed], components });
    ev.announceMessageId = msg.id;
    await ev.save();
  }
}

async function createAndAnnounceEvent(client, targetInput = null, durationMs = null) {
  const target = resolveStreamTarget(targetInput);
  if (!target) throw new Error(`Unknown Oshi/subunit/stream: ${targetInput}`);
  if (!STREAM_CHANNEL_ID) throw new Error('Neither streamChannelId nor bossChannelId is configured.');
  const now = new Date();
  const endsAt = new Date(now.getTime() + (typeof durationMs === 'number' ? durationMs : eventDurationMs()));
  const ev = await StreamEvent.create({
    eventId: nanoid(), oshiId: target.eventOshiId, spawnAt: now, endsAt,
    status: 'active', happiness: 0, users: [], imageUrl: buildImageUrl(target.label, 'ORI'), createdAt: now,
  });
  const ch = await client.channels.fetch(STREAM_CHANNEL_ID);
  if (!ch?.isTextBased?.()) throw new Error('Configured stream channel is not text-based or unavailable.');
  const { embed, components } = buildStreamEmbedAndButtons(ev);
  const msg = await ch.send({ embeds: [embed], components });
  ev.announceMessageId = msg.id;
  await ev.save();
  return { event: ev, message: msg };
}

let activatorInterval = null;
let settleInterval = null;
let refresherInterval = null;

async function startStreamManager(client) {
  stopStreamManager();
  activatorInterval = setInterval(async () => {
    try { await activateAndEndEvents(); await announceActivatedEvents(client); } catch (err) { console.error('[stream activator]', err); }
  }, 15_000);
  settleInterval = setInterval(async () => {
    try { await settleEndedEvents(client); } catch (err) { console.error('[stream settlement]', err); }
  }, 15_000);
  refresherInterval = setInterval(async () => {
    try {
      const active = await StreamEvent.find({ status: 'active' }).lean();
      for (const ev of active) await refreshEventMessage(client, ev.eventId, ev).catch(() => null);
    } catch (err) { console.error('[stream refresher]', err); }
  }, 10 * 60 * 1000);
  activatorInterval.unref?.(); settleInterval.unref?.(); refresherInterval.unref?.();
  console.log('[streamManager] started');
}

function stopStreamManager() {
  if (activatorInterval) clearInterval(activatorInterval);
  if (settleInterval) clearInterval(settleInterval);
  if (refresherInterval) clearInterval(refresherInterval);
  activatorInterval = settleInterval = refresherInterval = null;
}

module.exports = {
  startStreamManager,
  stopStreamManager,
  handleInteraction,
  handleLike,
  createAndAnnounceEvent,
  refreshEventMessage,
  findActiveEventById,
  settleEndedEvents,
  eventDurationMs,
  resolveStreamTarget,
  getStreamMemberIds,
  SUB_VALUES,
  SUPERCHAT_YEN_OPTIONS,
};
