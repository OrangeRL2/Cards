// message-commands/addEventPulls.js
const { EmbedBuilder } = require('discord.js'); // optional, kept for parity with style
const PullQuota = require('../models/PullQuota');
const PREFIX = '!';
const COMMAND_NAME = 'addeventpulls';
const OWNER_ID = '409717160995192832'; // replace or add more checks as needed
const OWNER_ID2 = '153551890976735232';
const OWNER_ID3 = '272129129841688577';
const MAX_RECIPIENTS_HARD_CAP = 2000;
const DEFAULT_COUNT_PARAM = 1000;
const BATCH_SIZE = 200;

function escapeRegex(str) {
  return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// parse simple flags: !addeventpulls <target> --pulls=2 --count=100
function parseFlags(content) {
  const parts = content.split(/\s+/).slice(1); // drop command token
  const flags = {};
  for (const p of parts) {
    if (!p.startsWith('--')) continue;
    const without = p.slice(2);
    const [k, v] = without.split(/=(.+)/);
    flags[k] = v === undefined ? true : v.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
  }
  return flags;
}

module.exports = {
  name: COMMAND_NAME,
  description: 'Owner-only. Grants event pulls to target users.',
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      if (message.author.id !== OWNER_ID && message.author.id !== OWNER_ID2&& message.author.id !== OWNER_ID3) {
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      // content tokens: command then target (optional) then flags
      const tokens = message.content.trim().split(/\s+/);
      // tokens[0] is command, tokens[1] may be target or flags
      const maybeTarget = tokens[1] && !tokens[1].startsWith('--') ? tokens[1] : null;
      const flags = parseFlags(message.content);

      const pullsPer = Math.max(0, Number(flags.pulls || 1));
      const countParam = Math.max(1, Math.min(Number(flags.count || DEFAULT_COUNT_PARAM), MAX_RECIPIENTS_HARD_CAP));

      if (pullsPer <= 0) {
        return message.reply({ content: 'pulls must be a positive number.' }).catch(() => {});
      }

      const guild = message.guild;
      if (!guild && (maybeTarget === '@everyone' || maybeTarget === '@here')) {
        return message.reply({ content: 'This command must be used in a guild channel for bulk targeting.' }).catch(() => {});
      }

      let recipients = [];

      try {
        if (!maybeTarget || maybeTarget === '@everyone' || maybeTarget === '@here') {
          // default to @everyone when omitted or explicitly given
          const allMembers = await guild.members.fetch().catch(() => null);
          if (!allMembers) {
            return message.reply({ content: 'Unable to fetch guild members. Ensure intents and bot access are configured.' }).catch(() => {});
          }
          recipients = Array.from(allMembers.values()).map(m => m.user);
        } else {
          // try mention, id, role mention, role id
          const mentionId = (maybeTarget.match(/<@!?(\d+)>/) || maybeTarget.match(/<@&(\d+)>/) || maybeTarget.match(/^(\d+)$/))?.[1];
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
            // role by name
            const roleByName = guild.roles.cache.find(r => r.name.toLowerCase() === maybeTarget.toLowerCase());
            if (roleByName) {
              recipients = Array.from(roleByName.members.values()).map(m => m.user);
              if (recipients.length === 0) {
                const allMembers = await guild.members.fetch().catch(() => null);
                if (allMembers) recipients = Array.from(allMembers.values()).filter(m => m.roles.cache.has(roleByName.id)).map(m => m.user);
              }
            } else {
              // try member by tag username#discrim
              const memberByTag = guild.members.cache.find(m => `${m.user.username}#${m.user.discriminator}`.toLowerCase() === maybeTarget.toLowerCase());
              if (memberByTag) recipients = [memberByTag.user];
            }
          }
        }
      } catch (err) {
        console.error('[addeventpulls] resolve recipients error', err);
        return message.reply({ content: 'Error resolving recipients.' }).catch(() => {});
      }

      const unique = Array.from(new Map(recipients.map(u => [u.id, u])).values());
      const toProcess = unique.slice(0, Math.min(countParam, MAX_RECIPIENTS_HARD_CAP));
      if (toProcess.length === 0) {
        return message.reply({ content: 'No recipients found to grant event pulls to.' }).catch(() => {});
      }

      for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
        const batch = toProcess.slice(i, i + BATCH_SIZE);

        const pullOps = batch.map(user => ({
          updateOne: {
            filter: { userId: user.id },
            update: { $inc: { eventPulls: pullsPer }, $setOnInsert: { lastRefill: new Date() } },
            upsert: true
          }
        }));

        try {
          await PullQuota.bulkWrite(pullOps);
        } catch (err) {
          console.error('[addeventpulls] bulkWrite error', err);
          return message.reply({ content: 'Database error while granting event pulls.' }).catch(() => {});
        }
      }

      return message.reply({ content: `Granted ${pullsPer} event pull(s) to ${toProcess.length} user(s).` }).catch(() => {});
    } catch (err) {
      console.error('[addeventpulls] unexpected error', err);
      try { await message.reply({ content: 'Unexpected error running addEventPulls.' }); } catch {}
    }
  }
};
