// message-commands/scores.js
const { EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const config = require('../config.json');

const PREFIX = '!';
const TOP_N = 10;
const ADMIN_CHANNEL_ID = String(config.adminChannelId || '');

// eventId -> current leader userId (in-memory)
const leaderCache = new Map();

/**
 * Get Mongoose models. Uses existing models if already registered,
 * otherwise registers minimal schemas that match your topscores.js script.
 */
function getModels() {
  const { Schema } = mongoose;

  // Matches your topscores.js structure and collection name "bosspointlogs" [2](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/topscores.js)
  const BossPointLogSchema = new Schema(
    {
      eventId: { type: String, required: true, index: true },
      userId: { type: String, required: true, index: true },
      oshiId: { type: String, default: null },
      action: {
        type: String,
        required: true,
        enum: ['like', 'sub', 'superchat', 'member', 'reward'],
        index: true
      },
      points: { type: Number, default: 0 },
      meta: { type: Schema.Types.Mixed, default: {} },
      createdAt: { type: Date, default: () => new Date() }
    },
    { collection: 'bosspointlogs' }
  );

  let BossPointLog;
  try {
    BossPointLog = mongoose.model('BossPointLog');
  } catch {
    BossPointLog = mongoose.model('BossPointLog', BossPointLogSchema);
  }

  // Minimal users collection mapping (mirrors topscores.js expectations) [2](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/topscores.js)
  const UserSchema = new Schema(
    {
      id: { type: String, required: true, unique: true },
      username: { type: String, default: null },
      discriminator: { type: String, default: null },
      displayName: { type: String, default: null }
    },
    { collection: 'users' }
  );

  let User;
  try {
    User = mongoose.model('User');
  } catch {
    User = mongoose.model('User', UserSchema);
  }

  return { BossPointLog, User };
}

/**
 * If no eventId is provided, grab the most recent eventId
 * from the latest BossPointLog entry (by createdAt).
 */
async function getMostRecentEventId(BossPointLog) {
  const last = await BossPointLog.findOne({}, { eventId: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .lean()
    .exec();

  return last?.eventId || null;
}

/**
 * Aggregate leaderboard:
 * - totalPoints: sum(points)
 * - subCount: number of logs with action == "sub"
 * - superchatCount: number of logs with action == "superchat"
 */
async function aggregateTopScores(BossPointLog, eventId, topN = TOP_N) {
  const pipeline = [
    { $match: { eventId: String(eventId) } },
    {
      $group: {
        _id: '$userId',
        totalPoints: { $sum: '$points' },

        subCount: {
          $sum: { $cond: [{ $eq: ['$action', 'sub'] }, 1, 0] }
        },

        // Count times superchat happened (NOT amount)
        superchatCount: {
          $sum: { $cond: [{ $eq: ['$action', 'superchat'] }, 1, 0] }
        }
      }
    },
    { $sort: { totalPoints: -1 } },
    { $limit: Math.max(1, Number(topN) || TOP_N) }
  ];

  return BossPointLog.aggregate(pipeline).allowDiskUse(true).exec();
}

/**
 * Resolve label in a human-friendly way:
 * 1) Guild member displayName (nickname) / username
 * 2) DB 'users' displayName / username#discriminator / username
 * 3) fallback userId
 */
async function resolveUserLabels(message, User, rows) {
  const ids = rows.map(r => String(r._id));

  // Prefer server display names (easy to understand)
  const guild = message.guild;
  const discordMap = new Map();

  if (guild) {
    for (const id of ids) {
      const member =
        guild.members.cache.get(id) ||
        (await guild.members.fetch(id).catch(() => null));

      if (member) {
        discordMap.set(id, member.displayName || member.user.username);
      }
    }
  }

  // Fallback to DB user data if available (as topscores.js does) [2](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/topscores.js)
  const users = await User.find({ id: { $in: ids } }).lean().exec().catch(() => []);
  const dbMap = new Map((users || []).map(u => [String(u.id), u]));

  return rows.map(r => {
    const uid = String(r._id);

    if (discordMap.has(uid)) {
      return { ...r, userId: uid, label: discordMap.get(uid) };
    }

    const u = dbMap.get(uid);
    if (u) {
      if (u.displayName) return { ...r, userId: uid, label: u.displayName };
      if (u.username && u.discriminator) return { ...r, userId: uid, label: `${u.username}#${u.discriminator}` };
      if (u.username) return { ...r, userId: uid, label: u.username };
    }

    return { ...r, userId: uid, label: uid };
  });
}

/**
 * Announce when leader changes:
 * "<User> has taken the lead" into config.adminChannelId
 */
async function maybeAnnounceLeadChange(client, eventId, topRowWithLabel) {
  if (!ADMIN_CHANNEL_ID) return;
  if (!topRowWithLabel?.userId) return;

  const prevLeader = leaderCache.get(String(eventId));
  const newLeader = String(topRowWithLabel.userId);

  // Only announce if we have a previous leader AND it changed
  if (prevLeader && prevLeader !== newLeader) {
    const channel =
      client.channels.cache.get(ADMIN_CHANNEL_ID) ||
      (await client.channels.fetch(ADMIN_CHANNEL_ID).catch(() => null));

    if (channel) {
      await channel.send(`**${topRowWithLabel.label}** has taken the lead`).catch(() => {});
    }
  }

  leaderCache.set(String(eventId), newLeader);
}

module.exports = {
  name: 'scores',
  description: 'Show top 10 scores for an event. Usage: !scores <id>',

  async execute(message, args = []) {
    try {
      // Prefix guard (your index.js dispatcher already does this, but safe to keep) [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/index.js)
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      const { BossPointLog, User } = getModels();

      // eventId = args[0] OR most recent
      let eventId = args[0]?.trim();
      if (!eventId) {
        eventId = await getMostRecentEventId(BossPointLog);
        if (!eventId) {
          return message.reply({ content: 'No boss/event logs found yet.' }).catch(() => {});
        }
      }

      const raw = await aggregateTopScores(BossPointLog, eventId, TOP_N);
      if (!raw || raw.length === 0) {
        return message.reply({ content: `No scores found for event: \`${eventId}\`` }).catch(() => {});
      }

      const rows = await resolveUserLabels(message, User, raw);

      // Leader change notification
      await maybeAnnounceLeadChange(message.client, eventId, rows[0]);

      // Format: "#1 Orange: 100, Sub:10, Superchat:10"
      const lines = rows.slice(0, TOP_N).map((r, i) => {
        const points = Number(r.totalPoints || 0);
        const subs = Number(r.subCount || 0);
        const superchats = Number(r.superchatCount || 0);
        return `**#${i + 1}** ${r.label}: **${points}**, Sub:**${subs}**, Superchat:**${superchats}**`;
      });

      const embed = new EmbedBuilder()
        .setTitle(`Top ${Math.min(TOP_N, rows.length)} Scores`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: `Event: ${eventId}` })
        .setColor('#3498db');

      return message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error('[scores] error', err);
      return message.reply({ content: 'Error running !scores.' }).catch(() => {});
    }
  },

  /**
   * Optional helper for REAL-TIME leader alerts:
   * call this after you insert a BossPointLog / award points.
   */
  async checkLeadAndAnnounce(client, eventId) {
    const { BossPointLog, User } = getModels();
    const raw = await aggregateTopScores(BossPointLog, eventId, 1);
    if (!raw || raw.length === 0) return;

    // No message object here; we can't fetch guild displayNames.
    // We'll use DB labels (still better than IDs).
    const users = await User.find({ id: { $in: [String(raw[0]._id)] } }).lean().exec().catch(() => []);
    const u = users?.[0];
    const label = u?.displayName || (u?.username && u?.discriminator ? `${u.username}#${u.discriminator}` : u?.username) || String(raw[0]._id);

    await maybeAnnounceLeadChange(client, eventId, { userId: String(raw[0]._id), label });
  }
};