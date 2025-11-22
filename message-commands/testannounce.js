// message-commands/testannounce.js
const { EmbedBuilder } = require('discord.js');
const User = require('../models/User');
const PullQuota = require('../models/PullQuota');
const config = require('../config.json');

const OWNER_ID2 = '153551890976735232';
const OWNER_ID = '409717160995192832';
const PREFIX = '!';
const COMMAND_NAME = 'testannounce';
const MAX_RECIPIENTS_HARD_CAP = 2000;
const DEFAULT_COUNT_PARAM = 1000;
const BATCH_SIZE = 200;

function escapeRegex(str) {
  return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// parse args: !testannounce "Title" "Message" [--flag=val ...]
// Title and Message must be quoted. Message can contain newlines.
function parseArgs(content, cmdName = COMMAND_NAME) {
  const re = new RegExp(`^${escapeRegex(PREFIX)}\\s*${escapeRegex(cmdName)}\\s+"([^"]+)"\\s+"([^"]+)"\\s*(.*)$`, 's');
  const m = content.match(re);
  if (!m) return null;
  const [, title, body, tail] = m;
  const flags = {};

  // split tail into tokens but keep quoted values (e.g., --embed="http://...")
  const tokenRe = /--[^\s=]+(?:=(?:"[^"]*"|'[^']*'|[^\s]+))?/g;
  const tokens = (tail || '').match(tokenRe) || [];

  for (const tok of tokens) {
    const withoutLeading = tok.slice(2);
    const [k, v] = withoutLeading.split(/=(.+)/);
    if (v === undefined) {
      flags[k] = true;
    } else {
      const stripped = v.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
      flags[k] = stripped;
    }
  }

  return { title, body, flags };
}

module.exports = {
  name: COMMAND_NAME,
  description: 'Owner-only announcement; posts to testChannelId and optionally grants event pulls',
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      console.log(`[${COMMAND_NAME}] invoked by`, message.author.id);

      if (message.author.id !== OWNER_ID && message.author.id !== OWNER_ID2) {
        console.log(`[${COMMAND_NAME}] denied owner check`, message.author.id);
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      const parsed = parseArgs(message.content, module.exports.name);
      if (!parsed) {
        return message.reply({
          content:
            `Usage: ${PREFIX}${COMMAND_NAME} "Title" "Message" --pulls=2 --target=@everyone --count=50 --embed="https://..." --plain --channel=123`
        }).catch(() => {});
      }

      const { title, body, flags } = parsed;
      const color = flags.color || '#2b2d31';
      const pullsPer = Math.max(0, Number(flags.pulls || 0));
      const countParam = Math.max(1, Math.min(Number(flags.count || DEFAULT_COUNT_PARAM), MAX_RECIPIENTS_HARD_CAP));
      const targetRaw = flags.target || null;

      const embedUrl = flags.embed || null;
      const sendAsEmbed = !(flags.plain || flags['no-embed']);

      console.log(`[${COMMAND_NAME}] parsed`, { title, pullsPer, targetRaw, countParam, embedUrl, sendAsEmbed });

      let embed;
      if (sendAsEmbed) {
        embed = new EmbedBuilder().setTitle(title).setDescription(body).setColor(color).setTimestamp();
        if (embedUrl) {
          try {
            // defensive validation; will throw on invalid URL
            new URL(embedUrl);
            embed.setImage(embedUrl);
          } catch {
            console.warn(`[${COMMAND_NAME}] invalid embed URL ignored:`, embedUrl);
          }
        }
      }

      const channelId = (flags.channel && String(flags.channel)) || config.testChannelId;
      if (!channelId) {
        return message.reply({ content: 'No testChannelId found in config and no --channel provided.' }).catch(() => {});
      }

      const targetChannel = await message.client.channels.fetch(channelId).catch(() => null);
      if (!targetChannel || typeof targetChannel.send !== 'function') {
        return message.reply({ content: `Unable to fetch channel ${channelId}. Check bot permissions and that channel exists.` }).catch(() => {});
      }

      let posted;
      try {
        if (sendAsEmbed && embed) {
          posted = await targetChannel.send({ embeds: [embed] });
        } else {
          const text = `**${title}**\n\n${body}`;
          posted = await targetChannel.send({ content: text });
        }
      } catch (err) {
        console.error(`[${COMMAND_NAME}] send embed/text failed`, err);
        return message.reply({ content: 'Failed to post announcement to test channel (check bot perms).' }).catch(() => {});
      }

      if (pullsPer <= 0 || !targetRaw) {
        return message.reply({ content: `Announcement posted to <#${channelId}> (id: ${posted.id}). No pulls granted.` }).catch(() => {});
      }

      const guild = message.guild;
      if (!guild) return message.reply({ content: 'This command must be used in a guild channel.' }).catch(() => {});

      let recipients = [];

      try {
        if (targetRaw === '@everyone' || targetRaw === '@here') {
          const allMembers = await guild.members.fetch().catch(() => null);
          if (!allMembers) {
            return message.reply({ content: 'Unable to fetch guild members. Ensure Guild Members intent is enabled and bot has member access.' }).catch(() => {});
          }
          recipients = Array.from(allMembers.values()).map(m => m.user);
        } else {
          const mentionId = (targetRaw.match(/<@!?(\d+)>/) || targetRaw.match(/<@&(\d+)>/) || targetRaw.match(/^(\d+)$/))?.[1];
          if (mentionId) {
            const member = guild.members.cache.get(mentionId) || await guild.members.fetch(mentionId).catch(() => null);
            if (member) {
              recipients = [member.user];
            } else {
              const role = guild.roles.cache.get(mentionId);
              if (role) {
                recipients = Array.from(role.members.values()).map(m => m.user);
                if (recipients.length === 0) {
                  const allMembers = await guild.members.fetch().catch(() => null);
                  if (allMembers) recipients = Array.from(allMembers.values()).filter(m => m.roles.cache.has(role.id)).map(m => m.user);
                }
              }
            }
          } else {
            const roleByName = guild.roles.cache.find(r => r.name.toLowerCase() === targetRaw.toLowerCase());
            if (roleByName) {
              recipients = Array.from(roleByName.members.values()).map(m => m.user);
              if (recipients.length === 0) {
                const allMembers = await guild.members.fetch().catch(() => null);
                if (allMembers) recipients = Array.from(allMembers.values()).filter(m => m.roles.cache.has(roleByName.id)).map(m => m.user);
              }
            } else {
              const memberByTag = guild.members.cache.find(m => `${m.user.username}#${m.user.discriminator}`.toLowerCase() === targetRaw.toLowerCase());
              if (memberByTag) recipients = [memberByTag.user];
            }
          }
        }
      } catch (err) {
        console.error(`[${COMMAND_NAME}] resolve recipients error`, err);
        return message.reply({ content: 'Error resolving recipients.' }).catch(() => {});
      }

      const unique = Array.from(new Map(recipients.map(u => [u.id, u])).values());
      const toProcess = unique.slice(0, Math.min(countParam, MAX_RECIPIENTS_HARD_CAP));

      if (toProcess.length === 0) {
        return message.reply({ content: 'No recipients found to grant pulls to.' }).catch(() => {});
      }

      console.log(`[${COMMAND_NAME}] granting pulls to`, toProcess.length, 'users');

      for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
        const batch = toProcess.slice(i, i + BATCH_SIZE);

        const pullOps = batch.map(user => ({
          updateOne: {
            filter: { userId: user.id },
            update: { $inc: { eventPulls: pullsPer }, $setOnInsert: { lastRefill: new Date() } },
            upsert: true
          }
        }));

        const userOps = batch.map(user => ({
          updateOne: {
            filter: { id: user.id },
            update: { $setOnInsert: { pulls: 0, cards: [] } },
            upsert: true
          }
        }));

        try {
          await PullQuota.bulkWrite(pullOps);
          await User.bulkWrite(userOps);
        } catch (err) {
          console.error(`[${COMMAND_NAME}] bulkWrite error`, err);
          return message.reply({ content: 'Database error while granting pulls.' }).catch(() => {});
        }
      }

      return message.reply({ content: `Announcement posted to <#${channelId}> (id: ${posted.id}). Granted ${pullsPer} pull(s) to ${toProcess.length} recipient(s).` }).catch(() => {});
    } catch (err) {
      console.error(`[${COMMAND_NAME}] unexpected error`, err);
      try { await message.reply({ content: 'Unexpected error running testannounce.' }); } catch {}
    }
  }
};
