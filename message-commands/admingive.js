const { EmbedBuilder } = require('discord.js');
const User = require('../models/User');
const { incOrUpsertCard, normalizeCardName } = require('../utils/liveAsync');

const ALLOWED_IDS = ['153551890976735232', '409717160995192832'];
const PREFIX = '!';
const MAX_COUNT = 1000;
const MAX_RECIPIENTS = 500;

function parseFlags(content) {
  const tokenRe = /--[^\s=]+(?:=(?:"[^"]*"|'[^']*'|[^\s]+))?/g;
  const tokens = (content.match(tokenRe) || []);
  const flags = {};
  for (const tok of tokens) {
    const withoutLeading = tok.slice(2);
    const [k, v] = withoutLeading.split(/=(.+)/);
    if (v === undefined) flags[k] = true;
    else {
      const stripped = v.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
      flags[k] = stripped;
    }
  }
  return flags;
}

module.exports = {
  name: 'admingive',
  description: 'Give card(s) to a user/role/@everyone (owner/admin only)',
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      // Permission check (multiple allowed IDs)
      if (!ALLOWED_IDS.includes(String(message.author.id))) {
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      const flags = parseFlags(message.content);

      const rawTarget = flags.target;
      const rawName = flags.name || flags.card || flags.c;
      const rawRarity = flags.rarity || flags.r;
      const count = Math.max(1, Math.min(MAX_COUNT, Number(flags.count || 1)));

      if (!rawTarget || !rawName || !rawRarity) {
        return message.reply({
          content: 'Usage: !admingive --target=@user|@role|@everyone --rarity="SEC" --name="Miko 001" [--count=1]'
        }).catch(() => {});
      }

      const guild = message.guild;
      if (!guild) return message.reply({ content: 'This command must be used in a guild.' }).catch(() => {});

      // Resolve recipients (single token or id/mention/role/everyone/here)
      let recipients = [];

      try {
        if (rawTarget === '@everyone' || rawTarget === '@here') {
          const all = await guild.members.fetch().catch(() => null);
          if (!all) return message.reply({ content: 'Failed to fetch members.' }).catch(() => {});
          recipients = Array.from(all.values()).map(m => m.user);
        } else {
          const mentionId = (rawTarget.match(/<@!?(\d+)>/) || rawTarget.match(/<@&(\d+)>/) || rawTarget.match(/^(\d+)$/))?.[1];
          if (mentionId) {
            const member = guild.members.cache.get(mentionId) || await guild.members.fetch(mentionId).catch(() => null);
            if (member) recipients = [member.user];
            else {
              const role = guild.roles.cache.get(mentionId);
              if (role) recipients = Array.from(role.members.values()).map(m => m.user);
            }
          } else {
            const roleByName = guild.roles.cache.find(r => r.name.toLowerCase() === rawTarget.toLowerCase());
            if (roleByName) recipients = Array.from(roleByName.members.values()).map(m => m.user);
            else {
              const memberByTag = guild.members.cache.find(m => `${m.user.username}#${m.user.discriminator}`.toLowerCase() === rawTarget.toLowerCase());
              if (memberByTag) recipients = [memberByTag.user];
            }
          }
        }
      } catch (err) {
        console.error('[admingive] resolve recipients error', err);
        return message.reply({ content: 'Error resolving recipients.' }).catch(() => {});
      }

      // Dedupe and cap recipients to avoid accidental huge operations
      recipients = Array.from(new Map(recipients.map(u => [u.id, u])).values()).slice(0, MAX_RECIPIENTS);

      if (!recipients.length) {
        return message.reply({ content: 'No recipients found.' }).catch(() => {});
      }

      const normName = normalizeCardName(rawName);
      const rarity = String(rawRarity);

      const results = [];
      for (const user of recipients) {
        try {
          // Ensure DB user exists
          await User.updateOne({ id: user.id }, { $setOnInsert: { pulls: 0, points: 0, cards: [], pendingAttempts: [] } }, { upsert: true }).exec();

          let lastRes = null;
          for (let i = 0; i < count; i++) {
            const res = await incOrUpsertCard(user.id, rawName, rarity);
            lastRes = res;
            if (!res) {
              results.push({ userId: user.id, tag: `${user.username}#${user.discriminator}`, ok: false, note: 'db-failed' });
              break;
            }
          }

          if (lastRes && lastRes.card) {
            results.push({ userId: user.id, tag: `${user.username}#${user.discriminator}`, ok: true, card: lastRes.card.name, rarity: lastRes.card.rarity, path: lastRes.path });
          } else if (!lastRes) {
            // already pushed above to results
          } else {
            results.push({ userId: user.id, tag: `${user.username}#${user.discriminator}`, ok: false, note: 'unknown-result' });
          }
        } catch (err) {
          console.error('[admingive] error giving card to', user.id, err);
          results.push({ userId: user.id, tag: `${user.username}#${user.discriminator}`, ok: false, note: 'exception' });
        }
      }

      const succeeded = results.filter(r => r.ok).length;
      const failed = results.length - succeeded;

      const lines = results.slice(0, 25).map(r => {
        if (r.ok) return `✅ ${r.tag} — ${r.card} [${r.rarity}] (${r.path})`;
        return `❌ ${r.tag} — ${r.note || 'failed'}`;
      });

      if (results.length > 25) lines.push(`...and ${results.length - 25} more results omitted`);

      const embed = new EmbedBuilder()
        .setTitle('Admingive Results')
        .setDescription(`Gave **${normName}** [${rarity}] x${count} to ${recipients.length} recipient(s).\n\n**Succeeded:** ${succeeded}\n**Failed:** ${failed}`)
        .setColor(succeeded ? '#2ecc71' : '#e67e22')

      return message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error('[admingive] unexpected error', err);
      return message.reply({ content: 'Unexpected error running admingive.' }).catch(() => {});
    }
  }
};
