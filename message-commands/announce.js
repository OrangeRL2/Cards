// message-commands/announce.js
const { EmbedBuilder } = require('discord.js');
const User = require('../models/User');
const PullQuota = require('../models/PullQuota');
const config = require('../config.json');

const OWNER_ID = '153551890976735232'; // replace with your Discord ID (string)
const OWNER_ID2 = '409717160995192832';
const OWNER_ID3 = '272129129841688577';
const PREFIX = '!'; // prefix used by your dispatcher
const MAX_RECIPIENTS_HARD_CAP = 2000;
const DEFAULT_COUNT_PARAM = 2000;
const BATCH_SIZE = 200;

// parse args: !announce "Title" "Message" [--flag=val ...]
// Title and Message must be quoted. Message can contain newlines.
function parseArgs(content) {
  const m = content.match(/^!announce\s+"([^"]+)"\s+"([^"]+)"\s*(.*)$/s);
  if (!m) return null;
  const [, title, body, tail] = m;
  const flags = {};

  // split tail into tokens but keep quoted values (e.g., --embed="http://...")
  const tokenRe = /--[^\s=]+(?:=(?:"[^"]*"|'[^']*'|[^\s]+))?/g;
  const tokens = (tail || '').match(tokenRe) || [];

  for (const tok of tokens) {
    const withoutLeading = tok.slice(2); // remove --
    const [k, v] = withoutLeading.split(/=(.+)/); // split on first =
    if (v === undefined) {
      flags[k] = true;
    } else {
      // strip surrounding quotes (single or double) if present
      const stripped = v.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
      flags[k] = stripped;
    }
  }

  return { title, body, flags };
}

module.exports = {
  name: 'announce',
  description: 'Owner-only announcement; posts to birthdayChannelId and optionally grants event pulls',
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      console.log('[announce] invoked by', message.author.id);

      // Owner guard (include OWNER_ID3)
      if (
        message.author.id !== OWNER_ID &&
        message.author.id !== OWNER_ID2 &&
        message.author.id !== OWNER_ID3
      ) {
        console.log('[announce] denied owner check', message.author.id);
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      const parsed = parseArgs(message.content);
      if (!parsed) {
        return message.reply({
          content:
            'Usage: !announce "Title" "Message" --pulls=2 --target=@everyone --count=50 --embed="https://..." --plain --channel=123 --ping=<id|@name|@everyone> --pullquota'
        }).catch(() => {});
      }

      const { title, body, flags } = parsed;
      const color = flags.color || '#2b2d31';
      const pullsPer = Math.max(0, Number(flags.pulls || 0));
      const countParam = Math.max(1, Math.min(Number(flags.count || DEFAULT_COUNT_PARAM), MAX_RECIPIENTS_HARD_CAP));
      const targetRaw = flags.target || null;

      const embedUrl = flags.embed || null;
      const sendAsEmbed = !(flags.plain || flags['no-embed']); // default: embed unless --plain or --no-embed set

      console.log('[announce] parsed', { title, pullsPer, targetRaw, countParam, embedUrl, sendAsEmbed, pullquota: !!flags.pullquota });

      // Build embed (if used)
      let embed;
      if (sendAsEmbed) {
        embed = new EmbedBuilder().setTitle(title).setDescription(body).setColor(color).setTimestamp();
        if (embedUrl) {
          // add as image; Discord will autoplay GIFs in embeds when supported
          embed.setImage(embedUrl);
        }
      }

      // Determine birthday channel id from config, allow override --channel=<id>
      const channelId = (flags.channel && String(flags.channel)) || config.birthdayChannelId;
      if (!channelId) {
        return message.reply({ content: 'No birthdayChannelId found in config and no --channel provided.' }).catch(() => {});
      }

      const targetChannel = await message.client.channels.fetch(channelId).catch((e) => null);
      if (!targetChannel || typeof targetChannel.send !== 'function') {
        return message.reply({ content: `Unable to fetch channel ${channelId}. Check bot permissions and that channel exists.` }).catch(() => {});
      }

      // Helper: resolve --ping token to a mention string usable in top-level content
      async function resolvePingToken(guild, pingToken) {
        if (!pingToken) return null;
        const t = String(pingToken).trim();

        // direct everyone/here
        if (/^@everyone$/i.test(t)) return '@everyone';
        if (/^@here$/i.test(t)) return '@here';

        // already <@123...> or plain id
        const idMatch = t.match(/<@!?(\d+)>|^(\d+)$/);
        if (idMatch) {
          const id = idMatch[1] || idMatch[2];
          if (guild) {
            const member = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
            if (member) return `<@${id}>`;
            return `<@${id}>`; // best-effort even if not cached/fetchable
          }
          return `<@${id}>`;
        }

        // role mention by @Role or <@&id>
        const roleMatch = t.match(/<@&(\d+)>|^@(.+)$/);
        if (roleMatch && guild) {
          if (roleMatch[1]) {
            const role = guild.roles.cache.get(roleMatch[1]);
            if (role) return `<@&${role.id}>`;
          } else if (roleMatch[2]) {
            const roleName = roleMatch[2].trim();
            const role = guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
            if (role) return `<@&${role.id}>`;
          }
        }

        // try username#discrim
        if (guild) {
          const tagMatch = t.match(/^(.+)#(\d{4})$/);
          if (tagMatch) {
            const [ , name, discrim ] = tagMatch;
            const memberByTag = guild.members.cache.find(m => `${m.user.username}#${m.user.discriminator}`.toLowerCase() === `${name}#${discrim}`.toLowerCase());
            if (memberByTag) return `<@${memberByTag.id}>`;
          }

          // try exact username (case-insensitive) or display name
          const nameNoAt = t.replace(/^@/, '');
          const memberByName = guild.members.cache.find(m =>
            m.user.username.toLowerCase() === nameNoAt.toLowerCase() ||
            (m.nickname && m.nickname.toLowerCase() === nameNoAt.toLowerCase())
          );
          if (memberByName) return `<@${memberByName.id}>`;
        }

        // fallback: not resolvable
        return null;
      }

      // Build top-level mention from flags.ping (if provided)
      const guild = message.guild;
      let topMention = null;
      if (flags.ping) {
        topMention = await resolvePingToken(guild, flags.ping);
      }

      // Build allowedMentions based on topMention so Discord.js will actually deliver the ping
      const allowedMentions = { parse: [] };
      if (topMention === '@everyone' || topMention === '@here') {
        allowedMentions.parse.push('everyone');
      } else if (topMention && topMention.startsWith('<@&')) {
        // role mention: include roles parsing
        allowedMentions.parse.push('roles');
      } else if (topMention && topMention.startsWith('<@')) {
        const uid = topMention.match(/<@!?(\d+)>/)?.[1];
        if (uid) allowedMentions.users = [uid];
      }

      // Post to birthday channel (embed or plain) — place mention above embed/plain so it actually notifies
      let posted;
      try {
        if (sendAsEmbed && embed) {
          posted = await targetChannel.send({
            content: topMention || undefined,
            embeds: [embed],
            allowedMentions
          });
        } else {
          // plain text: include the ping above title/body
          const text = `${topMention ? topMention + '\n' : ''}**${title}**\n\n${body}`;
          posted = await targetChannel.send({ content: text, allowedMentions });
        }
      } catch (err) {
        console.error('[announce] send embed/text failed', err);
        return message.reply({ content: 'Failed to post announcement to birthday channel (check bot perms).' }).catch(() => {});
      }

      // If no pull grant requested, finish
      if (pullsPer <= 0 || (!targetRaw && !flags.pullquota)) {
        return message.reply({ content: `Announcement posted to <#${channelId}> (id: ${posted.id}). No pulls granted.` }).catch(() => {});
      }

      // Resolve recipients
      // If --pullquota flag is present, target every userId registered in PullQuota
      let recipients = [];

      try {
        if (flags.pullquota) {
          // Fetch all PullQuota userIds
          const pqDocs = await PullQuota.find({}, 'userId').lean().catch((e) => {
            console.error('[announce] PullQuota.find error', e);
            return null;
          });
          if (!pqDocs) {
            return message.reply({ content: 'Failed to fetch PullQuota records from database.' }).catch(() => {});
          }
          // Map to objects with id property so downstream code can use user.id
          recipients = pqDocs.map(d => ({ id: String(d.userId) }));
        } else {
          // existing behavior requires guild context
          if (!guild) return message.reply({ content: 'This command must be used in a guild channel.' }).catch(() => {});

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
        }
      } catch (err) {
        console.error('[announce] resolve recipients error', err);
        return message.reply({ content: 'Error resolving recipients.' }).catch(() => {});
      }

      // Dedupe and apply cap
      const unique = Array.from(new Map(recipients.map(u => [u.id, u])).values());
      const toProcess = unique.slice(0, Math.min(countParam, MAX_RECIPIENTS_HARD_CAP));

      if (toProcess.length === 0) {
        return message.reply({ content: 'No recipients found to grant pulls to.' }).catch(() => {});
      }

      console.log('[announce] granting pulls to', toProcess.length, 'users');

      // Bulk update in batches
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
          console.error('[announce] bulkWrite error', err);
          return message.reply({ content: 'Database error while granting pulls.' }).catch(() => {});
        }
      }

      return message.reply({ content: `Announcement posted to <#${channelId}> (id: ${posted.id}). Granted ${pullsPer} pull(s) to ${toProcess.length} recipient(s).` }).catch(() => {});
    } catch (err) {
      console.error('[announce] unexpected error', err);
      try { await message.reply({ content: 'Unexpected error running announce.' }); } catch {}
    }
  }
};
