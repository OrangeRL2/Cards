const guessManager = require('../jobs/guessManager');

module.exports = {
  name: 'clearguesses',
  description: 'Close every active Guess round and restart normal scheduling (owner only).',
  async execute(message) {
    if (String(message.author?.id) !== '153551890976735232') return;

    const result = await guessManager.clearAllGuesses(message.client);
    await message.reply({
      content: `Cleared **${result.rounds}** active Guess round(s), closed **${result.dbClosed}** database challenge(s), removed **${result.removedMessages}** challenge post(s), and discarded **${result.pendingBuffs}** queued buff(s).${result.failedMessages ? ` Could not delete ${result.failedMessages} post(s).` : ''} Normal automatic scheduling has resumed.`,
      allowedMentions: { parse: [] },
    });
  },
};
