// message-commands/resetLogins.js
// Owner-only command to reset daily login records and help test login streaks.
//
// Default behavior:
// !resetlogins @user
// - deletes the user's daily LoginRecord so they can /login again immediately
// - shifts their LoginCardEventRecord lastLoginJST to yesterday
// - keeps the same streak value
//
// Example natural streak test:
// User does /login and gets Day 1.
// Owner runs: !resetlogins @user
// User does /login again.
// Result: Day 2.
//
// Other examples:
//
// Force next login to be Day 7:
// !resetlogins @user --next-streak=7
//
// Only reset daily login blocker:
// !resetlogins @user --scope=daily
//
// Reset event streak completely:
// !resetlogins @user --scope=event --mode=delete
//
// Reset all daily logins:
// !resetlogins --scope=daily --confirm=true
//
// Reset all event streaks:
// !resetlogins --scope=event --confirm=true

const mongoose = require('mongoose');
const { Schema } = mongoose;

const PREFIX = '!';
const COMMAND_NAME = 'resetlogins';

const OWNER_IDS = new Set([
  '409717160995192832',
  '153551890976735232',
  '272129129841688577',
]);

// Must match LOGIN_CARD_EVENT.eventKey from login.js.
// You can override with --event-key=some-key
const DEFAULT_EVENT_KEY = 'may-2026-login-card-event';

const TOKYO_TZ = 'Asia/Tokyo';

// =====================
// JST helpers
// =====================

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
  return map;
}

function jstDateStringFor(dateInput = new Date()) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const { year, month, day } = getTokyoParts(date);
  return `${year}-${month}-${day}`;
}

function previousJstDateString(todayJST) {
  const [year, month, day] = String(todayJST).split('-').map(Number);

  // JST date 00:00 is previous UTC day 15:00.
  const todayJstMidnightUtcMs = Date.UTC(year, month - 1, day - 1, 15, 0, 0);
  const previousJstMidnightUtcMs = todayJstMidnightUtcMs - 24 * 60 * 60 * 1000;

  return jstDateStringFor(new Date(previousJstMidnightUtcMs));
}

// =====================
// Flag parsing
// =====================

function parseFlags(content) {
  const parts = content.trim().split(/\s+/).slice(1);
  const flags = {};

  for (const p of parts) {
    if (!p.startsWith('--')) continue;

    const without = p.slice(2);
    const eqIndex = without.indexOf('=');

    if (eqIndex === -1) {
      flags[without] = true;
    } else {
      const key = without.slice(0, eqIndex);
      let value = without.slice(eqIndex + 1);

      value = value.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');

      flags[key] = value;
    }
  }

  return flags;
}

function truthy(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
}

function extractUserId(raw) {
  if (!raw) return null;

  const str = String(raw).trim();

  const mentionMatch = str.match(/^<@!?(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];

  const idMatch = str.match(/^(\d{15,25})$/);
  if (idMatch) return idMatch[1];

  return null;
}

// =====================
// Models
// =====================

const loginRecordSchema = new Schema(
  {
    userId: { type: String, required: true, index: true, unique: true },
    lastLoginJST: { type: String, required: true },
  },
  { timestamps: true }
);

let LoginRecord;
try {
  LoginRecord = mongoose.model('LoginRecord');
} catch (e) {
  LoginRecord = mongoose.model('LoginRecord', loginRecordSchema);
}

const loginCardEventRecordSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    eventKey: { type: String, required: true, index: true },
    lastLoginJST: { type: String, default: null },
    streak: { type: Number, default: 0 },
  },
  { timestamps: true }
);

loginCardEventRecordSchema.index({ userId: 1, eventKey: 1 }, { unique: true });

let LoginCardEventRecord;
try {
  LoginCardEventRecord = mongoose.model('LoginCardEventRecord');
} catch (e) {
  LoginCardEventRecord = mongoose.model('LoginCardEventRecord', loginCardEventRecordSchema);
}

// =====================
// Target resolving
// =====================

async function resolveTargetUserIds(message, explicitTarget) {
  if (!explicitTarget) return [];

  const targetId = extractUserId(explicitTarget);
  if (targetId) {
    return [targetId];
  }

  if (!message.guild) {
    return [];
  }

  const roleMentionMatch = String(explicitTarget).match(/^<@&(\d+)>$/);
  const roleId = roleMentionMatch ? roleMentionMatch[1] : null;

  if (roleId) {
    const role = message.guild.roles.cache.get(roleId);
    if (!role) return [];
    return Array.from(role.members.values()).map(m => m.user.id);
  }

  const roleByName = message.guild.roles.cache.find(
    r => r.name.toLowerCase() === String(explicitTarget).toLowerCase()
  );

  if (roleByName) {
    return Array.from(roleByName.members.values()).map(m => m.user.id);
  }

  const memberByName = message.guild.members.cache.find(m => {
    const username = m.user.username?.toLowerCase();
    const tag = `${m.user.username}#${m.user.discriminator}`.toLowerCase();
    const target = String(explicitTarget).toLowerCase();

    return username === target || tag === target;
  });

  if (memberByName) {
    return [memberByName.user.id];
  }

  return [];
}

