'use strict';
// Owner-only, persistent one-time override for the next successful /login.
// Usage: !nexttarot <userId> <tarot number/name>
//        !nexttarot <userId> clear
const halEvent = require('../utils/halEvent');

const OWNER_IDS = new Set(['153551890976735232']);

module.exports = {
  name: 'nexttarot',
  description: 'Owner-only: choose a player\'s next Halloween login tarot.',
  async execute(message, args = []) {
    if (message.author?.bot || !OWNER_IDS.has(String(message.author?.id))) return;

    const tokens = Array.isArray(args) ? args : [];
    const userId = String(tokens[0] || '').replace(/^<@!?(\d+)>$/, '$1');
    const choice = tokens.slice(1).join(' ').trim();
    if (!/^\d{17,20}$/.test(userId) || !choice) {
      return message.reply('Usage: `!nexttarot <userId> <tarot name/number>` (e.g. `!nexttarot 153551890976735232 The Moon`). Use `clear` to cancel.');
    }

    try {
      if (/^(clear|cancel)$/i.test(choice)) {
        const removed = await halEvent.cancelNextTarot(userId);
        return message.reply({
          content: removed ? `Cleared the queued tarot for user ${userId}.` : `No queued tarot for user ${userId}.`,
          allowedMentions: { parse: [] },
        });
      }

      const tarot = await halEvent.queueNextTarot(userId, choice);
      return message.reply({
        content: `Queued Tarot #${tarot.number} (${tarot.name}) for user ${userId}'s next successful Halloween /login. The public login reveal will be identical to a natural draw.`,
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      if (err.code === 'INVALID_TAROT' || err.code === 'TAROT_NOT_ALLOWED') {
        return message.reply({ content: err.message, allowedMentions: { parse: [] } });
      }
      console.error('[nexttarot] could not update override:', err);
      return message.reply('Could not save the next-tarot override. Check the bot logs.');
    }
  },
};
