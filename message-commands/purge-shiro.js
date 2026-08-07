const User = require('../models/User');
const Oshi = require('../models/Oshi');
const PullQuota = require('../models/PullQuota');
const SummerUser = require('../models/SummerUser');

const PREFIX = '!';
const ALLOWED_IDS = [
  '153551890976735232', // you
  '409717160995192832'  // extra allowed user 2
];
const TARGET_ID = '511182422340272128';

module.exports = {
  name: 'killshiro',
  description: 'Fully resets the target user while preserving their original oshi-selection date.',
  async execute(message) {
    try {
      if (!message.content.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      if (!ALLOWED_IDS.includes(String(message.author.id))) {
        return message.reply('You cannot use this command.');
      }

      // Keep the Oshi document so chosenAt survives, but clear the active oshi
      // and reset all oshi progression.
      const existingOshi = await Oshi.findOne({ userId: TARGET_ID }).lean().exec();

      if (existingOshi) {
        await Oshi.updateOne(
          { userId: TARGET_ID },
          {
            $unset: {
              oshiId: 1,
              customImage: 1
            },
            $set: {
              level: 0,
              xp: 0,
              xpToNext: 100,
              awards: [],
              lastLeveledAt: null
            }
          }
        ).exec();
      }

      // Reset pull quota, then give 1000 pulls.
      await PullQuota.deleteOne({ userId: TARGET_ID });
      await PullQuota.updateOne(
        { userId: TARGET_ID },
        { $set: { pulls: 1000 } },
        { upsert: true }
      );

      // Wipe main card/user collection.
      await User.deleteOne({ id: TARGET_ID });

      // Wipe all Summer event state.
      await SummerUser.deleteOne({ userId: TARGET_ID });

      const preservedDate = existingOshi?.chosenAt
        ? new Date(existingOshi.chosenAt).toISOString()
        : 'none (no previous Oshi document)';

      message.reply(
        `Killed shiro:\n` +
        `- Wiped cards / main User data\n` +
        `- Reset pulls → **1000**\n` +
        `- Wiped SummerUser data\n` +
        `- Cleared current Oshi + Oshi progress\n` +
        `- Preserved original Oshi selection date: **${preservedDate}**`
      );
    } catch (err) {
      console.error('[purge_user_full] error', err);
      message.reply('Failed to kill target user.');
    }
  }
};
