// message-commands/resetLogins.js
// Owner-only command to reset daily login records.
// Usage examples:
//   !resetlogins                -> deletes all LoginRecord documents (full reset)
//   !resetlogins --mode=unset   -> keeps documents but unsets lastLoginJST (users can claim again)
//   !resetlogins @user          -> reset a single user by mention or id
//   !resetlogins roleName       -> reset all members who have that role (by name)
//   !resetlogins --mode=unset --target=123456789012345678
//
// Notes:
// - This is a message command (prefix-based) modeled after your addEventPulls style.
// - It is owner-only (same OWNER_IDs as your other command).
// - It uses a LoginRecord model local to this file so you don't need to modify your User model.

const { EmbedBuilder } = require('discord.js'); // kept for parity with style
const mongoose = require('mongoose');
const { Schema } = mongoose;

const PREFIX = '!';
const COMMAND_NAME = 'resetlogins';
const OWNER_ID = '409717160995192832';
const OWNER_ID2 = '153551890976735232';
const OWNER_ID3 = '272129129841688577';

// parse simple flags: !resetlogins --mode=unset --target=123
function parseFlags(content) {
  const parts = content.split(/\s+/).slice(1); // drop command token
  const flags = {};
  for (const p of parts) {
    if (!p.startsWith('--')) continue;
    const without = p.slice(2);
    const [k, v] = without.split(/=(.+)/);
    flags[k] = v === undefined ? true : v.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
  }
  return flags;
}

// Define LoginRecord schema (must match the schema used by your bot)
const loginRecordSchema = new Schema({
  userId: { type: String, required: true, index: true, unique: true },
  lastLoginJST: { type: String, required: true }, // YYYY-MM-DD in JST
}, { timestamps: true });

let LoginRecord;
try {
  LoginRecord = mongoose.model('LoginRecord');
} catch (e) {
  LoginRecord = mongoose.model('LoginRecord', loginRecordSchema);
}

module.exports = {
  name: COMMAND_NAME,
  description: 'Owner-only. Reset daily login records (delete or unset lastLoginJST).',
  /**
   * @param {import('discord.js').Message} message
   * @param {string[]} args
   */
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      if (message.author.id !== OWNER_ID && message.author.id !== OWNER_ID2 && message.author.id !== OWNER_ID3) {
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      const tokens = message.content.trim().split(/\s+/);
      // tokens[0] is command, tokens[1] may be target or flags
      const maybeTarget = tokens[1] && !tokens[1].startsWith('--') ? tokens[1] : null;
      const flags = parseFlags(message.content);

      // mode: 'delete' (default) or 'unset'
      const mode = String(flags.mode || 'delete').toLowerCase();
      if (!['delete', 'unset'].includes(mode)) {
        return message.reply({ content: 'Invalid mode. Use --mode=delete or --mode=unset.' }).catch(() => {});
      }

      // allow explicit target via --target=ID or positional maybeTarget
      const explicitTarget = flags.target || maybeTarget || null;

      // If explicitTarget is a mention like <@123>, extract id
      let targetId = null;
      if (explicitTarget) {
        const mentionMatch = explicitTarget.match(/<@!?(\d+)>/) || explicitTarget.match(/^(\d+)$/);
        if (mentionMatch) targetId = mentionMatch[1];
      }

      // If explicitTarget is a role name (and we are in a guild), resolve members
      let resolvedUsers = [];

      if (targetId) {
        // single user id
        resolvedUsers = [{ id: targetId }];
      } else if (explicitTarget && message.guild) {
        // try role by id or name
        const roleIdMatch = explicitTarget.match(/<@&(\d+)>/) || explicitTarget.match(/^(\d+)$/);
        if (roleIdMatch) {
          const roleId = roleIdMatch[1];
          const role = message.guild.roles.cache.get(roleId);
          if (role) {
            resolvedUsers = Array.from(role.members.values()).map(m => ({ id: m.user.id }));
          }
        } else {
          // role by name
          const roleByName = message.guild.roles.cache.find(r => r.name.toLowerCase() === explicitTarget.toLowerCase());
          if (roleByName) {
            resolvedUsers = Array.from(roleByName.members.values()).map(m => ({ id: m.user.id }));
          } else {
            // try member by tag username#discrim
            const memberByTag = message.guild.members.cache.find(m => `${m.user.username}#${m.user.discriminator}`.toLowerCase() === explicitTarget.toLowerCase());
            if (memberByTag) resolvedUsers = [{ id: memberByTag.user.id }];
          }
        }
      }

      // If no explicit target provided, operate on all records
      const operateOnAll = !explicitTarget;

      // Safety: if operating on all, require explicit --confirm flag to avoid accidental wipes
      if (operateOnAll && !flags.confirm) {
        return message.reply({
          content: 'This will reset login records for ALL users. If you are sure, re-run with `--confirm=true`.'
        }).catch(() => {});
      }

      // Perform DB operations
      if (operateOnAll) {
        if (mode === 'delete') {
          const res = await LoginRecord.deleteMany({});
          return message.reply({ content: `Deleted ${res.deletedCount} login record(s).` }).catch(() => {});
        } else {
          // unset lastLoginJST for all documents
          const res = await LoginRecord.updateMany({}, { $unset: { lastLoginJST: "" } });
          return message.reply({ content: `Unset lastLoginJST for ${res.modifiedCount || res.nModified || 0} record(s).` }).catch(() => {});
        }
      } else {
        // operate on resolvedUsers (could be single or many)
        const uniqueIds = Array.from(new Map(resolvedUsers.map(u => [u.id, u])).values()).map(u => u.id);
        if (uniqueIds.length === 0) {
          return message.reply({ content: 'No matching users found for the provided target.' }).catch(() => {});
        }

        // Batch the operations to avoid huge single queries if role has many members
        const BATCH = 200;
        let totalAffected = 0;
        for (let i = 0; i < uniqueIds.length; i += BATCH) {
          const batch = uniqueIds.slice(i, i + BATCH);
          if (mode === 'delete') {
            const res = await LoginRecord.deleteMany({ userId: { $in: batch } });
            totalAffected += res.deletedCount || 0;
          } else {
            const res = await LoginRecord.updateMany({ userId: { $in: batch } }, { $unset: { lastLoginJST: "" } });
            // different mongoose versions return different fields
            totalAffected += (res.modifiedCount || res.nModified || 0);
          }
        }

        return message.reply({ content: `${mode === 'delete' ? 'Deleted' : 'Unset'} login records for ${totalAffected} user(s).` }).catch(() => {});
      }
    } catch (err) {
      console.error('[resetlogins] unexpected error', err);
      try { await message.reply({ content: 'Unexpected error running resetlogins.' }); } catch {}
    }
  }
};
