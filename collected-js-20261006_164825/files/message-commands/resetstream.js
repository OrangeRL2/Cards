const StreamEvent = require('../models/StreamEvent');
const StreamActionLog = require('../models/StreamActionLog');
const permissions = require('../config/permissions');

module.exports = {
  name: 'resetstream',
  description: 'Delete all StreamEvent and StreamActionLog documents. Restricted.',

  async execute(message, args) {
    const allowed = permissions.allowedStreamSpawners || permissions.allowedBossSpawners || [];
    if (!allowed.includes(message.author.id)) return message.reply('You do not have permission to use this command.');
    if (String(args?.[0] || '').toLowerCase() !== 'confirm') {
      return message.reply('This permanently deletes all stream event/action documents. Run `!resetstream confirm` to proceed.');
    }

    const [eventResult, logResult] = await Promise.all([
      StreamEvent.deleteMany({}),
      StreamActionLog.deleteMany({}),
    ]);
    return message.reply(`Stream reset complete. Deleted StreamEvent: ${eventResult.deletedCount || 0}, StreamActionLog: ${logResult.deletedCount || 0}.`);
  },
};
