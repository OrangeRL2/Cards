// message-commands/forceboss.js
const { PermissionsBitField } = require('discord.js');
const oshis = require('../config/oshis');
const bossManager = require('../jobs/bossManager');

module.exports = {
  name: 'forceboss',
  description: 'Force spawn a boss now. Usage: !forceboss [oshiId] [seconds]',
  async execute(message, args) {
    try {
      // Permission check (Administrator)
      if (!message.member || !message.member.permissions.has?.(PermissionsBitField.Flags.Administrator)) {
        return message.reply('You do not have permission to use this command.');
      }

      // Resolve oshiId (optional)
      let oshiId = args && args[0] ? String(args[0]).trim() : null;
      let oshiCfg = null;
      if (oshiId) {
        oshiCfg = oshis.find(o => o.id === oshiId);
        if (!oshiCfg) {
          return message.reply(`Unknown oshi id: \`${oshiId}\`. Provide a valid id or omit to pick randomly.`);
        }
      } else {
        oshiCfg = oshis[Math.floor(Math.random() * oshis.length)];
        oshiId = oshiCfg.id;
      }

      // Optional duration argument in seconds (e.g., "!forceboss kobo 60")
      const durationSecArg = args && args[1] ? parseInt(args[1], 10) : NaN;
      const durationMs = Number.isFinite(durationSecArg) && durationSecArg > 0 ? durationSecArg * 1000 : null;

      // Use centralized helper in bossManager to create and announce the event
      const { event } = await bossManager.createAndAnnounceEvent(message.client, oshiId, durationMs);

      await message.reply(`Boss for **${oshiCfg.label}** spawned and announced (event ${event.eventId}).`);
    } catch (err) {
      console.error('forceboss error', err);
      try { await message.reply('Failed to force spawn boss. Check logs.'); } catch (e) { /* ignore */ }
    }
  }
};
