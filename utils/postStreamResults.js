const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');
const oshis = require('../config/oshis');
const StreamActionLog = require('../models/StreamActionLog');
const StreamEvent = require('../models/StreamEvent');

function tierLabelFromMeta(meta) {
  const t = meta?.tier;
  if (t === 1 || String(t) === '1') return '1st place';
  if (t === 2 || String(t) === '2') return '2nd place';
  if (t === 3 || String(t) === '3') return '3rd place';
  if (typeof t === 'string') return t.charAt(0).toUpperCase() + t.slice(1);
  return 'Participation';
}

function tierOrder(meta) {
  const t = meta?.tier;
  if (t === 1 || String(t) === '1') return 0;
  if (t === 2 || String(t) === '2') return 1;
  if (t === 3 || String(t) === '3') return 2;
  return 10;
}

function formatRewardLine(meta) {
  return `${tierLabelFromMeta(meta)} reward:\n**[${meta?.reward || '(unknown)'}]** ${meta?.card || '(fallback)'}`;
}

async function postStreamResults(client, eventId) {
  try {
    const ev = await StreamEvent.findOne({ eventId }).lean();
    if (!ev) return;

    const rewardLogs = await StreamActionLog.find({ eventId, action: 'reward' }).lean();
    const channelId = config.streamChannelId || config.bossChannelId;
    const ch = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
    if (!ch?.isTextBased?.()) return;

    if (!rewardLogs.length) {
      await ch.send(`No rewards were logged for stream ${eventId}.`);
      return;
    }

    const rewardsByUser = new Map();
    for (const log of rewardLogs) {
      if (!rewardsByUser.has(log.userId)) rewardsByUser.set(log.userId, []);
      rewardsByUser.get(log.userId).push(log.meta || {});
    }

    const oshiCfg = oshis.find(o => o.id === ev.oshiId);
    const label = oshiCfg ? oshiCfg.label : ev.oshiId;
    const personal = new Map((ev.users || []).map(u => [u.userId, u.happiness || 0]));

    const fields = [];
    for (const [userId, metas] of rewardsByUser.entries()) {
      metas.sort((a, b) => tierOrder(a) - tierOrder(b));
      fields.push({
        userId,
        bestOrder: tierOrder(metas[0]),
        value: `❤️ Happiness contributed: **${Number(personal.get(userId) || 0).toLocaleString()}**\n${metas.map(formatRewardLine).join('\n')}`,
      });
    }
    fields.sort((a, b) => (a.bestOrder - b.bestOrder) || String(a.userId).localeCompare(String(b.userId)));

    const MAX_FIELDS = 25;
    const totalPages = Math.ceil(fields.length / MAX_FIELDS) || 1;
    const displayCache = new Map();

    for (let page = 0; page < totalPages; page++) {
      const slice = fields.slice(page * MAX_FIELDS, (page + 1) * MAX_FIELDS);
      const embed = new EmbedBuilder()
        .setTitle(`Results for ${label}'s Live Stream`)
        .setDescription(`${label} is giving rewards to the fans who supported the stream!`)
        .setColor(0x00AE86)
        .setTimestamp(new Date());

      for (const f of slice) {
        if (!displayCache.has(f.userId)) {
          let display = `<@${f.userId}>`;
          const member = ch.guild ? await ch.guild.members.fetch(f.userId).catch(() => null) : null;
          if (member) display = member.displayName;
          else {
            const user = await client.users.fetch(f.userId).catch(() => null);
            if (user) display = user.username;
          }
          displayCache.set(f.userId, display);
        }
        embed.addFields({ name: displayCache.get(f.userId), value: f.value, inline: false });
      }

      if (totalPages > 1) embed.setFooter({ text: `Page ${page + 1} of ${totalPages}` });
      await ch.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error('[postStreamResults] error', err);
  }
}

module.exports = { postStreamResults };
