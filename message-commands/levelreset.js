// commands/admin/resetLevels.js
const Oshi = require('../models/Oshi');

const PREFIX = '!';
const ALLOWED_ID = '153551890976735232'; // owner only

module.exports = {
  name: 'resetlevels',
  description: 'Reset all users oshi leveling fields to defaults (owner only).',
  async execute(message) {
    try {
      if (!message.content.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      // Only owner can run this
      if (String(message.author.id) !== ALLOWED_ID) {
        return message.reply('You cannot use this command.');
      }

      // Default leveling values
      const defaults = {
        level: 0,
        xp: 0,
        xpToNext: 100,
        awards: [],
        lastLeveledAt: null
      };

      // Update all Oshi documents
      const res = await Oshi.updateMany({}, { $set: defaults });

      const modified = (res && (res.modifiedCount ?? res.nModified ?? 0)) || 0;
      const matched = (res && (res.matchedCount ?? res.n ?? 0)) || 0;

      message.reply(`Reset leveling fields for ${modified} Oshi documents (matched ${matched}).`);
    } catch (err) {
      console.error('[resetlevels] error', err);
      message.reply('Failed to reset levels for all users.');
    }
  }
};
