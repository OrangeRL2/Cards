// message-commands/timeline.js
//
// Admin/testing helper for Summer Timeline catch-up.
//
// Usage:
//   !timeline --clear
//   !timeline --clear @user
//   !timeline --clear --dry-run
//   !timeline --clear @user --dry-run
//
// Behavior:
// - Only historical days (strictly before today in JST) are processed.
// - Already completed windows are untouched.
// - In-progress windows continue their existing canonical route.
// - Fresh missing windows pick one currently valid core activity at random.
// - Each step picks one currently valid option at random.
// - Completion goes through summerActivity.selectCore()/chooseOption(), so
//   normal rewards, flags, stats, and special completion hooks are preserved.

const SummerUser = require('../models/SummerUser');
const A = require('../utils/summerActivity');

const PREFIX = '!';
const COMMAND_NAME = 'timeline';

// Same restricted-prefix-command style used elsewhere in this project.
// Add/remove IDs here if needed.
const ALLOWED_IDS = [
  '153551890976735232',
  '409717160995192832',
  '272129129841688577',
];

const ALLOWED_ROLE_IDS = [
  '844054364033384470',
];

function isAllowed(message) {
  const userId = String(message.author?.id || '');

  if (ALLOWED_IDS.includes(userId)) {
    return true;
  }

  const memberRoles = message.member?.roles?.cache;
  if (!memberRoles) {
    return false;
  }

  return ALLOWED_ROLE_IDS.some(roleId =>
    memberRoles.has(String(roleId))
  );
}

const MAX_STEPS_PER_WINDOW = 100;

function parseFlags(content) {
  const parts = String(content || '').trim().split(/\s+/).slice(1);
  const flags = {};

  for (const part of parts) {
    if (!part.startsWith('--')) continue;
    const raw = part.slice(2);
    const [key, value] = raw.split(/=(.+)/);
    flags[key] = value === undefined ? true : value;
  }

  return flags;
}

function todayJstKey(now = new Date()) {
  const p = A.jstParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

function historicalDays(now = new Date()) {
  const today = todayJstKey(now);
  const days = [];

  for (let day = 1; day <= 31; day += 1) {
    const data = A.getDayData(day);
    if (data?.date && String(data.date) < today) {
      days.push(data);
    }
  }

  return days;
}

function randomItem(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] || items[0];
}

async function getSummerUser(userId) {
  return SummerUser.findOne({ userId: String(userId) }).lean().exec();
}

async function countMissing(userId, days) {
  const doc = await getSummerUser(userId);
  if (!doc) return { missing: 0, completed: 0, total: 0 };

  let missing = 0;
  let completed = 0;
  let total = 0;

  for (const data of days) {
    for (const windowName of A.WINDOWS) {
      if (!data?.windows?.[windowName]) continue;
      total += 1;

      const state = A.getWindowState(doc, data.day, windowName);
      if (state.completed) completed += 1;
      else missing += 1;
    }
  }

  return { missing, completed, total };
}

async function completeWindow(userId, day, windowName) {
  let steps = 0;

  while (steps < MAX_STEPS_PER_WINDOW) {
    steps += 1;

    const doc = await getSummerUser(userId);
    if (!doc) {
      return { success: false, reason: 'NO_SUMMER_USER' };
    }

    let state = A.getWindowState(doc, day, windowName);

    if (state.completed) {
      return { success: true, alreadyCompleted: steps === 1 };
    }

    // If this historical window has never been started, choose a valid core.
    if (!state.coreId) {
      const cores = A.getAvailableCoreActivities(doc, day, windowName);
      const core = randomItem(cores);

      if (!core) {
        return { success: false, reason: 'NO_AVAILABLE_CORE' };
      }

      const selected = await A.selectCore(userId, day, windowName, core.id);
      if (!selected?.success) {
        return {
          success: false,
          reason: `SELECT_CORE_${selected?.reason || 'FAILED'}`,
        };
      }

      continue;
    }

    // Continue the canonical route already stored for this window.
    const options = A.getAvailableOptions(
      doc,
      day,
      windowName,
      state.coreId,
      state.stepId
    );

    // Bingo activities have explicitly correct/incorrect answers.
    // For the admin Timeline clear helper, always take a valid correct answer
    // when one exists so automated catch-up gets the best bingo result.
    const dayData = A.getDayData(day);
    const core = dayData?.windows?.[windowName]?.coreActivities
      ?.find(entry => entry.id === state.coreId);

    const correctBingoOptions = core?.bingo?.enabled
      ? options.filter(option => option.bingoCorrect === true)
      : [];

    const option = randomItem(
      correctBingoOptions.length > 0 ? correctBingoOptions : options
    );

    if (!option) {
      return {
        success: false,
        reason: `NO_AVAILABLE_OPTION:${state.coreId}:${state.stepId}`,
      };
    }

    const chosen = await A.chooseOption(
      userId,
      day,
      windowName,
      state.coreId,
      state.stepId,
      option.id
    );

    if (!chosen?.success) {
      return {
        success: false,
        reason: `CHOOSE_OPTION_${chosen?.reason || 'FAILED'}`,
      };
    }

    if (chosen.completed) {
      return {
        success: true,
        alreadyCompleted: false,
        day31TravelUnlocked: Boolean(chosen.day31TravelUnlocked),
      };
    }
  }

  return { success: false, reason: 'STEP_LIMIT' };
}

