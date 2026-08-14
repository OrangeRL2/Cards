const { Events } = require('discord.js');
const streamManager = require('../jobs/streamManager');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`Ready! Logged in as ${client.user.tag}`);

    if (streamManager && typeof streamManager.startStreamManager === 'function') {
      streamManager.startStreamManager(client);
    } else {
      console.error('startStreamManager is not available on jobs/streamManager.');
    }
  },
};
