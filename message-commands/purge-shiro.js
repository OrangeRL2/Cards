const User = require('../models/User');
const Oshi = require('../models/Oshi');
const PullQuota = require('../models/PullQuota');

const PREFIX = '!';
const ALLOWED_ID = '153551890976735232';      // YOU only
const TARGET_ID = '511182422340272128';       // User to purge

module.exports = {
  name: 'killshiro',
  description: 'Deletes the target user’s entire Oshi and sets pulls to 1000 (only owner allowed).',
  async execute(message) {
    try {
      if (!message.content.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      // Only you can run this
      if (String(message.author.id) !== ALLOWED_ID) {
        return message.reply("You cannot use this command.");
      }

      // --- 1) DELETE OSHI ENTRY ---
      await Oshi.deleteOne({ userId: TARGET_ID });
      await PullQuota.deleteOne({ userId: TARGET_ID });
      // --- 2) SET PULLS TO 1000 ---
      await PullQuota.updateOne(
        { userId: TARGET_ID },
        { $set: { pulls: 1000 } },
        { upsert: true } // if they don't have a PullQuota doc yet
      );

      // --- 3) Delete USER entry ---
      await User.deleteOne({ id: TARGET_ID });

      message.reply(`Killed shiro:\n- Deleted their Oshi\n- Set pulls → **1000**\n- Trimmed cards to 0`);
    } catch (err) {
      console.error('[purge_user_full] error', err);
      message.reply('Failed to kill target user.');
    }
  }
};
