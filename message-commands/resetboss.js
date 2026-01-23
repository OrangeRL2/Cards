// message-commands/resetboss.js
const BossEvent = require('../models/BossEvent');
const BossPointLog = require('../models/BossPointLog');

module.exports = {
  name: 'resetboss',
  description: 'Reset boss-related collections. Usage: !resetboss confirm',
  async execute(message, args) {
    try {
      // Permission check
      if (!message.member || !message.member.permissions.has('Administrator')) {
        return message.reply('You do not have permission to use this command.');
      }

      // Safety: require explicit confirmation
      const confirm = args && args[0] ? String(args[0]).toLowerCase() : null;
      if (confirm !== 'confirm') {
        return message.reply('This command will permanently delete all BossEvent and BossPointLog documents. To proceed run: `!resetboss confirm`.');
      }

      // Perform deletions
      const evRes = await BossEvent.deleteMany({});
      const logRes = await BossPointLog.deleteMany({});

      await message.reply(`Boss schemas reset complete. Deleted BossEvent: ${evRes.deletedCount || 0}, BossPointLog: ${logRes.deletedCount || 0}.`);
    } catch (err) {
      console.error('resetboss error', err);
      try { await message.reply('Failed to reset boss schemas. Check logs for details.'); } catch (e) { /* ignore */ }
    }
  }
};
