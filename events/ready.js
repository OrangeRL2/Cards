const { Events } = require('discord.js');

// debug-friendly require
const bossManager = require('../jobs/bossManager');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`Ready! Logged in as ${client.user.tag}`);

    // debug output
    console.log('jobs/bossManager exports:', Object.keys(bossManager || {}), typeof bossManager.startBossManager);

    if (bossManager && typeof bossManager.startBossManager === 'function') {
      bossManager.startBossManager(client, { weeklySeed: 12345 });
    } else {
      console.error('startBossManager is not available on jobs/bossManager. Did the file export it?');
    }
  },
};
