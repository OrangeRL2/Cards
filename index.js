// index.js
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { Client, Collection, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const config = require('./config.json');
const { token, mongoUri } = config;
const { startScheduler, grantBirthdayPulls } = require('./jobs/birthdayHandout');
const TradeListing = require('./models/TradeListing');
const bossManager = require('./jobs/bossManager');
// create client with required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ===================== 🌸 SAKURA EMBED THEME (CONFIGURABLE) =====================
// Paste this block right after: const config = require('./config.json');
// Make sure discord.js import includes EmbedBuilder:
// const { Client, Collection, GatewayIntentBits, EmbedBuilder } = require('discord.js');
//
// Config shape (all optional):
// {
//   "embedTheme": "sakura",
//   "embedKeepErrorRed": true,
//   "embedDecorate": {
//     "mode": "wrap",                 // "wrap" (prefix+suffix) or "suffix" or "prefix"
//     "perLine": true,                 // if text contains \n, decorate each line
//     "emojiChoices": ["🌸","🍃"],
//     "rng": { "prefix": true, "suffix": true, "sameBothSides": false },
//     "sections": {
//       "title": true,
//       "description": true,
//       "fields": { "name": true, "value": true },
//       "footer": true,
//       "author": true
//     }
//   }
// }

const EMBED_THEME = config.embedTheme || 'default';
const KEEP_ERROR_RED = Boolean(config.embedKeepErrorRed);

const DECORATE = (config.embedDecorate && typeof config.embedDecorate === 'object') ? config.embedDecorate : {};

const MODE = String(DECORATE.mode || 'wrap').toLowerCase(); // wrap | suffix | prefix
const PER_LINE = DECORATE.perLine !== false; // default true

const RNG = (DECORATE.rng && typeof DECORATE.rng === 'object') ? DECORATE.rng : {};
const RNG_PREFIX = RNG.prefix !== false; // default true
const RNG_SUFFIX = RNG.suffix !== false; // default true
const SAME_BOTH_SIDES = Boolean(RNG.sameBothSides); // default false

const SECTIONS = (DECORATE.sections && typeof DECORATE.sections === 'object') ? DECORATE.sections : {};
const DO_TITLE = SECTIONS.title !== false; // default true
const DO_DESC = SECTIONS.description !== false; // default true
const DO_FOOTER = SECTIONS.footer !== false; // default true
const DO_AUTHOR = SECTIONS.author !== false; // default true

const FIELDS = (SECTIONS.fields && typeof SECTIONS.fields === 'object') ? SECTIONS.fields : {};
const DO_FIELD_NAME = FIELDS.name !== false;  // default true
const DO_FIELD_VALUE = FIELDS.value !== false; // default true

// Sakura pink (global embed color)
const SAKURA_PINK = 0xFFB7C5;

// Preserve certain colors even in sakura mode (optional)
const KEEP_COLORS = new Set();
if (KEEP_ERROR_RED) KEEP_COLORS.add(0xFF5555);

// Emoji pool
const DEFAULT_CHOICES = ['🌸', '🍃'];
const EMOJI_CHOICES = Array.isArray(DECORATE.emojiChoices) && DECORATE.emojiChoices.length
  ? DECORATE.emojiChoices.map(x => String(x)).filter(Boolean)
  : DEFAULT_CHOICES;

// Discord embed text limits
const LIMITS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footerText: 2048,
  authorName: 256,
};

function truncateTo(str, max) {
  if (typeof str !== 'string') str = String(str ?? '');
  if (str.length <= max) return str;
  if (max <= 1) return '…'.slice(0, max);
  return str.slice(0, max - 1) + '…';
}

function pickEmoji() {
  return EMOJI_CHOICES[Math.floor(Math.random() * EMOJI_CHOICES.length)];
}

function endsWithAnyEmoji(s) {
  const t = String(s ?? '').trimEnd();
  return EMOJI_CHOICES.some(e => t.endsWith(e) || t.endsWith(` ${e}`));
}

