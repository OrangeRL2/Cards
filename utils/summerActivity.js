const activities = require('../config/summer-activities.json');
const rewardTables = require('../config/summer-rewards');
const SummerUser = require('../models/SummerUser');
const User = require('../models/User');

const { findSunCardFile } = require('./summerCardFiles');

const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';
const WINDOWS = ['morning', 'noon', 'evening'];
const inFlight = new Set();

function jstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function currentWindow(hour) {
  const h = Number(hour);
  return h < 12 ? 'morning' : h < 18 ? 'noon' : 'evening';
}

function progressKey(day, windowName) {
  return `day${String(day).padStart(2, '0')}_${windowName}`;
}

function getDayNumber(summerUser, now = new Date()) {
  const override = Number(summerUser?.testing?.dayOverride);
  if (override >= 1 && override <= 31) return override;

  const parts = jstParts(now);
  if (Number(parts.month) !== activities.month || Number(parts.year) !== activities.year) {
    return null;
  }

  return Number(parts.day);
}

function getDayData(day) {
  return activities.days.find(entry => Number(entry.day) === Number(day)) || null;
}

function getWindowState(summerUser, day, windowName) {
  return summerUser?.activityProgress?.[progressKey(day, windowName)] || {};
}

function isWindowAvailable(summerUser, windowName, now = new Date()) {
  if (summerUser?.testing?.unlockAllWindows) return true;

  const day = getDayNumber(summerUser, now);
  if (!day) return false;

  if (windowName === 'morning') return true;

  const morningComplete = Boolean(
    getWindowState(summerUser, day, 'morning').completed
  );

  if (windowName === 'noon') return morningComplete;

  const noonComplete = Boolean(
    getWindowState(summerUser, day, 'noon').completed
  );

  if (windowName === 'evening') return morningComplete && noonComplete;

  return false;
}

