// message-commands/clearInv.js
const fs = require('fs');
const path = require('path');
const User = require('../models/User');

const PREFIX = '!';
const COMMAND_NAME = 'clearinv';

// Configure allowed users and roles here (strings)
const ALLOWED_USER_IDS = new Set([
  '153551890976735232',
  '409717160995192832',
]);
const ALLOWED_ROLE_IDS = new Set([
  '844054364033384470',
]);

// Optional: write backups/audit logs (recommended)
const BACKUP_DIR = path.join(process.cwd(), 'backups', 'clearinv');
const AUDIT_FILE = path.join(BACKUP_DIR, 'clearinv-audit.log');

// parse simple key:value tokens like "user:@Someone" or "user=123"
function parseOptionsFromTokens(tokens) {
  const opts = {};
  for (const raw of tokens) {
    if (!raw) continue;
    let token = String(raw).trim();
    if (!token) continue;

    // Support flag styles like --dry=true / --dry
    if (token.startsWith('--')) token = token.slice(2);

    let key = '';
    let val = '';

    const colonIdx = token.indexOf(':');
    const eqIdx = token.indexOf('=');

    if (colonIdx !== -1) {
      key = token.slice(0, colonIdx);
      val = token.slice(colonIdx + 1);
    } else if (eqIdx !== -1) {
      key = token.slice(0, eqIdx);
      val = token.slice(eqIdx + 1);
    } else {
      // bare flags are treated as true
      key = token;
      val = 'true';
    }

    key = String(key).trim().toLowerCase();
    if (!key) continue;
    opts[key] = String(val).trim();
  }
  return opts;
}

function isAllowed(message) {
  const authorId = message.author.id;
  const member = message.member; // may be null in DMs

  const hasUserAllow = ALLOWED_USER_IDS.has(authorId);
  const hasRoleAllow = member && member.roles && member.roles.cache
    ? member.roles.cache.some(r => ALLOWED_ROLE_IDS.has(r.id))
    : false;

  return hasUserAllow || hasRoleAllow;
}

async function resolveUserFromOpt(message, userOpt) {
  if (!userOpt) return null;
  const mentionMatch = String(userOpt).match(/^<@!?(\d+)>$/);
  const id = mentionMatch ? mentionMatch[1] : String(userOpt).trim();
  if (!/^\d{10,30}$/.test(id)) return null;

  try {
    return await message.client.users.fetch(id);
  } catch {
    // allow clearing by raw id even if fetch fails
    return { id, toString: () => `<@${id}>` };
  }
}

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function appendAudit(line) {
  try {
    ensureDir(BACKUP_DIR);
    fs.appendFileSync(AUDIT_FILE, line + '\n', 'utf8');
  } catch {}
}

module.exports = {
  name: COMMAND_NAME,
  description: 'Prefix command: clearinv — instantly clears a user’s card inventory (cards array).',
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      const parts = message.content.trim().split(/\s+/);
      const cmd = parts[0].slice(PREFIX.length).toLowerCase();
      if (cmd !== COMMAND_NAME) return;

      // Permission check
      if (!isAllowed(message)) {
        return message.reply({ content: "You don't have permission to use this command." }).catch(() => {});
      }

      // tokens after command name
      const tokens = parts.slice(1);
      const opts = parseOptionsFromTokens(tokens);

      if (!opts.user) {
        return message.reply({
          content:
            `Usage:\n` +
            `\`!clearinv --user=153551890976735232\`\n` +
            `or \`!clearinv user:<@123>\`\n` +
            `Optional: \`--dry=true\` to preview only`
        }).catch(() => {});
      }

      const targetUser = await resolveUserFromOpt(message, opts.user);
      if (!targetUser || !targetUser.id) {
        return message.reply({ content: 'Invalid user. Use --user=<id> or user:<@mention>.' }).catch(() => {});
      }

      const dry = String(opts.dry || 'false').toLowerCase() === 'true';

      // Load target inventory for count + backup
      const beforeDoc = await User.findOne({ id: targetUser.id }).lean().exec();
      const beforeCards = beforeDoc && Array.isArray(beforeDoc.cards) ? beforeDoc.cards : [];
      const beforeCount = beforeCards.length;

      if (dry) {
        return message.reply({
          content: `DRY RUN: ${targetUser.toString()} currently has ${beforeCount} card entries. No changes were made.`
        }).catch(() => {});
      }

      // Always write a backup (no confirmation, but recoverable)
      ensureDir(BACKUP_DIR);
      const backupPath = path.join(BACKUP_DIR, `clearinv_${targetUser.id}_${stamp()}.json`);
      const backupPayload = {
        backedUpAt: new Date().toISOString(),
        targetUserId: targetUser.id,
        byUserId: message.author.id,
        channelId: message.channel?.id || null,
        guildId: message.guild?.id || null,
        beforeCount,
        cards: beforeCards
      };
      try {
        fs.writeFileSync(backupPath, JSON.stringify(backupPayload, null, 2), 'utf8');
      } catch {}

      // Clear cards immediately
      await User.updateOne(
        { id: targetUser.id },
        { $set: { cards: [] } },
        { upsert: true }
      ).exec();

      // Audit log line
      appendAudit(
        `[${new Date().toISOString()}] cleared user=${targetUser.id} removedEntries=${beforeCount} by=${message.author.id} guild=${message.guild?.id || 'NA'} channel=${message.channel?.id || 'NA'} backup=${backupPath}`
      );

      return message.reply({
        content: `✅ Cleared inventory for ${targetUser.toString()} (removed ${beforeCount} card entries). Backup: \`${backupPath}\``
      }).catch(() => {});

    } catch (err) {
      console.error('[clearinv] unexpected error', err);
      try { await message.reply({ content: 'Unexpected error running clearinv.' }); } catch {}
    }
  }
};