// =====================
// Operations
// =====================

async function resetDailyForIds(userIds, mode) {
  if (!userIds.length) return 0;

  if (mode === 'delete') {
    const res = await LoginRecord.deleteMany({ userId: { $in: userIds } }).exec();
    return res.deletedCount || 0;
  }

  const res = await LoginRecord.updateMany(
    { userId: { $in: userIds } },
    { $unset: { lastLoginJST: '' } }
  ).exec();

  return res.modifiedCount || res.nModified || 0;
}

async function resetEventForIds(userIds, eventKey, mode) {
  if (!userIds.length) return 0;

  if (mode === 'delete') {
    const res = await LoginCardEventRecord.deleteMany({
      userId: { $in: userIds },
      eventKey,
    }).exec();

    return res.deletedCount || 0;
  }

  const res = await LoginCardEventRecord.updateMany(
    {
      userId: { $in: userIds },
      eventKey,
    },
    {
      $set: {
        streak: 0,
        lastLoginJST: null,
      },
    }
  ).exec();

  return res.modifiedCount || res.nModified || 0;
}

// This is the important testing helper.
// It deletes the normal daily blocker and shifts eventLastLoginJST to yesterday.
// The streak number stays the same, so the next /login naturally increments it.
async function advanceOneTestDayForIds(userIds, eventKey) {
  const todayJST = jstDateStringFor();
  const yesterdayJST = previousJstDateString(todayJST);

  let affected = 0;
  let createdEventRecords = 0;

  for (const userId of userIds) {
    // Allow immediate /login again.
    await LoginRecord.deleteOne({ userId }).exec();

    const existing = await LoginCardEventRecord.findOne({
      userId,
      eventKey,
    }).exec();

    if (existing) {
      await LoginCardEventRecord.updateOne(
        { userId, eventKey },
        {
          $set: {
            lastLoginJST: yesterdayJST,
          },
        }
      ).exec();
    } else {
      // If there is no event streak yet, create one as if yesterday was Day 1.
      // Then next /login becomes Day 2.
      await LoginCardEventRecord.create({
        userId,
        eventKey,
        lastLoginJST: yesterdayJST,
        streak: 1,
      });

      createdEventRecords += 1;
    }

    affected += 1;
  }

  return {
    affected,
    createdEventRecords,
    todayJST,
    yesterdayJST,
  };
}

// Explicit override.
// Example: --next-streak=7 means store streak 6 and yesterday,
// so next /login becomes Day 7.
async function setNextStreakForIds(userIds, eventKey, nextStreak) {
  const todayJST = jstDateStringFor();
  const yesterdayJST = previousJstDateString(todayJST);

  const previousStreak = Math.max(0, Number(nextStreak) - 1);

  let affected = 0;

  for (const userId of userIds) {
    await LoginRecord.deleteOne({ userId }).exec();

    await LoginCardEventRecord.findOneAndUpdate(
      { userId, eventKey },
      {
        $set: {
          lastLoginJST: yesterdayJST,
          streak: previousStreak,
        },
        $setOnInsert: {
          userId,
          eventKey,
        },
      },
      { upsert: true, new: true }
    ).exec();

    affected += 1;
  }

  return {
    affected,
    todayJST,
    yesterdayJST,
    storedStreak: previousStreak,
    nextStreak,
  };
}

// =====================
// Command
// =====================

