const { Events } = require('discord.js');
const guessManager = require('../jobs/guessManager');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      await guessManager.handleMessage(message);
    } catch (err) {
      console.error('[guessMessageCreate] error:', err);
    }
  },
};
