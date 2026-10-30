// !forcelogin <discord user ID> <oshi name>
// Owner-only: choose which member appears in a user's NEXT daily HOLODORI
// login reward. The normal 3-5 star rarity distribution is retained.
const { randomUUID } = require('node:crypto');
const oshis = require('../config/oshis');
const ForcedLoginReward = require('../models/ForcedLoginReward');
const {
  normalizeMemberName,
  hasMemberHolodoriLoginCards,
} = require('../utils/holodoriLoginReward');

const OWNER_IDS = new Set([
  '153551890976735232',
]);

module.exports = {
  name: 'forcelogin',
  description: 'Owner only: force a member for the next successful daily HOLODORI login reward.',
  async execute(message, args = []) {
    if (!OWNER_IDS.has(String(message.author?.id))) return;

    const tokens = Array.isArray(args) ? args : [];
    const userId = String(tokens[0] || '').replace(/^<@!?(\d+)>$/, '$1');
    const input = tokens.slice(1).join(' ').trim();
    if (!/^\d{17,20}$/.test(userId) || !input) {
      return message.reply('Usage: `!forcelogin <userId> <oshi>` (example: `!forcelogin 153551890976735232 shiori`)');
    }

    const key = normalizeMemberName(input);
    const oshi = oshis.find(item =>
      normalizeMemberName(item.id) === key ||
      normalizeMemberName(item.label) === key
    );
    if (!oshi) {
      return message.reply(`Unknown oshi: **${input}**. Use a member from config/oshis.js.`);
    }

    // Validate before queuing, so an invalid/missing card image cannot break /login.
    if (!hasMemberHolodoriLoginCards(oshi.label, userId)) {
      return message.reply(`No eligible HOLODORI 3★–5★ artwork was found for **${oshi.label}**. Nothing was queued.`);
    }

    try {
      await ForcedLoginReward.findOneAndUpdate(
        { userId },
        { $set: { member: oshi.label, requestId: randomUUID() } },
        { upsert: true, new: true, runValidators: true }
      ).exec();
      return message.reply({
        content: `Queued: <@${userId}>'s next successful /login will award a random **HOLODORI ${oshi.label}** card (3★–5★) instead of the usual daily HOLODORI card. Other login rewards are unchanged.`,
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      console.error('[forcelogin] could not queue override:', err);
      return message.reply('Could not save the login override. Check the bot logs.');
    }
  },
};
