// message-commands/adminremove.js
const { EmbedBuilder } = require('discord.js');
const User = require('../models/User');
const { normalizeCardName } = require('../utils/liveAsync');

const ALLOWED_IDS = [
  '153551890976735232',
  '409717160995192832',
  '272129129841688577',
];

const PREFIX = '!';
const MAX_COUNT = 1000;
const MAX_RECIPIENTS = 500;

function parseFlags(content) {
  const tokenRe = /--[^\s=]+(?:=(?:"[^"]*"|'[^']*'|[^\s]+))?/g;
  const tokens = content.match(tokenRe) || [];
  const flags = {};

  for (const tok of tokens) {
    const withoutLeading = tok.slice(2);
    const [k, v] = withoutLeading.split(/=(.+)/);

    if (v === undefined) flags[k] = true;
    else {
      flags[k] = v
        .replace(/^"(.*)"$/s, '$1')
        .replace(/^'(.*)'$/s, '$1');
    }
  }

  return flags;
}

module.exports = {
  name: 'adminremove',
  description: 'Remove card(s) from a user/role/@everyone (owner/admin only)',

  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      if (!ALLOWED_IDS.includes(String(message.author.id))) {
        return message.reply({
          content: 'You are not allowed to use this command.',
        }).catch(() => {});
      }

      const flags = parseFlags(message.content);

      const rawTarget = flags.target;
      const rawName = flags.name || flags.card || flags.c;
      const rawRarity = flags.rarity || flags.r;
      const count = Math.max(1, Math.min(MAX_COUNT, Number(flags.count || 1)));

      if (!rawTarget || !rawName || !rawRarity) {
        return message.reply({
          content:
            'Usage: !adminremove --target=@user|@role|@everyone --rarity="UP" --name="Suisei 001" [--count=1]',
        }).catch(() => {});
      }

      const guild = message.guild;
      if (!guild) {
        return message.reply({
          content: 'This command must be used in a guild.',
        }).catch(() => {});
      }

      // Resolve recipients (same logic as admingive)
      let recipients = [];

      try {
        if (rawTarget === '@everyone' || rawTarget === '@here') {
          const all = await guild.members.fetch().catch(() => null);
          if (!all) return message.reply({ content: 'Failed to fetch members.' });

          recipients = Array.from(all.values()).map(m => m.user);
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

              if (memberByTag) recipients = [memberByTag.user];
            }
          }
        }
      } catch (err) {
        console.error('[adminremove] resolve recipients error', err);
        return message.reply({ content: 'Error resolving recipients.' }).catch(() => {});
      }

      recipients = Array.from(
        new Map(recipients.map(u => [u.id, u])).values()
      ).slice(0, MAX_RECIPIENTS);

      if (!recipients.length) {
        return message.reply({ content: 'No recipients found.' }).catch(() => {});
      }

      const normName = normalizeCardName(rawName);
      const rarity = String(rawRarity);

      const results = [];

      for (const user of recipients) {
        try {
          const userDoc = await User.findOne({ id: user.id }).exec();

          if (!userDoc) {
            results.push({
              tag: `${user.username}#${user.discriminator}`,
              ok: false,
              note: 'no data',
            });
            continue;
          }

          const card = userDoc.cards.find(
            c => c.name === normName && c.rarity === rarity
          );

          if (!card) {
            results.push({
              tag: `${user.username}#${user.discriminator}`,
              ok: false,
              note: 'card not owned',
            });
            continue;
          }

          if (card.count <= count) {
            // Remove card entirely
            userDoc.cards = userDoc.cards.filter(
              c => !(c.name === normName && c.rarity === rarity)
            );
          } else {
            // Reduce count
            card.count -= count;
          }

          await userDoc.save();

          results.push({
            tag: `${user.username}#${user.discriminator}`,
            ok: true,
          });
        } catch (err) {
          console.error('[adminremove] error removing card from', user.id, err);

          results.push({
            tag: `${user.username}#${user.discriminator}`,
            ok: false,
            note: 'error',
          });
        }
      }

      const succeeded = results.filter(r => r.ok).length;
      const failed = results.length - succeeded;

      const lines = results.slice(0, 25).map(r => {
        if (r.ok) {
          return `✅ ${r.tag} — removed [${rarity}] ${normName} x${count}`;
        }
        return `❌ ${r.tag} — ${r.note}`;
      });

      if (results.length > 25) {
        lines.push(`...and ${results.length - 25} more results omitted`);
      }

      const embed = new EmbedBuilder()
        .setTitle('Admin Remove Results')
        .setDescription(
          `Removed **${normName} [${rarity}] x${count}** from **${recipients.length}** recipient(s).\n\n` +
          `**Succeeded:** ${succeeded}\n` +
          `**Failed:** ${failed}\n\n` +
          lines.join('\n')
        )
        .setColor(succeeded ? '#e74c3c' : '#e67e22');

      return message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error('[adminremove] unexpected error', err);
      return message.reply({
        content: 'Unexpected error running adminremove.',
      }).catch(() => {});
    }
  },
};