module.exports = {
  name: COMMAND_NAME,
  description: 'Admin helper: canonically complete all missing historical Summer Timeline activities.',

  async execute(message) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author?.bot) return;

      const token = message.content
        .slice(PREFIX.length)
        .trim()
        .split(/\s+/)[0]
        ?.toLowerCase();

      if (token !== COMMAND_NAME) return;

      if (!isAllowed(message)) {
        return message.reply({
          content: 'You are not allowed to use this command.',
        }).catch(() => {});
      }

      const flags = parseFlags(message.content);

      if (!flags.clear) {
        return message.reply({
          content:
            'Usage: `!timeline --clear [@user]`\n' +
            'Optional: `--dry-run` to only count missing historical activities.',
        }).catch(() => {});
      }

      const target = message.mentions?.users?.first?.() || message.author;
      const targetId = String(target.id);

      const initialDoc = await getSummerUser(targetId);
      if (!initialDoc) {
        return message.reply({
          content: `${target} does not have a Summer profile yet.`,
        }).catch(() => {});
      }

      const days = historicalDays();
      const before = await countMissing(targetId, days);

      if (flags['dry-run']) {
        return message.reply({
          content:
            `🕰️ **Timeline dry run — ${target.username}**\n` +
            `Historical windows: **${before.total}**\n` +
            `Already completed: **${before.completed}**\n` +
            `Missing: **${before.missing}**`,
        }).catch(() => {});
      }

      if (before.missing === 0) {
        return message.reply({
          content: `✅ ${target.username} has no missing historical Timeline activities.`,
        }).catch(() => {});
      }

      const progressMessage = await message.reply({
        content:
          `🕰️ Clearing **${before.missing}** missing historical Timeline ` +
          `window${before.missing === 1 ? '' : 's'} for **${target.username}**...`,
      }).catch(() => null);

      let newlyCompleted = 0;
      let skipped = 0;
      const failures = [];
      let travelUnlocked = false;

      // Chronological processing matters because earlier choices can set flags
      // that affect which later routes/options are valid.
      for (const data of days) {
        for (const windowName of A.WINDOWS) {
          if (!data?.windows?.[windowName]) continue;

          const doc = await getSummerUser(targetId);
          if (!doc) {
            failures.push(`Day ${data.day} ${windowName}: Summer profile disappeared`);
            continue;
          }

          const state = A.getWindowState(doc, data.day, windowName);
          if (state.completed) {
            skipped += 1;
            continue;
          }

          const result = await completeWindow(targetId, data.day, windowName);

          if (result.success) {
            if (!result.alreadyCompleted) newlyCompleted += 1;
            if (result.day31TravelUnlocked) travelUnlocked = true;
          } else {
            failures.push(
              `Day ${data.day} ${windowName}: ${result.reason || 'unknown failure'}`
            );
          }
        }
      }

      const after = await countMissing(targetId, days);

      const lines = [
        `✅ **Timeline clear finished — ${target.username}**`,
        `Completed now: **${newlyCompleted}**`,
        `Missing before: **${before.missing}**`,
        `Missing after: **${after.missing}**`,
      ];

      if (travelUnlocked) {
        lines.push('🛥️ Day 31 island travel was unlocked.');
      }

      if (failures.length) {
        lines.push(
          '',
          `⚠️ **${failures.length} window${failures.length === 1 ? '' : 's'} could not be completed:**`,
          ...failures.slice(0, 12).map(x => `• ${x}`)
        );

        if (failures.length > 12) {
          lines.push(`• ...and ${failures.length - 12} more`);
        }
      }

      const payload = { content: lines.join('\n') };

      if (progressMessage?.edit) {
        return progressMessage.edit(payload).catch(() => message.channel.send(payload));
      }

      return message.channel.send(payload).catch(() => {});
    } catch (err) {
      console.error('[timeline --clear] unexpected error', err);
      return message.reply({
        content: 'Unexpected error while clearing Summer Timeline activities.',
      }).catch(() => {});
    }
  },
};
