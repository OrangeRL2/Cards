const { Events } = require('discord.js');
const guessManager = require('../jobs/guessManager');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    try {
      await guessManager.startGuessManager(client);
    } catch (err) {
      console.error('[guessReady] failed to start guess manager:', err);
    }
  },
};
