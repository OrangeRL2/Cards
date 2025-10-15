const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { token, mongoUri } = require('./config.json');

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

    // 2) Initialize Discord client
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    client.cooldowns = new Collection();
    client.commands = new Collection();

// ─── Load Commands
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

// ─── Load Events
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
	const filePath = path.join(eventsPath, file);
	const event = require(filePath);
	if (event.once) {
		client.once(event.name, (...args) => event.execute(...args));
	} else {
		client.on(event.name, (...args) => event.execute(...args));
	}
}

    // 4) Login
    await client.login(token);
    console.log(`✅ Logged in as ${client.user.tag}`);
  } catch (err) {
    console.error('❌ Error starting bot:', err);
    process.exit(1);
  }
  })();