function startsWithAnyEmoji(s) {
  const t = String(s ?? '').trimStart();
  return EMOJI_CHOICES.some(e => t.startsWith(e) || t.startsWith(`${e} `));
}

function decorateOneLine(line) {
  const raw = String(line ?? '');
  if (!raw.trim()) return raw;

  const indent = raw.match(/^(\s*)/)?.[1] ?? '';
  const body = raw.slice(indent.length).trimEnd();
  if (!body.trim()) return raw;

  // Avoid double-wrapping based on current mode
  const trimmed = body.trim();
  const alreadyPrefix = startsWithAnyEmoji(trimmed);
  const alreadySuffix = endsWithAnyEmoji(trimmed);

  let prefix = '';
  let suffix = '';

  if (MODE === 'wrap' || MODE === 'prefix') {
    if (!alreadyPrefix) {
      prefix = RNG_PREFIX ? pickEmoji() : (EMOJI_CHOICES[0] || '🌸');
    }
  }

  if (MODE === 'wrap' || MODE === 'suffix') {
    if (!alreadySuffix) {
      if (SAME_BOTH_SIDES && prefix) {
        suffix = prefix;
      } else {
        suffix = RNG_SUFFIX ? pickEmoji() : (EMOJI_CHOICES[0] || '🌸');
      }
    }
  }

  // If mode is wrap/prefix and we already had prefix, don't add again.
  // Same for suffix.
  let out = body;
  if (prefix) out = `${prefix} ${out}`;
  if (suffix) out = `${out} ${suffix}`;
  return `${indent}${out}`;
}

function decorateText(text, maxLen) {
  if (text == null) return text;
  const raw = String(text);

  let out;
  if (PER_LINE && raw.includes('\n')) {
    out = raw.split('\n').map(decorateOneLine).join('\n');
  } else {
    out = decorateOneLine(raw);
  }

  return truncateTo(out, maxLen);
}

