// message-commands/scores.js
// Leaderboard for the current StreamEvent-based stream system.

const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const StreamEvent = require('../models/StreamEvent');
const User = require('../models/User');
const oshis = require('../config/oshis');

const PREFIX = '!';
const TOP_N = 10;
const ADMIN_CHANNEL_ID = String(config.adminChannelId || '');

const OWNER_IDS = new Set([
  '153551890976735232',
  '409717160995192832',
  '272129129841688577',
  '399012422805094410',
]);

const ALLOWED_USER_IDS = new Set([
  ...OWNER_IDS,
]);

const ALLOWED_ROLE_IDS = new Set([
  '844054364033384470',
]);

const leaderCache = new Map();

function isAuthorized(message) {
  try {
    const id = String(message.author.id);
    if (OWNER_IDS.has(id) || ALLOWED_USER_IDS.has(id)) return true;
    const roles = message.member?.roles?.cache;
    if (!message.guild || !roles) return false;
    for (const roleId of ALLOWED_ROLE_IDS) if (roles.has(roleId)) return true;
    return false;
  } catch {
    return false;
  }
}

function norm(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function streamLabel(ev) {
  const key = norm(ev?.oshiId);
  const cfg = (oshis || []).find(o => norm(o?.id) === key || norm(o?.label) === key);
  return cfg?.label || String(ev?.oshiId || 'Unknown');
}

function statusEmoji(status) {
  return ({ active: '🟢', scheduled: '🕒', ended: '🟠', settling: '🟡', settled: '⚫' })[String(status)] || '⚪';
}

function unix(date) {
  const ms = new Date(date).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// Match settlement ordering exactly: Happiness first, then earliest first contribution.
function sortedUsers(ev) {
  return (ev?.users || [])
    .slice()
    .filter(u => Number(u?.happiness || 0) > 0)
    .sort((a, b) => {
      const score = Number(b.happiness || 0) - Number(a.happiness || 0);
      if (score !== 0) return score;
      const ta = a.firstHappinessAt ? new Date(a.firstHappinessAt).getTime() : Number.MAX_SAFE_INTEGER;
      const tb = b.firstHappinessAt ? new Date(b.firstHappinessAt).getTime() : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
}

async function resolveLabels(message, ids) {
  const unique = [...new Set(ids.map(String))];
  const labels = new Map();

  if (message.guild) {
    for (const id of unique) {
      const member = message.guild.members.cache.get(id) || await message.guild.members.fetch(id).catch(() => null);
      if (member) labels.set(id, member.displayName || member.user?.username || id);
    }
  }

  const unresolved = unique.filter(id => !labels.has(id));
  if (unresolved.length) {
    const users = await User.find(
      { id: { $in: unresolved } },
      { id: 1, username: 1, discriminator: 1, displayName: 1 }
    ).lean().exec().catch(() => []);

    for (const u of users || []) {
      const id = String(u.id);
      labels.set(id,
        u.displayName ||
        (u.username && u.discriminator ? `${u.username}#${u.discriminator}` : u.username) ||
        id
      );
    }
  }

  for (const id of unique) if (!labels.has(id)) labels.set(id, id);
  return labels;
}

function makeEmbed(ev, labels) {
  const users = sortedUsers(ev);
  const top = users.slice(0, TOP_N);
  const label = streamLabel(ev);
  const endTs = unix(ev.endsAt);

  const lines = top.length ? top.map((u, i) => {
    const name = labels.get(String(u.userId)) || String(u.userId);
    const total = Number(u.happiness || 0);
    const like = Number(u.likeHappiness || 0);
    const sub = Number(u.subHappiness || 0);
    const cards = Number(u.subCardsGifted || 0);
    const sc = Number(u.superchatHappiness || 0);
    const scCount = Number(u.superchatCount || 0);
    return `**#${i + 1}** ${name}: **${total.toLocaleString()} ❤️**\n` +
      `↳ Like ${like.toLocaleString()} • Sub ${sub.toLocaleString()} (${cards.toLocaleString()} cards) • SC ${sc.toLocaleString()} (${scCount.toLocaleString()})`;
  }) : ['_Nobody has contributed Happiness yet._'];

  const embed = new EmbedBuilder()
    .setTitle(`${label} Stream — Top ${Math.min(TOP_N, users.length || TOP_N)}`)
    .setDescription(lines.join('\n'))
    .setColor(0x5AB3F4)
    .addFields(
      { name: 'Stream Happiness', value: `**${Number(ev.happiness || 0).toLocaleString()} ❤️**`, inline: true },
      { name: 'Participants', value: `**${users.length.toLocaleString()}**`, inline: true },
      { name: 'Status', value: `${statusEmoji(ev.status)} **${String(ev.status || 'unknown')}**`, inline: true },
    )
    .setFooter({ text: `Event: ${ev.eventId}` });

  if (endTs) {
    embed.addFields({
      name: String(ev.status) === 'active' ? 'Ends' : 'Ended',
      value: `<t:${endTs}:R>`,
      inline: true,
    });
  }

  return embed;
}

async function announceLeaderChange(client, ev, top, label) {
  if (!ADMIN_CHANNEL_ID || !top?.userId) return;
  const eventId = String(ev.eventId);
  const next = String(top.userId);
  const previous = leaderCache.get(eventId);

  if (previous && previous !== next) {
    const ch = client.channels.cache.get(ADMIN_CHANNEL_ID) || await client.channels.fetch(ADMIN_CHANNEL_ID).catch(() => null);
    if (ch?.isTextBased?.()) {
      await ch.send(`**${label || `<@${next}>`}** has taken the lead in **${streamLabel(ev)}**'s stream.`).catch(() => {});
    }
  }

  leaderCache.set(eventId, next);
}

async function activeEvents() {
  const now = new Date();
  return StreamEvent.find({
    status: 'active',
    spawnAt: { $lte: now },
    endsAt: { $gt: now },
  }).sort({ spawnAt: -1 }).lean().exec();
}

async function newestEvent() {
  return StreamEvent.findOne({}).sort({ spawnAt: -1, createdAt: -1 }).lean().exec();
}

async function findEvent(selector) {
  const raw = String(selector || '').trim();
  if (!raw) return null;

  const exact = await StreamEvent.findOne({ eventId: raw }).lean().exec();
  if (exact) return exact;

  const wanted = norm(raw);
  const ids = new Set([raw]);
  for (const o of oshis || []) {
    if (norm(o?.id) === wanted || norm(o?.label) === wanted) ids.add(String(o.id));
  }

  const direct = await StreamEvent.find({ oshiId: { $in: [...ids] } })
    .sort({ spawnAt: -1, createdAt: -1 }).lean().exec();
  if (direct.length) {
    return direct.find(ev => ev.status === 'active' && new Date(ev.endsAt).getTime() > Date.now()) || direct[0];
  }

  const recent = await StreamEvent.find({}).sort({ spawnAt: -1 }).limit(100).lean().exec();
  return recent.find(ev => norm(ev.oshiId) === wanted || norm(streamLabel(ev)) === wanted) || null;
}

async function showList(message) {
  const events = await StreamEvent.find({}).sort({ spawnAt: -1, createdAt: -1 }).limit(10).lean().exec();
  if (!events.length) return message.reply('No stream events found.').catch(() => {});

  const lines = events.map(ev => {
    const ts = unix(ev.spawnAt);
    return `${statusEmoji(ev.status)} **${streamLabel(ev)}** — \`${ev.eventId}\`\n` +
      `↳ ${ev.status}${ts ? ` • <t:${ts}:R>` : ''} • ${Number(ev.happiness || 0).toLocaleString()} ❤️`;
  });

  return message.reply({ embeds: [new EmbedBuilder()
    .setTitle('Recent Streams')
    .setDescription(lines.join('\n'))
    .setColor(0x5AB3F4)
    .setFooter({ text: 'Use !scores <eventId> for one specific stream.' })
  ]}).catch(() => {});
}

async function sendScores(message, events) {
  if (!events.length) return message.reply('No stream events found.').catch(() => {});

  const ids = events.flatMap(ev => sortedUsers(ev).slice(0, TOP_N).map(u => String(u.userId)));
  const labels = await resolveLabels(message, ids);
  const embeds = [];

  for (const ev of events) {
    const top = sortedUsers(ev)[0];
    if (top) await announceLeaderChange(message.client, ev, top, labels.get(String(top.userId)));
    embeds.push(makeEmbed(ev, labels));
  }

  for (let i = 0; i < embeds.length; i += 10) {
    const chunk = embeds.slice(i, i + 10);
    if (i === 0) await message.reply({ embeds: chunk }).catch(() => {});
    else await message.channel.send({ embeds: chunk }).catch(() => {});
  }
}

module.exports = {
  name: 'scores',
  description: 'Show top scores for the new live stream system.',

  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX) || message.author.bot) return;
      if (!isAuthorized(message)) return message.reply('You are not permitted to use this command.').catch(() => {});

      const selector = (args || []).join(' ').trim();
      if (selector === '--list' || selector === 'list') return showList(message);

      if (selector && selector !== 'all' && selector !== '--all') {
        const ev = await findEvent(selector);
        if (!ev) return message.reply(`No stream found for \`${selector}\`. Use \`!scores --list\` to see recent IDs.`).catch(() => {});
        return sendScores(message, [ev]);
      }

      let events = await activeEvents();
      if (!events.length) {
        const latest = await newestEvent();
        if (latest) events = [latest];
      }
      return sendScores(message, events);
    } catch (err) {
      console.error('[scores] error', err);
      return message.reply('Error running !scores.').catch(() => {});
    }
  },

  async checkLeadAndAnnounce(client, eventId) {
    const ev = await StreamEvent.findOne({ eventId: String(eventId) }).lean().exec();
    if (!ev) return;
    const top = sortedUsers(ev)[0];
    if (!top) return;

    const u = await User.findOne(
      { id: String(top.userId) },
      { username: 1, discriminator: 1, displayName: 1 }
    ).lean().exec().catch(() => null);

    const label = u?.displayName ||
      (u?.username && u?.discriminator ? `${u.username}#${u.discriminator}` : u?.username) ||
      `<@${top.userId}>`;

    await announceLeaderChange(client, ev, top, label);
  },
};
