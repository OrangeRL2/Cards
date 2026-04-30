// commands/login.js
// Slash command: /login
// Grants a daily random amount of points (fans). Resets at midnight Japan time (JST).
// Frozen users also get +86 pulls on login.

const { SlashCommandBuilder } = require('discord.js');
const mongoose = require('mongoose');
const { Schema } = require('mongoose');

const User = require('../../models/User'); // your existing User model

// ✅ Add these two utils:
const { addPulls, setPulls } = require('../../utils/pullQuota'); // already exists in your pullQuota utils [2](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/pullQuota.js)
const { isFrozen } = require('../../utils/freeze');

// ----------------- Configuration (edit these) -----------------
const DEFAULT_RANGE = { min: 25, max: 100 }; // default daily fans range

// Special ranges for specific Discord user IDs (exact match)
const SPECIAL_USER_RANGES = {
  // MOOMOO
  '875533483051712543': { min: 1, max: 80 },
  '647219814011502607': { min: 1, max: 80 },
  '91103688415776768': { min: 1, max: 80 },
  // char
  '879614865956827197': { min: 1, max: 80 },
  // aerestria
  '953552994232852490': { min: 1, max: 50 },
  '1188023588926795827': { min: 1, max: 50 },
  '1300468334474690583': { min: 1, max: 50 },
  // blacky
  '1416081468794339479': { min: 1, max: 50 },
  // MAINS
  '1334914199968677941': { min: 25, max: 53 },
  '91098889796481024': { min: 25, max: 53 },
};

// Special ranges for specific role IDs (if a member has any of these roles, the corresponding range applies)
// Role priority: first matching role in this object will be used
const SPECIAL_ROLE_RANGES = {
  // '987654321098765432': { min: 1, max: 25 },
};
// ----------------------------------------------------------------

// Simple helper: inclusive random integer
function randIntInclusive(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// =====================
// JST helpers (robust)
// =====================
const TOKYO_TZ = 'Asia/Tokyo';

// Extract Tokyo-local date/time parts safely using Intl (no parsing, no manual offsets)
function getTokyoParts(date = new Date()) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: TOKYO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return map; // { year, month, day, hour, minute, second, ... }
}

/**
 * Return a YYYY-MM-DD string for the provided Date (or now) in JST.
 * Accepts either a Date or a parsable date string.
 */
function jstDateStringFor(dateInput = new Date()) {
  const date = (dateInput instanceof Date) ? dateInput : new Date(dateInput);
  const { year, month, day } = getTokyoParts(date);
  return `${year}-${month}-${day}`;
}

/**
 * Returns UNIX seconds for the next JST midnight (00:00 JST next day).
 * Next midnight JST == 15:00 UTC on the current JST date.
 */
function nextJstMidnightUnix(now = new Date()) {
  const { year, month, day } = getTokyoParts(now);

  const y = Number(year);
  const m = Number(month) - 1; // JS months are 0-based
  const d = Number(day);

  // 00:00 JST next day == 15:00 UTC of the current JST date
  const nextJstMidnightUtcMs = Date.UTC(y, m, d, 15, 0, 0);
  return Math.floor(nextJstMidnightUtcMs / 1000);
}

// Lightweight LoginRecord model to persist daily logins
// Stored in its own collection so we don't need to modify your User schema.
const loginRecordSchema = new Schema(
  {
    userId: { type: String, required: true, index: true, unique: true },
    lastLoginJST: { type: String, required: true }, // YYYY-MM-DD in JST
  },
  { timestamps: true }
);

let LoginRecord;
try {
  LoginRecord = mongoose.model('LoginRecord');
} catch (e) {
  LoginRecord = mongoose.model('LoginRecord', loginRecordSchema);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('login')
    .setDescription('Claim your daily login fans (resets at midnight JST).'),

  /**
   * @param {import('discord.js').CommandInteraction} interaction
   */
  async execute(interaction) {
    await interaction.deferReply();

    try {
      const userId = interaction.user.id;

      // -----------------------------
      // Determine if user is frozen
      // (checks both frozen user IDs + frozen roles)
      // -----------------------------
      const guild = interaction.guild;
      let member = interaction.member;

      // Ensure member is fetched (role cache)
      if (guild && (!member || !member.roles?.cache)) {
        member = await guild.members.fetch(userId).catch(() => null);
      }

      const frozen = isFrozen(userId, member);

      // Determine today's JST date string
      const todayJST = jstDateStringFor();

      // Fetch login record
      const rec = await LoginRecord.findOne({ userId }).exec();

      if (rec && rec.lastLoginJST === todayJST) {
        // Already logged in today — show a relative next reset
        const nextResetUnix = nextJstMidnightUnix();
        await interaction.editReply(
          `You already logged in today. Come back after midnight (<t:${nextResetUnix}:R>.)`
        );
        return;
      }

      // Determine which range applies
      let range = DEFAULT_RANGE;

      // 1) Check special user ranges first
      if (SPECIAL_USER_RANGES[userId]) {
        range = SPECIAL_USER_RANGES[userId];
      } else {
        // 2) Check roles (if in a guild)
        if (member && member.roles && member.roles.cache) {
          for (const [roleId, r] of Object.entries(SPECIAL_ROLE_RANGES)) {
            if (member.roles.cache.has(roleId)) {
              range = r;
              break;
            }
          }
        }
      }

      // Compute random fans amount
      const min = Number(range.min) || 0;
      const max = Number(range.max) || min;
      const fans = randIntInclusive(min, max);

      // Persist login record (upsert)
      await LoginRecord.findOneAndUpdate(
        { userId },
        { $set: { lastLoginJST: todayJST } },
        { upsert: true, new: true }
      ).exec();

      // Add points to user document (create user doc if missing)
      // We assume your User model uses `id` as the user identifier field.
      await User.findOneAndUpdate(
        { id: userId },
        { $inc: { points: fans }, $setOnInsert: { id: userId } },
        { upsert: true, new: true }
      ).exec();

      // ✅ Frozen bonus: +86 pulls (ONLY for frozen users)
      let pullsGranted = 0;
      if (frozen) {
        pullsGranted = 86;
        await addPulls(userId, pullsGranted);
      }

      // Reply to user
      if (frozen) {
        await interaction.editReply(
          `You logged in for the day and earned **${fans}** fans 🎉\n` +
          `Frozen bonus: **+${pullsGranted} pulls** 🎟️`
        );
      } else {
        await interaction.editReply(
          `You logged in for the day and earned **${fans}** fans 🎉`
        );
      }
    } catch (err) {
      console.error('[cmd:login] error', err);
      try {
        await interaction.editReply(
          'An error occurred while processing your login. Please try again later.'
        );
      } catch (e) {
        /* ignore */
      }
    }
  },
};