module.exports = {
  name: COMMAND_NAME,
  description: 'Owner-only. Reset daily login records and test login card event streaks.',

  /**
   * @param {import('discord.js').Message} message
   * @param {string[]} args
   */
  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      const tokens = message.content.trim().split(/\s+/);
      const commandToken = tokens[0].toLowerCase();

      if (commandToken !== `${PREFIX}${COMMAND_NAME}`) return;

      if (!OWNER_IDS.has(message.author.id)) {
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      const flags = parseFlags(message.content);

      const maybeTarget =
        tokens[1] && !tokens[1].startsWith('--')
          ? tokens[1]
          : null;

      const explicitTarget = flags.target || maybeTarget || null;

      const scope = String(flags.scope || 'advance').toLowerCase();
      const mode = String(flags.mode || 'delete').toLowerCase();
      const eventKey = String(flags['event-key'] || flags.eventKey || DEFAULT_EVENT_KEY);

      const validScopes = new Set(['advance', 'daily', 'event', 'both']);
      const validModes = new Set(['delete', 'unset']);

      if (!validScopes.has(scope)) {
        return message.reply({
          content:
            'Invalid scope. Use `--scope=advance`, `--scope=daily`, `--scope=event`, or `--scope=both`.',
        }).catch(() => {});
      }

      if (!validModes.has(mode)) {
        return message.reply({
          content: 'Invalid mode. Use `--mode=delete` or `--mode=unset`.',
        }).catch(() => {});
      }

      const nextStreakRaw = flags['next-streak'] || flags.nextStreak || null;
      const hasNextStreak = nextStreakRaw !== null && nextStreakRaw !== undefined;

      // Resolve target users unless operating on all.
      const operateOnAll = !explicitTarget;

      let targetUserIds = [];

      if (!operateOnAll) {
        targetUserIds = await resolveTargetUserIds(message, explicitTarget);
        targetUserIds = Array.from(new Set(targetUserIds));

        if (!targetUserIds.length) {
          return message.reply({
            content: 'No matching users found for the provided target.',
          }).catch(() => {});
        }
      }

      // Explicit next-streak still exists for direct Day 7 testing.
      if (hasNextStreak) {
        const nextStreak = Number(nextStreakRaw);

        if (!Number.isInteger(nextStreak) || nextStreak < 1) {
          return message.reply({
            content: 'Invalid `--next-streak`. Use a positive whole number, e.g. `--next-streak=7`.',
          }).catch(() => {});
        }

        if (operateOnAll) {
          return message.reply({
            content: '`--next-streak` requires a target user, mention, ID, or role.',
          }).catch(() => {});
        }

        const result = await setNextStreakForIds(targetUserIds, eventKey, nextStreak);

        return message.reply({
          content:
            `Prepared **${result.affected}** user(s) so their next /login is **Day ${result.nextStreak}**.\n` +
            `Event key: \`${eventKey}\`\n` +
            `Stored event streak: \`${result.storedStreak}\`\n` +
            `Stored event lastLoginJST: \`${result.yesterdayJST}\`\n` +
            `Daily login records were deleted so they can test immediately.`,
        }).catch(() => {});
      }

      // New default for targeted usage:
      // !resetlogins @user
      // acts as next day for streak testing.
      if (scope === 'advance') {
        if (operateOnAll) {
          return message.reply({
            content:
              '`--scope=advance` requires a target user, mention, ID, or role.\n' +
              'Example: `!resetlogins @user`',
          }).catch(() => {});
        }

        const result = await advanceOneTestDayForIds(targetUserIds, eventKey);

        return message.reply({
          content:
            `Advanced **${result.affected}** user(s) by one test day.\n` +
            `Event key: \`${eventKey}\`\n` +
            `Set event lastLoginJST to yesterday: \`${result.yesterdayJST}\`\n` +
            `Deleted daily login records so they can /login again immediately.\n` +
            `Created new event streak records: **${result.createdEventRecords}**`,
        }).catch(() => {});
      }

      // Safety: all-user destructive operations require confirm.
      if (operateOnAll && !truthy(flags.confirm)) {
        return message.reply({
          content:
            'This will reset login records for **ALL users**.\n' +
            'If you are sure, re-run with `--confirm=true`.',
        }).catch(() => {});
      }

      let dailyAffected = 0;
      let eventAffected = 0;

      if (operateOnAll) {
        if (scope === 'daily' || scope === 'both') {
          if (mode === 'delete') {
            const res = await LoginRecord.deleteMany({}).exec();
            dailyAffected = res.deletedCount || 0;
          } else {
            const res = await LoginRecord.updateMany({}, { $unset: { lastLoginJST: '' } }).exec();
            dailyAffected = res.modifiedCount || res.nModified || 0;
          }
        }

        if (scope === 'event' || scope === 'both') {
          if (mode === 'delete') {
            const res = await LoginCardEventRecord.deleteMany({ eventKey }).exec();
            eventAffected = res.deletedCount || 0;
          } else {
            const res = await LoginCardEventRecord.updateMany(
              { eventKey },
              {
                $set: {
                  streak: 0,
                  lastLoginJST: null,
                },
              }
            ).exec();

            eventAffected = res.modifiedCount || res.nModified || 0;
          }
        }
      } else {
        if (scope === 'daily' || scope === 'both') {
          dailyAffected = await resetDailyForIds(targetUserIds, mode);
        }

        if (scope === 'event' || scope === 'both') {
          eventAffected = await resetEventForIds(targetUserIds, eventKey, mode);
        }
      }

      const lines = [
        `Reset complete.`,
        `Scope: \`${scope}\``,
        `Mode: \`${mode}\``,
      ];

      if (scope === 'event' || scope === 'both') {
        lines.push(`Event key: \`${eventKey}\``);
      }

      if (scope === 'daily' || scope === 'both') {
        lines.push(`Daily login records affected: **${dailyAffected}**`);
      }

      if (scope === 'event' || scope === 'both') {
        lines.push(`Event streak records affected: **${eventAffected}**`);
      }

      return message.reply({ content: lines.join('\n') }).catch(() => {});
    } catch (err) {
      console.error('[resetlogins] unexpected error', err);

      try {
        await message.reply({ content: 'Unexpected error running resetlogins.' });
      } catch (_) {}
    }
  },
};