function unique(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizeFlagList(value) {
  if (Array.isArray(value)) return unique(value);
  if (value === null || value === undefined || value === '') return [];
  return unique([value]);
}

function getStoryFlags(summerUser) {
  const flags = [...normalizeFlagList(summerUser?.storyFlags)];

  // Backward compatibility: flags stored by older versions lived only inside
  // each completed/in-progress window state. Include them when evaluating paths.
  for (const state of Object.values(summerUser?.activityProgress || {})) {
    flags.push(...normalizeFlagList(state?.flags));
  }

  return unique(flags);
}

function conditionsPass(item, flagsInput) {
  if (!item) return false;

  const flags = new Set(normalizeFlagList(flagsInput));
  const required = normalizeFlagList(item.requiredFlags);
  const requiredAny = normalizeFlagList(item.requiredAnyFlags);
  const excluded = normalizeFlagList(item.excludedFlags);

  if (required.some(flag => !flags.has(flag))) return false;
  if (requiredAny.length > 0 && !requiredAny.some(flag => flags.has(flag))) return false;
  if (excluded.some(flag => flags.has(flag))) return false;

  return true;
}

function getAvailableCoreActivities(summerUser, day, windowName) {
  const win = getDayData(day)?.windows?.[windowName];
  const flags = getStoryFlags(summerUser);
  return (win?.coreActivities || []).filter(core => conditionsPass(core, flags));
}

function getCore(day, windowName, coreId) {
  return getDayData(day)?.windows?.[windowName]?.coreActivities?.find(core => core.id === coreId) || null;
}

function getAvailableSteps(summerUser, core) {
  const flags = getStoryFlags(summerUser);
  return (core?.steps || []).filter(step => conditionsPass(step, flags));
}

function getAvailableOptions(summerUser, day, windowName, coreId, stepId) {
  const core = getCore(day, windowName, coreId);
  if (!core) return [];

  const flags = getStoryFlags(summerUser);
  if (!conditionsPass(core, flags)) return [];

  const step = core.steps?.find(entry => entry.id === stepId);
  if (!step || !conditionsPass(step, flags)) return [];

  return (step.options || []).filter(option => option.text && conditionsPass(option, flags));
}

function chooseWeighted(items) {
  const total = items.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  let roll = Math.random() * total;

  for (const item of items) {
    roll -= Number(item.weight || 0);
    if (roll < 0) return item;
  }

  return items[items.length - 1];
}

function cardImageUrl(name) {
  const card = findSunCardFile(name);
  return card
    ? `${IMAGE_BASE.replace(/\/$/, '')}/SUN/${encodeURIComponent(card.folder)}/${encodeURIComponent(card.filename)}`
    : null;
}


function normalizeRewardItems(reward) {
  if (!reward) return [];
  if (reward.type === 'bundle') return Array.isArray(reward.rewards) ? reward.rewards : [];
  return [reward];
}

function prepareReward(reward, eligible) {
  const items = normalizeRewardItems(reward).map(item => ({ ...item }));

  const prepared = items.map(item => {
    if (item.type === 'sunCard' && eligible.length === 0) {
      return { type: 'shells', amount: 20, convertedFrom: 'sunCard' };
    }
    return item;
  });

  return reward?.type === 'bundle'
    ? { ...reward, rewards: prepared }
    : prepared[0];
}

async function grantRewardItems(userId, reward, eligible, progressPath) {
  const granted = [];

  for (const rawItem of normalizeRewardItems(reward)) {
    const item = { ...rawItem };

    if (item.type === 'shells') {
      const amount = Number(item.amount || 0);
      if (amount > 0) {
        await SummerUser.updateOne({ userId }, { $inc: { summerShells: amount } }).exec();
      }
      granted.push({ ...item, amount });
      continue;
    }

    if (item.type === 'sunPulls') {
      const amount = Number(item.amount || 0);
      if (amount > 0) {
        await SummerUser.updateOne({ userId }, { $inc: { sunPulls: amount } }).exec();
      }
      granted.push({ ...item, amount });
      continue;
    }

    if (item.type === 'sunCard') {
      if (!eligible.length) {
        await SummerUser.updateOne({ userId }, { $inc: { summerShells: 20 } }).exec();
        granted.push({ type: 'shells', amount: 20, convertedFrom: 'sunCard' });
        continue;
      }

      const name = eligible[Math.floor(Math.random() * eligible.length)];
      const resolved = { ...item, name, imageUrl: cardImageUrl(name) };
      await awardCard(userId, name);
      await SummerUser.updateOne(
        { userId },
        { $inc: { 'stats.sunCardsEarned': 1 } }
      ).exec();
      granted.push(resolved);
      continue;
    }

    granted.push(item);
  }

  const resolvedReward = reward?.type === 'bundle'
    ? { ...reward, rewards: granted }
    : granted[0];

  await SummerUser.updateOne(
    { userId },
    { $set: { [progressPath]: resolvedReward } }
  ).exec();

  return resolvedReward;
}

async function awardCard(userId, name, storedName = name) {
  const now = new Date();

  await User.updateOne(
    { id: userId },
    { $setOnInsert: { id: userId, cards: [], points: 0, pulls: 0 } },
    { upsert: true }
  ).exec();

  const hit = await User.updateOne(
    { id: userId, cards: { $elemMatch: { name: storedName, rarity: 'SUN' } } },
    {
      $inc: { 'cards.$.count': 1 },
      $set: { 'cards.$.lastAcquiredAt': now },
    }
  ).exec();

  if (!hit.matchedCount) {
    await User.updateOne(
      { id: userId },
      {
        $push: {
          cards: {
            name: storedName,
            rarity: 'SUN',
            count: 1,
            firstAcquiredAt: now,
            lastAcquiredAt: now,
            locked: false,
          },
        },
      }
    ).exec();
  }
}

async function saveState(userId, key, state, storyFlags) {
  const update = { [`activityProgress.${key}`]: state };
  if (storyFlags) update.storyFlags = unique(storyFlags);

  await SummerUser.updateOne({ userId }, { $set: update }).exec();
}

function applyFlagChanges(existingFlags, option) {
  const added = unique([
    ...normalizeFlagList(option?.setFlag),
    ...normalizeFlagList(option?.setFlags),
  ]);

  const removed = new Set(unique([
    ...normalizeFlagList(option?.removeFlag),
    ...normalizeFlagList(option?.removeFlags),
    ...normalizeFlagList(option?.clearFlag),
    ...normalizeFlagList(option?.clearFlags),
  ]));

  return unique([...normalizeFlagList(existingFlags), ...added]).filter(flag => !removed.has(flag));
}

function resolveNextStep(core, requestedStepId, flags) {
  if (!requestedStepId) return null;
  const step = core?.steps?.find(entry => entry.id === requestedStepId);
  if (!step) return null;
  return conditionsPass(step, flags) ? step : null;
}

async function selectCore(userId, day, windowName, coreId) {
  const doc = await SummerUser.findOne({ userId }).lean().exec();
  const core = getCore(day, windowName, coreId);
  if (!core) return { success: false, reason: 'INVALID' };

  const flags = getStoryFlags(doc);
  if (!conditionsPass(core, flags)) {
    return { success: false, reason: 'CONDITION_FAILED' };
  }

  const key = progressKey(day, windowName);
  const old = getWindowState(doc, day, windowName);

  if (old.completed) return { success: false, reason: 'COMPLETED' };
  if (old.coreId && old.coreId !== coreId) return { success: false, reason: 'LOCKED' };

  const firstStep = getAvailableSteps(doc, core)[0] || null;
  if (!firstStep) return { success: false, reason: 'NO_AVAILABLE_STEPS' };

  const state = {
    ...old,
    coreId,
    stepId: firstStep.id,
    eligibleSunMembers: old.eligibleSunMembers || [],
    choices: old.choices || [],
    flags: old.flags || [],
    startedAt: old.startedAt || new Date(),
  };

  await saveState(userId, key, state, flags);
  return { success: true, core, state };
}

async function chooseOption(userId, day, windowName, coreId, stepId, optionId) {
  const key = String(userId);
  if (inFlight.has(key)) return { success: false, reason: 'BUSY' };

  inFlight.add(key);

  try {
    const doc = await SummerUser.findOne({ userId: key }).lean().exec();
    const core = getCore(day, windowName, coreId);
    const step = core?.steps?.find(entry => entry.id === stepId);
    const option = step?.options?.find(entry => entry.id === optionId);

    if (!core || !step || !option) return { success: false, reason: 'INVALID' };

    const currentFlags = getStoryFlags(doc);
    if (!conditionsPass(core, currentFlags) ||
        !conditionsPass(step, currentFlags) ||
        !conditionsPass(option, currentFlags)) {
      return { success: false, reason: 'CONDITION_FAILED' };
    }

    const pkey = progressKey(day, windowName);
    const old = getWindowState(doc, day, windowName);

    if (old.completed) return { success: false, reason: 'COMPLETED' };
    if (old.coreId !== coreId || old.stepId !== stepId) {
      return { success: false, reason: 'STALE' };
    }

    const eligible = unique([
      ...(old.eligibleSunMembers || []),
      ...(option.eligibleSunMembers || []),
    ]).filter(name => Boolean(findSunCardFile(name)));

    const choices = [...(old.choices || []), { stepId, optionId }];
    const localFlags = applyFlagChanges(old.flags || [], option);
    const storyFlags = applyFlagChanges(currentFlags, option);

    if (option.nextStepId) {
      const nextStep = resolveNextStep(core, option.nextStepId, storyFlags);
      if (!nextStep) {
        return {
          success: false,
          reason: 'NEXT_STEP_CONDITION_FAILED',
          nextStepId: option.nextStepId,
        };
      }

      const state = {
        ...old,
        stepId: nextStep.id,
        eligibleSunMembers: eligible,
        choices,
        flags: localFlags,
        lastResultDialogue: option.resultDialogue,
      };

      await saveState(key, pkey, state, storyFlags);
      return { success: true, completed: false, core, step, option, state };
    }

    const table = rewardTables[core.rewardTableId] || rewardTables.summer_activity_default;
    let reward = prepareReward(chooseWeighted(table), eligible);

    const state = {
      ...old,
      stepId: '',
      eligibleSunMembers: eligible,
      choices,
      flags: localFlags,
      lastResultDialogue: option.resultDialogue,
      completed: true,
      completedAt: new Date(),
      reward,
    };

    const guard = await SummerUser.updateOne(
      {
        userId: key,
        [`activityProgress.${pkey}.completed`]: { $ne: true },
      },
      {
        $set: {
          [`activityProgress.${pkey}`]: state,
          storyFlags,
          'stats.lastActivityAt': new Date(),
        },
        $inc: { 'stats.activitiesCompleted': 1 },
      }
    ).exec();

    if (!guard.modifiedCount) return { success: false, reason: 'COMPLETED' };

    reward = await grantRewardItems(
      key,
      reward,
      eligible,
      `activityProgress.${pkey}.reward`
    );

    return {
      success: true,
      completed: true,
      core,
      step,
      option,
      state: { ...state, reward },
      reward,
    };
  } catch (error) {
    console.error('[summerActivity]', error);
    return { success: false, reason: 'ERROR', error };
  } finally {
    inFlight.delete(key);
  }
}

module.exports = {
  WINDOWS,
  jstParts,
  currentWindow,
  progressKey,
  getDayNumber,
  getDayData,
  isWindowAvailable,
  getWindowState,
  getStoryFlags,
  conditionsPass,
  getAvailableCoreActivities,
  getAvailableOptions,
  selectCore,
  chooseOption,
};
