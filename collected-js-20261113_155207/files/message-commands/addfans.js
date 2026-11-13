// message-commands/addfans.js
const { EmbedBuilder } = require('discord.js');
const User = require('../models/User');
const PullQuota = require('../models/PullQuota'); // ✅ REQUIRED

const PREFIX = '!';
const COMMAND_NAME = 'addfans';

const ALLOWED_IDS = [
  '153551890976735232',
  '409717160995192832',
  '272129129841688577',
];

const MAX_FANS = 1_000_000_000;
const MAX_RECIPIENTS = 500;

function parseFlags(content) {
  const tokenRe = /--[^\s=]+(?:=(?:"[^"]*"|'[^']*'|[^\s]+))?/g;
  const tokens = content.match(tokenRe) || [];
  const flags = {};

  for (const tok of tokens) {
    const withoutLeading = tok.slice(2);
    const [k, v] = withoutLeading.split(/=(.+)/);

    if (v === undefined) {
      flags[k] = true;
    } else {
      flags[k] = v
        .replace(/^"(.*)"$/s, '$1')
        .replace(/^'(.*)'$/s, '$1');
    }
  }

  return flags;
}

module.exports = {
  name: COMMAND_NAME,
  description: 'Adds fans/points to users, roles, everyone, or PullQuota',

  async execute(message) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      if (!ALLOWED_IDS.includes(String(message.author.id))) {
        return message.reply({
          content: 'You are not allowed to use this command.',
        }).catch(() => {});
      }

      const flags = parseFlags(message.content);

      const rawTarget = flags.target || flags.t;
      const rawAmount = flags.amount || flags.fans || flags.points || flags.a;

      // ✅ FIXED validation to allow pullquota
      if ((!rawTarget && !flags.pullquota) || rawAmount === undefined) {
        return message.reply({
          content:
            'Usage:\n' +
            '`!addfans --target=@user|@role|@everyone --amount=1000`\n' +
            '`!addfans --pullquota --amount=1000`',
        }).catch(() => {});
      }

      const amount = Number(rawAmount);

      if (!Number.isFinite(amount) || amount <= 0) {
        return message.reply({
          content: 'Amount must be a positive number.',
        }).catch(() => {});
      }

      const fansToAdd = Math.min(Math.floor(amount), MAX_FANS);

      const guild = message.guild;

      let recipients = [];

      try {
        // ✅ PullQuota targeting
        if (flags.pullquota) {
          const pqDocs = await PullQuota.find({}, 'userId').lean();

          if (!pqDocs || pqDocs.length === 0) {
            return message.reply({
              content: 'No PullQuota users found.',
            }).catch(() => {});
          }

          recipients = pqDocs.map(d => ({
            id: String(d.userId),
          }));
        } else {
          if (!guild) {
            return message.reply({
              content: 'This command must be used in a guild.',
            }).catch(() => {});
          }

          if (rawTarget === '@everyone' || rawTarget === '@here') {
            const allMembers = await guild.members.fetch().catch(() => null);

            if (!allMembers) {
              return message.reply({
                content: 'Failed to fetch members.',
              }).catch(() => {});
            }

            recipients = Array.from(allMembers.values()).map(m => m.user);
          } else {
            const mentionId = (
              rawTarget.match(/<@!?(\d+)>/) ||
              rawTarget.match(/<@&(\d+)>/) ||
              rawTarget.match(/^(\d+)$/)
            )?.[1];

            if (mentionId) {
              const member =
                guild.members.cache.get(mentionId) ||
                await guild.members.fetch(mentionId).catch(() => null);

              if (member) {
                recipients = [member.user];
              } else {
                const role = guild.roles.cache.get(mentionId);
                if (role) {
                  recipients = Array.from(role.members.values()).map(m => m.user);
                }
              }
            } else {
              const roleByName = guild.roles.cache.find(
                r => r.name.toLowerCase() === rawTarget.toLowerCase()
              );

              if (roleByName) {
                recipients = Array.from(roleByName.members.values()).map(m => m.user);
              } else {
                const memberByTag = guild.members.cache.find(
                  m =>
                    `${m.user.username}#${m.user.discriminator}`.toLowerCase() ===
                    rawTarget.toLowerCase()
                );

                if (memberByTag) {
                  recipients = [memberByTag.user];
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('[addfans] resolve recipients error', err);

        return message.reply({
          content: 'Error resolving recipients.',
        }).catch(() => {});
      }

      // ✅ dedupe + cap
      recipients = Array.from(
        new Map(recipients.map(u => [u.id, u])).values()
      ).slice(0, MAX_RECIPIENTS);

      if (!recipients.length) {
        return message.reply({
          content: 'No recipients found.',
        }).catch(() => {});
      }

      const results = [];

      for (const user of recipients) {
        try {
          await User.updateOne(
            { id: user.id },
            {
              $inc: { points: fansToAdd },
              $setOnInsert: {
                pulls: 0,
                pullsSinceLastSEC: 0,
                cards: [],
                pendingAttempts: [],
              },
            },
            { upsert: true }
          ).exec();

          results.push({
            userId: user.id,
            tag: user.username
              ? `${user.username}#${user.discriminator}`
              : `ID:${user.id}`,
            ok: true,
          });
        } catch (err) {
          console.error('[addfans] error adding fans to', user.id, err);

          results.push({
            userId: user.id,
            tag: `ID:${user.id}`,
            ok: false,
            note: 'database error',
          });
        }
      }

      const succeeded = results.filter(r => r.ok).length;
      const failed = results.length - succeeded;

      const lines = results.slice(0, 25).map(r => {
        if (r.ok) return `✅ ${r.tag} — +${fansToAdd.toLocaleString()} fans`;
        return `❌ ${r.tag} — ${r.note || 'failed'}`;
      });

      if (results.length > 25) {
        lines.push(`...and ${results.length - 25} more results omitted`);
      }

      const embed = new EmbedBuilder()
        .setTitle('Add Fans Results')
        .setDescription(
          `Added **${fansToAdd.toLocaleString()} fans** to **${recipients.length}** recipient(s).\n\n` +
          `**Succeeded:** ${succeeded}\n` +
          `**Failed:** ${failed}\n\n` +
          lines.join('\n')
        )
        .setColor(succeeded ? '#2ecc71' : '#e67e22');

      return message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error('[addfans] unexpected error', err);

      return message.reply({
        content: 'Unexpected error running addfans.',
      }).catch(() => {});
    }
  },
};