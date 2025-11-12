const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { token, mongoUri } = require('./config.json');
const { startScheduler, grantBirthdayPulls } = require('./jobs/birthdayHandout');
const config = require('./config.json');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.cooldowns = new Collection();
client.commands = new Collection();

const foldersPath = path.join(__dirname, 'Commands');
const commandFolders = fs.readdirSync(foldersPath);

(async () => {
  try {
    // 1) Connect to MongoDB
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB via Mongoose');

    // 3) Load Commands
    for (const folder of commandFolders) {
      const commandsPath = path.join(foldersPath, folder);
      const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
      for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command);
        } else {
          console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
      }
    }

    // 4) Load Events
    const eventsPath = path.join(__dirname, 'events');
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

    for (const file of eventFiles) {
      const filePath = path.join(eventsPath, file);
      const event = require(filePath);
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }
    }

    // 5) Login
    await client.login(token);
    console.log(`✅ Logged in as ${client.user.tag}`);
    // start scheduler and pass client + channel id used for announcements
  startScheduler({ client, birthdayChannelId: config.birthdayChannelId });

  // run once immediately on startup to avoid missing today's grants if bot was offline at midnight
  await grantBirthdayPulls({ client, birthdayChannelId: config.birthdayChannelId });
    // optional: make client available to other modules if needed
    module.exports = client;

  } catch (err) {
    console.error('❌ Error starting bot:', err);
    process.exit(1);
  }
})();

// graceful shutdown
async function shutdown() {
  try {
    console.log('Shutting down...');
    await mongoose.disconnect();
    if (client && client.isReady()) await client.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown', err);
    process.exit(1);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
