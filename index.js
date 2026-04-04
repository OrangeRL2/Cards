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

// ===================== 🌸 SAKURA EMBED THEME (GLOBAL) =====================
// Place this block right after: const config = require('./config.json');

const EMBED_THEME = config.embedTheme || 'default';
const KEEP_ERROR_RED = Boolean(config.embedKeepErrorRed);

const DECORATE_ALL_TEXT = config.embedDecorateAllText !== false; // default true
const DECORATE_PER_LINE = config.embedDecoratePerLine !== false; // default true

// Emoji choices pool (prefix/suffix are chosen independently each time)
const DEFAULT_CHOICES = ['🌸', '🍃'];
const EMOJI_CHOICES = Array.isArray(config.embedDecorateEmojiChoices) && config.embedDecorateEmojiChoices.length
  ? config.embedDecorateEmojiChoices.map(x => String(x)).filter(Boolean)
  : DEFAULT_CHOICES;

// Sakura pink
const SAKURA_PINK = 0xFFB7C5;

// Preserve certain colors even in sakura mode (optional)
const KEEP_COLORS = new Set();
if (KEEP_ERROR_RED) KEEP_COLORS.add(0xFF5555); // error red used in /pull

// Discord embed text limits (prevents API errors)
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

function pickRandomEmoji() {
  return EMOJI_CHOICES[Math.floor(Math.random() * EMOJI_CHOICES.length)];
}

// ---- "Already decorated" detection (prevents double-wrapping) ----
// A line is considered decorated if it starts with (emoji + space) and ends with (space + emoji),
// where emoji is ANY from EMOJI_CHOICES.
function startsWithAnyEmojiPlusSpace(s) {
  return EMOJI_CHOICES.some(e => s.startsWith(`${e} `));
}
function endsWithAnySpacePlusEmoji(s) {
  return EMOJI_CHOICES.some(e => s.endsWith(` ${e}`));
}

function isAlreadyDecoratedLine(line) {
  const raw = String(line ?? '');
  const t = raw.trim();
  if (!t) return false;
  return startsWithAnyEmojiPlusSpace(t) && endsWithAnySpacePlusEmoji(t);
}

// Decorate a single line while preserving indentation
function decorateOneLine(line) {
  if (line == null) return line;
  const raw = String(line);

  // Leave blank/whitespace-only lines alone
  if (!raw.trim()) return raw;

  // Avoid double-wrapping
  if (isAlreadyDecoratedLine(raw)) return raw;

  // Preserve indentation (leading whitespace)
  const indentMatch = raw.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : '';

  // Keep the rest of the line but trim only the end (so indentation remains)
  const content = raw.slice(indent.length).trimEnd();
  if (!content.trim()) return raw;

  // ✅ RNG prefix/suffix independently (this is what you asked for)
  const prefix = pickRandomEmoji();
  const suffix = pickRandomEmoji();

  return `${indent}${prefix} ${content} ${suffix}`;
}

// Decorate multiline blocks line-by-line (preserves \n)
function decorateMultiline(text) {
  if (text == null) return text;
  const raw = String(text);

  if (!DECORATE_PER_LINE) {
    const t = raw.trim();
    if (!t) return raw;
    if (isAlreadyDecoratedLine(t)) return raw;
    const prefix = pickRandomEmoji();
    const suffix = pickRandomEmoji();
    return `${prefix} ${t} ${suffix}`;
  }

  return raw.split('\n').map(decorateOneLine).join('\n');
}

function decorateText(text, maxLen) {
  if (!DECORATE_ALL_TEXT) return text;
  const wrapped = decorateMultiline(text);
  return truncateTo(wrapped, maxLen);
}

function enableSakuraEmbeds() {
  if (EMBED_THEME !== 'sakura') return;

  const originalSetColor = EmbedBuilder.prototype.setColor;
  const originalSetTitle = EmbedBuilder.prototype.setTitle;
  const originalSetDescription = EmbedBuilder.prototype.setDescription;
  const originalAddFields = EmbedBuilder.prototype.addFields;
  const originalSetFields = EmbedBuilder.prototype.setFields;
  const originalSetFooter = EmbedBuilder.prototype.setFooter;
  const originalSetAuthor = EmbedBuilder.prototype.setAuthor;
  const originalToJSON = EmbedBuilder.prototype.toJSON;

  // Force sakura color on any setColor(...) calls (unless preserved)
  EmbedBuilder.prototype.setColor = function patchedSetColor(color) {
    const n = typeof color === 'number' ? color : null;
    if (n && KEEP_COLORS.has(n)) return originalSetColor.call(this, n);
    return originalSetColor.call(this, SAKURA_PINK);
  };

  // Decorate title
  EmbedBuilder.prototype.setTitle = function patchedSetTitle(title) {
    return originalSetTitle.call(this, decorateText(title, LIMITS.title));
  };

  // Decorate description (multi-line friendly)
  EmbedBuilder.prototype.setDescription = function patchedSetDescription(desc) {
    return originalSetDescription.call(this, decorateText(desc, LIMITS.description));
  };

  // Decorate fields (name + value)
  function decorateField(field) {
    if (!field || typeof field !== 'object') return field;
    const out = { ...field };
    if ('name' in out) out.name = decorateText(out.name, LIMITS.fieldName);
    if ('value' in out) out.value = decorateText(out.value, LIMITS.fieldValue);
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

  // Decorate footer text (supports multi-line footers)
  EmbedBuilder.prototype.setFooter = function patchedSetFooter(footer) {
    if (!footer || typeof footer !== 'object') return originalSetFooter.call(this, footer);
    const out = { ...footer };
    if (out.text) out.text = decorateText(out.text, LIMITS.footerText);
    return originalSetFooter.call(this, out);
  };

  // Decorate author name
  EmbedBuilder.prototype.setAuthor = function patchedSetAuthor(author) {
    if (!author || typeof author !== 'object') return originalSetAuthor.call(this, author);
    const out = { ...author };
    if (out.name) out.name = decorateText(out.name, LIMITS.authorName);
    return originalSetAuthor.call(this, out);
  };

  // Safety net:
  // - ensures embeds with no setColor still become pink
  // - ensures raw-set data still gets decorated (without double-wrapping)
  EmbedBuilder.prototype.toJSON = function patchedToJSON() {
    if (!this.data?.color) originalSetColor.call(this, SAKURA_PINK);

    if (this.data?.title) this.data.title = decorateText(this.data.title, LIMITS.title);
    if (this.data?.description) this.data.description = decorateText(this.data.description, LIMITS.description);

    if (this.data?.footer?.text) this.data.footer.text = decorateText(this.data.footer.text, LIMITS.footerText);
    if (this.data?.author?.name) this.data.author.name = decorateText(this.data.author.name, LIMITS.authorName);

    if (Array.isArray(this.data?.fields)) {
      this.data.fields = this.data.fields.map(f => ({
        ...f,
        name: decorateText(f?.name, LIMITS.fieldName),
        value: decorateText(f?.value, LIMITS.fieldValue),
      }));
    }

    return originalToJSON.call(this);
  };

  console.log('[theme] Sakura mode enabled: pink embeds + per-line RNG 🌸/🍃');
}

enableSakuraEmbeds();
// =================== END 🌸 SAKURA EMBED THEME (GLOBAL) ===================

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
