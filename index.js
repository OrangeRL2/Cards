// index.js
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { token, mongoUri } = require('./config.json');
const { startScheduler, grantBirthdayPulls } = require('./jobs/birthdayHandout');
const config = require('./config.json');

// create client with required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// collections
client.cooldowns = new Collection();
client.commands = new Collection(); // slash commands
client.messageCommands = new Collection(); // prefix message commands

// ----------------- message command loader -----------------
const messageCommandsPath = path.join(__dirname, 'message-commands');
if (fs.existsSync(messageCommandsPath)) {
  const messageCommandFiles = fs.readdirSync(messageCommandsPath).filter(f => f.endsWith('.js'));
  for (const file of messageCommandFiles) {
    const cmdPath = path.join(messageCommandsPath, file);
    try {
      const cmd = require(cmdPath);
      if (cmd && cmd.name && typeof cmd.execute === 'function') {
        client.messageCommands.set(cmd.name, cmd);
        console.log('[MSG-CMD] loaded', cmd.name);
      } else {
        console.warn('[MSG-CMD] skipped', file, 'missing name or execute');
      }
    } catch (err) {
      console.error('[MSG-CMD] load error', file, err);
    }
  }
} else {
  console.log('[MSG-CMD] no message-commands folder at', messageCommandsPath);
}
console.log('[MSG-CMD] loaded keys', Array.from(client.messageCommands.keys()));

// ----------------- slash command loader (existing) -----------------
const foldersPath = path.join(__dirname, 'Commands');
if (fs.existsSync(foldersPath)) {
  const commandFolders = fs.readdirSync(foldersPath);
  for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    if (!fs.existsSync(commandsPath)) continue;
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      try {
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command);
          console.log('[SLASH] loaded', command.data.name);
        } else {
          console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
      } catch (err) {
        console.error('[SLASH] load error', filePath, err);
      }
    }
  }
} else {
  console.log('[SLASH] no Commands folder at', foldersPath);
}

// ----------------- event loader (existing) -----------------
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    try {
      const event = require(filePath);
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }
      console.log('[EVENT] registered', event.name);
    } catch (err) {
      console.error('[EVENT] load error', filePath, err);
    }
  }
} else {
  console.log('[EVENT] no events folder at', eventsPath);
}

// ----------------- startup async -----------------
(async () => {
  try {
    // connect to MongoDB
    await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('✅ Connected to MongoDB via Mongoose');

    // login
    await client.login(token);
    console.log(`✅ Logged in as ${client.user.tag} (${client.user.id})`);
    // start scheduler
    startScheduler({ client, birthdayChannelId: config.birthdayChannelId });

    // run initial birthday grant once at startup
    await grantBirthdayPulls({ client, birthdayChannelId: config.birthdayChannelId });

    // show loaded counts
    console.log('[READY] messageCommands:', client.messageCommands.size, 'slashCommands:', client.commands.size);

    // export client for other modules if needed
    module.exports = client;
  } catch (err) {
    console.error('❌ Error starting bot:', err);
    process.exit(1);
  }
})();

// ----------------- single messageCreate dispatcher -----------------
const PREFIX = '!';

client.on('messageCreate', async (message) => {
  // debug
  console.log('[messageCreate]', message.author.tag, message.author.id, '->', message.content?.slice(0, 200));
  
  if (message.author.bot) return;
  if (!message.content || !message.content.startsWith(PREFIX)) return;

  const withoutPrefix = message.content.slice(PREFIX.length).trim();
  const [cmdName, ...rawArgs] = withoutPrefix.split(/\s+/);
  const command = client.messageCommands.get(cmdName);
  if (!command) {
    // unknown prefix command; ignore
    return;
  }

  try {
    // call command.execute(message, args)
    await command.execute(message, rawArgs);
  } catch (err) {
    console.error('[MSG-CMD] command error', cmdName, err);
    try { await message.reply({ content: 'Command error' }); } catch {}
  }
});

// ----------------- graceful shutdown -----------------
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
