// inspect-commands.js
const { REST, Routes } = require('discord.js');
const { clientId, guildId, token } = require('./config.json');

(async () => {
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    const cmds = await rest.get(Routes.applicationGuildCommands(clientId, guildId));
    for (const c of cmds) {
      if (c.name === 'startlive') {
        console.log('startlive command:', JSON.stringify(c, null, 2));
      }
    }
  } catch (err) {
    console.error('failed to fetch commands', err);
  }
})();