function enableSakuraEmbeds_Configurable() {
  if (EMBED_THEME !== 'sakura') return;

  const originalSetColor = EmbedBuilder.prototype.setColor;
  const originalSetTitle = EmbedBuilder.prototype.setTitle;
  const originalSetDescription = EmbedBuilder.prototype.setDescription;
  const originalAddFields = EmbedBuilder.prototype.addFields;
  const originalSetFields = EmbedBuilder.prototype.setFields;
  const originalSetFooter = EmbedBuilder.prototype.setFooter;
  const originalSetAuthor = EmbedBuilder.prototype.setAuthor;
  const originalToJSON = EmbedBuilder.prototype.toJSON;

  // Global color theme (pink), unless preserved
  EmbedBuilder.prototype.setColor = function patchedSetColor(color) {
    const n = typeof color === 'number' ? color : null;
    if (n && KEEP_COLORS.has(n)) return originalSetColor.call(this, n);
    return originalSetColor.call(this, SAKURA_PINK);
  };

  EmbedBuilder.prototype.setTitle = function patchedSetTitle(title) {
    return originalSetTitle.call(this, DO_TITLE ? decorateText(title, LIMITS.title) : title);
  };

  EmbedBuilder.prototype.setDescription = function patchedSetDescription(desc) {
    return originalSetDescription.call(this, DO_DESC ? decorateText(desc, LIMITS.description) : desc);
  };

  function decorateField(field) {
    if (!field || typeof field !== 'object') return field;
    const out = { ...field };
    if (DO_FIELD_NAME && 'name' in out) out.name = decorateText(out.name, LIMITS.fieldName);
    if (DO_FIELD_VALUE && 'value' in out) out.value = decorateText(out.value, LIMITS.fieldValue);
    return out;
  }

  EmbedBuilder.prototype.addFields = function patchedAddFields(...fields) {
    const normalized = fields.length === 1 && Array.isArray(fields[0]) ? fields[0] : fields;
    return originalAddFields.call(this, normalized.map(decorateField));
  };

  EmbedBuilder.prototype.setFields = function patchedSetFields(...fields) {
    const normalized = fields.length === 1 && Array.isArray(fields[0]) ? fields[0] : fields;
    return originalSetFields.call(this, normalized.map(decorateField));
  };

  EmbedBuilder.prototype.setFooter = function patchedSetFooter(footer) {
    if (!footer || typeof footer !== 'object') return originalSetFooter.call(this, footer);
    if (!DO_FOOTER) return originalSetFooter.call(this, footer);
    const out = { ...footer };
    if (out.text) out.text = decorateText(out.text, LIMITS.footerText);
    return originalSetFooter.call(this, out);
  };

  EmbedBuilder.prototype.setAuthor = function patchedSetAuthor(author) {
    if (!author || typeof author !== 'object') return originalSetAuthor.call(this, author);
    if (!DO_AUTHOR) return originalSetAuthor.call(this, author);
    const out = { ...author };
    if (out.name) out.name = decorateText(out.name, LIMITS.authorName);
    return originalSetAuthor.call(this, out);
  };

  // Safety net: decorate raw-set properties too
  EmbedBuilder.prototype.toJSON = function patchedToJSON() {
    if (!this.data?.color) originalSetColor.call(this, SAKURA_PINK);

    if (DO_TITLE && this.data?.title) this.data.title = decorateText(this.data.title, LIMITS.title);
    if (DO_DESC && this.data?.description) this.data.description = decorateText(this.data.description, LIMITS.description);

    if (DO_FOOTER && this.data?.footer?.text) this.data.footer.text = decorateText(this.data.footer.text, LIMITS.footerText);
    if (DO_AUTHOR && this.data?.author?.name) this.data.author.name = decorateText(this.data.author.name, LIMITS.authorName);

    if (Array.isArray(this.data?.fields)) {
      this.data.fields = this.data.fields.map(f => ({
        ...f,
        name: DO_FIELD_NAME ? decorateText(f?.name, LIMITS.fieldName) : f?.name,
        value: DO_FIELD_VALUE ? decorateText(f?.value, LIMITS.fieldValue) : f?.value,
      }));
    }

    return originalToJSON.call(this);
  };

  console.log('[theme] Sakura mode enabled: configurable wrap/prefix/suffix + per-section toggles');
}

enableSakuraEmbeds_Configurable();

// =================== END 🌸 SAKURA EMBED THEME (CONFIGURABLE) ===================

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

// ----------------- slash command loader (conditional pull) -----------------
const foldersPath = path.join(__dirname, 'Commands');
const PULL_MODE = config.pullMode || 'normal';
const PULL_FILENAME = PULL_MODE === 'special' ? 'specialPull.js' : 'pull.js';

if (fs.existsSync(foldersPath)) {
  const commandFolders = fs.readdirSync(foldersPath);
  for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    if (!fs.existsSync(commandsPath)) continue;
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
      // If both pull.js and specialPull.js exist, only require the selected one
      if ((file === 'pull.js' || file === 'specialPull.js') && file !== PULL_FILENAME) {
        continue;
      }

      const filePath = path.join(commandsPath, file);
      try {
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
          client.commands.set(command.data.name, command);
          console.log('[SLASH] loaded', command.data.name, `(${file})`);
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
    // start boss manager loops (activator/announce/settle/refresher)
    bossManager.startBossManager(client);
    console.log('[READY] bossManager started');
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

// Add this somewhere in your bot's startup (like index.js)
async function cleanupExpiredListings() {
  try {
    const result = await TradeListing.updateMany(
      { 
        status: 'active',
        expiresAt: { $lt: new Date() }
      },
      { status: 'expired' }
    );
    
    if (result.modifiedCount > 0) {
      console.log(`Cleaned up ${result.modifiedCount} expired listings`);
    }
  } catch (error) {
    console.error('Error cleaning up expired listings:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupExpiredListings, 60 * 60 * 1000);
// Run once on startup
cleanupExpiredListings();

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
