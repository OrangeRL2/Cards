// utils/postBossResults.js
// Posts a detailed results page in the boss channel after settlement,
// listing all participants and the cards they were awarded.

const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const oshis = require('../config/oshis');
const BossPointLog = require('../models/BossPointLog');
const BossEvent = require('../models/BossEvent');

function tierLabelFromMeta(meta) {
  const t = meta?.tier;
  if (t === 1 || String(t) === '1') return '1st place';
  if (t === 2 || String(t) === '2') return '2nd place';
  if (t === 3 || String(t) === '3') return '3rd place';
  if (typeof t === 'string') return t.charAt(0).toUpperCase() + t.slice(1);
  return 'Participation';
}
function tierOrder(m) {
  const t = m?.tier;
  if (t === 1 || String(t) === '1') return 0; // best
  if (t === 2 || String(t) === '2') return 1;
  if (t === 3 || String(t) === '3') return 2;
  return 10; // participation / unknown
}
function formatRewardLine(meta) {
  const tierLabel = tierLabelFromMeta(meta);
  const reward = meta?.reward || '(unknown)';
  const card = meta?.card || '(fallback)';
  return `${tierLabel} reward:\n**[${reward}]** ${card}`;
}

/**
 * Post a results page for a settled boss event.
 * @param {import('discord.js').Client} client - Discord client
 * @param {string} eventId - Boss event ID
 */
async function postBossResults(client, eventId) {
  try {
    const ev = await BossEvent.findOne({ eventId }).lean();
    if (!ev) {
      console.warn(`[postBossResults] event ${eventId} not found`);
      return;
    }

    // Fetch all reward logs for this event
    const rewardLogs = await BossPointLog.find({ eventId, action: 'reward' }).lean();

    const ch = await client.channels.fetch(config.bossChannelId).catch(() => null);
    if (!ch || !ch.isTextBased?.()) {
      console.warn('[postBossResults] boss channel not available or bot lacks permission');
      return;
    }

    if (!rewardLogs || rewardLogs.length === 0) {
      await ch.send(`No rewards were logged for event ${eventId}.`);
      console.log(`[postBossResults] no reward logs for event ${eventId}`);
      return;
    }

    // Group rewards by userId
    const rewardsByUser = new Map();
    for (const log of rewardLogs) {
      if (!rewardsByUser.has(log.userId)) rewardsByUser.set(log.userId, []);
      rewardsByUser.get(log.userId).push(log.meta || {});
    }

    const oshiCfg = oshis.find(o => o.id === ev.oshiId);
    const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

    // Build an array of fields (with userId included) to paginate into embeds
    const fields = [];
    for (const [userId, metas] of rewardsByUser.entries()) {
      // Sort user's rewards so top tiers appear first (1,2,3 then participation)
      metas.sort((a, b) => {
        const order = (m) => {
          if (m?.tier === 1 || String(m?.tier) === '1') return 0;
          if (m?.tier === 2 || String(m?.tier) === '2') return 1;
          if (m?.tier === 3 || String(m?.tier) === '3') return 2;
          return 10;
        };
        return order(a) - order(b);
      });
      const bestOrder = tierOrder(metas[0]);
      const rewardLines = metas.map(formatRewardLine);
      fields.push({
        userId,
        bestOrder, 
        name: `<@${userId}>`, // placeholder; will resolve per-page
        value: rewardLines.join('\n'),
        inline: false
      });
    }
    
    // NEW: sort users so top placements appear first
    fields.sort((a, b) => {
      const d = (a.bestOrder ?? 10) - (b.bestOrder ?? 10);
      if (d !== 0) return d;
      // Tie-breaker: keep consistent ordering
      return String(a.userId).localeCompare(String(b.userId));
    });
    
    // Discord embed field limit: 25 fields per embed. Paginate if needed.
    const MAX_FIELDS_PER_EMBED = 25;
    let page = 0;
    const totalPages = Math.ceil(fields.length / MAX_FIELDS_PER_EMBED) || 1;

    // Cache resolved display names to avoid repeated fetches
    const displayNameCache = new Map();

    while (page * MAX_FIELDS_PER_EMBED < fields.length) {
      const slice = fields.slice(page * MAX_FIELDS_PER_EMBED, (page + 1) * MAX_FIELDS_PER_EMBED);

      // Resolve display names for users on this page (best-effort)
      const userIdsOnPage = slice.map(f => f.userId);
      const allowedMentionsUsers = [];

      for (const uid of userIdsOnPage) {
        if (displayNameCache.has(uid)) continue;

        let display = `<@${uid}>`; // fallback mention token
        try {
          const guild = ch.guild;
          if (guild) {
            // Try to fetch member (nickname/displayName preferred)
            const member = await guild.members.fetch(uid).catch(() => null);
            if (member) {
              display = member.displayName;
            } else {
              // Fallback to global user object
              const user = await client.users.fetch(uid).catch(() => null);
              if (user) display = `${user.username}${user.discriminator ? '#' + user.discriminator : ''}`.replace(/#$/, '');
            }
          } else {
            const user = await client.users.fetch(uid).catch(() => null);
            if (user) display = `${user.username}${user.discriminator ? '#' + user.discriminator : ''}`.replace(/#$/, '');
          }
        } catch (e) {
          // ignore and keep fallback mention token
        }
        displayNameCache.set(uid, display);
      }

      // Build embed and add fields using resolved display names
      const embed = new EmbedBuilder()
        .setTitle(`Results for ${oshiLabel}'s Live Stream`)
        .setDescription(`As a reward ${oshiLabel} has decided to give each loyal fan rewards fitting of their cheers!`)
        .setColor(0x00AE86)
        .setTimestamp(new Date());

      for (const f of slice) {
        const display = displayNameCache.get(f.userId) || `<@${f.userId}>`;
        // If display is still the raw mention token, include the ID in allowedMentions so Discord can resolve it
        if (display === `<@${f.userId}>`) allowedMentionsUsers.push(f.userId);
        embed.addFields({ name: display, value: f.value, inline: f.inline });
      }

      if (totalPages > 1) {
        embed.setFooter({ text: `Page ${page + 1} of ${totalPages}` });
      }

      // Send with explicit allowedMentions.users for this page to ensure mentions render where possible
      await ch.send({
        embeds: [embed],
        allowedMentions: { users: allowedMentionsUsers }
      });

      page += 1;
    }

    console.log(`[postBossResults] posted ${fields.length} user entries for event ${eventId}`);
  } catch (err) {
    console.error('[postBossResults] error', err);
  }
}

module.exports = { postBossResults };
