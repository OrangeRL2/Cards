// deploy-commands.js
const { REST, Routes } = require('discord.js');
const { clientId, guildId, token, pullMode } = require('./config.json');
const fs = require('node:fs');
const path = require('node:path');

const PULL_MODE = pullMode || 'normal';
const PULL_FILENAME = PULL_MODE === 'special' ? 'specialPull.js' : 'pull.js';

const commands = [];
// Grab all the command folders from the Commands directory
const foldersPath = path.join(__dirname, 'Commands');
if (!fs.existsSync(foldersPath)) {
  console.error('[DEPLOY] Commands folder not found at', foldersPath);
  process.exit(1);
}
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  if (!fs.existsSync(commandsPath)) continue;
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    // If this folder contains both pull.js and specialPull.js, only include the chosen one
    if ((file === 'pull.js' || file === 'specialPull.js') && file !== PULL_FILENAME) {
      continue;
    }

    const filePath = path.join(commandsPath, file);
    try {
      const command = require(filePath);
      if ('data' in command && 'execute' in command) {
        commands.push(command.data.toJSON());
      } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
      }
    } catch (err) {
      console.error('[DEPLOY] failed to require command', filePath, err);
    }
  }
}

// Construct and prepare an instance of the REST module
const rest = new REST().setToken(token);

// and deploy your commands!
(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands. PULL_MODE=${PULL_MODE}`);

    // The put method is used to fully refresh all commands in the guild with the current set
    const data = await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands },
    );

    console.log(`Successfully reloaded ${data.length} application (/) commands.`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
