const mongoose = require('mongoose');
const StreamEvent = require('../models/StreamEvent');
const StreamActionLog = require('../models/StreamActionLog');
const Oshi = require('../models/Oshi');
const {
  getStreamMemberIds,
  SUB_VALUES,
  refreshEventMessage,
} = require('../jobs/streamManager');

const PREFIX = '!';
const ALLOWED_IDS = [
  '153551890976735232',
  '409717160995192832',
  '272129129841688577',
];

function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function getUserState(ev, userId) {
  return (ev.users || []).find(state => String(state.userId) === String(userId)) || null;
}

function memberAdjustedCardValue(base) {
  return Math.ceil(Number(base || 0) * 1.10);
}

function correctedSubHappiness(log) {
  const meta = log.meta || {};

  // Normal selected-card Sub logs include each gifted card and its base value.
  if (meta.mode === 'selected' && Array.isArray(meta.cards)) {
    let total = 0;
    for (const card of meta.cards) {
      const count = Math.max(0, Number(card?.count || 0));
      const rarity = String(card?.rarity || '').toUpperCase();
      const baseEach = Number(card?.baseHappinessEach || SUB_VALUES[rarity] || 0);
      if (!baseEach || !count) continue;
      total += memberAdjustedCardValue(baseEach) * count;
    }
    return total;
  }

  // Mass Gift logs store rarity + cardCount instead of per-card happiness.
  if (meta.mode === 'mass') {
    const rarity = String(meta.rarity || '').toUpperCase();
    const count = Math.max(0, Number(meta.cardCount || 0));
    const baseEach = Number(SUB_VALUES[rarity] || 0);
    if (baseEach && count) return memberAdjustedCardValue(baseEach) * count;
  }

  // Fallback for any older log shape that at least recorded baseHappiness.
  // This is less exact than per-card rounding, so only use it when the richer
  // fields above are unavailable.
  const base = Math.max(0, Number(meta.baseHappiness || 0));
  return base ? Math.ceil(base * 1.10) : Number(log.happiness || 0);
}

function updateSelectedSubCardMeta(meta) {
  if (meta?.mode !== 'selected' || !Array.isArray(meta.cards)) return meta;

  meta.cards = meta.cards.map(card => {
    const rarity = String(card?.rarity || '').toUpperCase();
    const baseEach = Number(card?.baseHappinessEach || SUB_VALUES[rarity] || 0);
    if (!baseEach) return card;
    return {
      ...card,
      baseHappinessEach: baseEach,
      finalHappinessEach: memberAdjustedCardValue(baseEach),
    };
  });

  return meta;
}

async function getActiveEvents() {
  const now = new Date();
  return StreamEvent.find({
    status: 'active',
    spawnAt: { $lte: now },
    endsAt: { $gt: now },
  })
    .sort({ spawnAt: -1 })
    .lean()
    .exec();
}

function parseTargetArgs(args = []) {
  const raw = args.map(x => String(x));
  const dryRun = raw.some(x => x.toLowerCase() === '--dry-run');
  const previous = raw.some(x => x.toLowerCase() === '--previous');
  const list = raw.some(x => x.toLowerCase() === '--list');

  let eventId = null;
  let streamName = null;

  const eventIndex = raw.findIndex(x => x.toLowerCase() === '--event');
  if (eventIndex >= 0 && raw[eventIndex + 1]) eventId = raw[eventIndex + 1];

  const streamIndex = raw.findIndex(x => x.toLowerCase() === '--stream');
  if (streamIndex >= 0) {
    const parts = [];
    for (let i = streamIndex + 1; i < raw.length; i += 1) {
      if (raw[i].startsWith('--')) break;
      parts.push(raw[i]);
    }
    if (parts.length) streamName = parts.join(' ');
  }

  // Convenience form: !repaircurrentstream Council --dry-run
  if (!eventId && !streamName && !previous && !list) {
    const positional = raw.filter(x => !x.startsWith('--'));
    if (positional.length) streamName = positional.join(' ');
  }

  return { dryRun, previous, list, eventId, streamName };
}

function selectActiveEvent(activeEvents, target) {
  if (!activeEvents.length) return null;

  if (target.eventId) {
    return activeEvents.find(ev => String(ev.eventId) === String(target.eventId)) || null;
  }

  if (target.streamName) {
    const wanted = String(target.streamName).trim().toLowerCase();
    return activeEvents.find(ev => String(ev.oshiId || '').trim().toLowerCase() === wanted) || null;
  }

  if (target.previous) return activeEvents[1] || null;
  return activeEvents[0];
}

module.exports = {
  name: 'repaircurrentstream',
  description: 'Repair missed automatic stream membership bonuses for an active stream (admin only)',

  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      if (!ALLOWED_IDS.includes(String(message.author.id))) {
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      const target = parseTargetArgs(args);
      const dryRun = target.dryRun;
      const activeEvents = await getActiveEvents();

      if (target.list) {
        if (!activeEvents.length) {
          return message.reply({ content: 'There are no active streams.' }).catch(() => {});
        }
        const lines = ['**Active Streams**'];
        activeEvents.forEach((ev, index) => {
          lines.push(`${index + 1}. **${ev.oshiId}** — eventId: \`${ev.eventId}\`${index === 0 ? ' (newest)' : ''}`);
        });
        lines.push('', 'Target one with `!repaircurrentstream <stream name> --dry-run`, `--previous`, or `--event <eventId>`.');
        return message.reply({ content: lines.join('\n').slice(0, 1900) }).catch(() => {});
      }

      if (!activeEvents.length) {
        return message.reply({ content: 'There is no active stream to repair.' }).catch(() => {});
      }

      const current = selectActiveEvent(activeEvents, target);

      if (!current) {
        const available = activeEvents.map(ev => `**${ev.oshiId}** (\`${ev.eventId}\`)`).join(', ');
        const requested = target.previous
          ? 'the previous active stream'
          : target.eventId
            ? `eventId \`${target.eventId}\``
            : `stream **${target.streamName || 'unknown'}**`;
        return message.reply({
          content: `Could not find ${requested}. Active streams: ${available}`.slice(0, 1900),
        }).catch(() => {});
      }

      const memberIds = new Set(getStreamMemberIds(current.oshiId).map(normalizeId).filter(Boolean));
      if (!memberIds.size) {
        return message.reply({
          content: `The current stream \`${current.oshiId}\` has no resolved stream-member Oshi IDs, so nothing can be repaired.`,
        }).catch(() => {});
      }

      const session = await mongoose.startSession();
      let report = null;

      try {
        await session.withTransaction(async () => {
          const ev = await StreamEvent.findOne({ eventId: current.eventId }).session(session);
          if (!ev || ev.status !== 'active' || new Date(ev.endsAt).getTime() <= Date.now()) {
            throw new Error('The current stream ended before the repair could run.');
          }

          const logs = await StreamActionLog.find({
            eventId: ev.eventId,
            action: { $in: ['like', 'sub', 'superchat'] },
          })
            .sort({ createdAt: 1, _id: 1 })
            .session(session);

          const actionUserIds = [...new Set(logs.map(log => String(log.userId)))];
          const oshiDocs = actionUserIds.length
            ? await Oshi.find({ userId: { $in: actionUserIds } }, { userId: 1, oshiId: 1 }).session(session).lean()
            : [];

          const oshiByUser = new Map(oshiDocs.map(doc => [String(doc.userId), normalizeId(doc.oshiId)]));
          const affectedUsers = new Set(
            actionUserIds.filter(userId => memberIds.has(oshiByUser.get(userId)))
          );

          const logsByUser = new Map();
          for (const log of logs) {
            const userId = String(log.userId);
            if (!affectedUsers.has(userId)) continue;
            if (!logsByUser.has(userId)) logsByUser.set(userId, []);
            logsByUser.get(userId).push(log);
          }

          let totalDelta = 0;
          let likeDelta = 0;
          let subDelta = 0;
          let superchatDelta = 0;
          let likesRepaired = 0;
          let subsRepaired = 0;
          let superchatsChanged = 0;
          let usersChanged = 0;
          const changedUserIds = [];

          for (const [userId, userLogs] of logsByUser.entries()) {
            const state = getUserState(ev, userId);
            if (!state) continue;

            let userDelta = 0;
            let userLikeDelta = 0;
            let userSubDelta = 0;
            let userSuperchatDelta = 0;

            // Like: matching stream Oshi should have been x2 from the start.
            for (const log of userLogs.filter(x => x.action === 'like')) {
              const level = Math.max(0, Math.floor(Number(log.meta?.oshiLevel || 0)));
              const desired = level * 2;
              const old = Number(log.happiness || 0);
              const delta = desired - old;

              if (delta > 0) {
                userDelta += delta;
                userLikeDelta += delta;
                likesRepaired += 1;
              }

              if (delta !== 0 || log.meta?.matchingOshi !== true || Number(log.meta?.multiplier || 1) !== 2) {
                log.happiness = desired;
                log.meta = {
                  ...(log.meta || {}),
                  matchingOshi: true,
                  multiplier: 2,
                  repairCurrentStreamApplied: true,
                };
                if (!dryRun) await log.save({ session });
              }
            }

            // Subs: membership bonus is rounded per gifted card.
            for (const log of userLogs.filter(x => x.action === 'sub')) {
              const desired = correctedSubHappiness(log);
              const old = Number(log.happiness || 0);
              const delta = desired - old;

              if (delta > 0) {
                userDelta += delta;
                userSubDelta += delta;
                subsRepaired += 1;
              }

              if (delta !== 0 || log.meta?.memberBonus !== true) {
                const meta = updateSelectedSubCardMeta({ ...(log.meta || {}) });
                log.happiness = desired;
                log.meta = {
                  ...meta,
                  memberBonus: true,
                  finalHappiness: desired,
                  repairCurrentStreamApplied: true,
                };
                if (!dryRun) await log.save({ session });
              }
            }

            // Superchats: replay the entire user's chain as an automatic member
            // from the beginning so the carried 10% fractional remainder stays exact.
            const scLogs = userLogs.filter(x => x.action === 'superchat');
            if (scLogs.length) {
              let remainder = 0;
              let oldTotal = 0;
              let desiredTotal = 0;

              for (const log of scLogs) {
                const yen = Math.max(0, Number(log.meta?.yen || log.meta?.baseHappiness || 0));
                const old = Number(log.happiness || 0);
                oldTotal += old;

                const remainderBefore = remainder;
                const rawBonus = yen * 0.10 + remainderBefore;
                const bonus = Math.floor(rawBonus + 1e-9);
                remainder = Math.max(0, rawBonus - bonus);
                const desired = yen + bonus;
                desiredTotal += desired;

                const needsChange =
                  old !== desired ||
                  log.meta?.memberBonusActive !== true ||
                  Number(log.meta?.bonusHappiness || 0) !== bonus ||
                  Math.abs(Number(log.meta?.remainderBefore || 0) - remainderBefore) > 1e-9 ||
                  Math.abs(Number(log.meta?.remainderAfter || 0) - remainder) > 1e-9;

                if (needsChange) {
                  superchatsChanged += 1;
                  log.happiness = desired;
                  log.meta = {
                    ...(log.meta || {}),
                    yen,
                    baseHappiness: yen,
                    memberBonusActive: true,
                    bonusHappiness: bonus,
                    remainderBefore,
                    remainderAfter: remainder,
                    finalHappiness: desired,
                    repairCurrentStreamApplied: true,
                  };
                  if (!dryRun) await log.save({ session });
                }
              }

              const delta = desiredTotal - oldTotal;
              if (delta > 0) {
                userDelta += delta;
                userSuperchatDelta += delta;
              }

              if (!dryRun) state.superchatBonusRemainder = remainder;
            }

            if (userDelta > 0) {
              usersChanged += 1;
              changedUserIds.push(userId);
              totalDelta += userDelta;
              likeDelta += userLikeDelta;
              subDelta += userSubDelta;
              superchatDelta += userSuperchatDelta;

              if (!dryRun) {
                state.happiness = Number(state.happiness || 0) + userDelta;
                state.likeHappiness = Number(state.likeHappiness || 0) + userLikeDelta;
                state.subHappiness = Number(state.subHappiness || 0) + userSubDelta;
                state.superchatHappiness = Number(state.superchatHappiness || 0) + userSuperchatDelta;
              }
            }
          }

          if (!dryRun && totalDelta > 0) {
            ev.happiness = Number(ev.happiness || 0) + totalDelta;
            await ev.save({ session });
          }

          report = {
            eventId: ev.eventId,
            stream: ev.oshiId,
            memberIds: [...memberIds],
            usersScanned: actionUserIds.length,
            matchingUsers: affectedUsers.size,
            usersChanged,
            changedUserIds,
            likesRepaired,
            subsRepaired,
            superchatsChanged,
            likeDelta,
            subDelta,
            superchatDelta,
            totalDelta,
            dryRun,
          };

        });
      } finally {
        await session.endSession();
      }

      if (!report) throw new Error('Repair completed without a report.');

      if (!report.dryRun && report.totalDelta > 0) {
        await refreshEventMessage(message.client, report.eventId).catch(err => {
          console.warn('[repaircurrentstream] failed to refresh stream message:', err?.message || err);
        });
      }

      const membersText = report.memberIds.join(', ') || 'none';
      const changedText = report.changedUserIds.length
        ? report.changedUserIds.map(id => `<@${id}>`).join(', ')
        : 'None';

      const lines = [
        report.dryRun ? '**Current Stream Repair — DRY RUN**' : '**Current Stream Repair Complete**',
        `Stream: **${report.stream}**`,
        `Resolved members: **${membersText}**`,
        `Action users scanned: **${report.usersScanned}**`,
        `Matching-Oshi users: **${report.matchingUsers}**`,
        `Users receiving missing Happiness: **${report.usersChanged}**`,
        `Likes repaired: **${report.likesRepaired}** (+${report.likeDelta})`,
        `Subs repaired: **${report.subsRepaired}** (+${report.subDelta})`,
        `Superchat logs recalculated: **${report.superchatsChanged}** (+${report.superchatDelta})`,
        `Total Happiness added: **+${report.totalDelta}**`,
        `Affected: ${changedText}`,
      ];

      if (report.dryRun) {
        let applyCommand = '!repaircurrentstream';
        if (target.eventId) applyCommand += ` --event ${target.eventId}`;
        else if (target.streamName) applyCommand += ` ${target.streamName}`;
        else if (target.previous) applyCommand += ' --previous';
        lines.push('', `Nothing was written. Run \`${applyCommand}\` to apply it.`);
      } else if (report.totalDelta === 0) {
        lines.push('', 'No missing automatic-membership Happiness was found. Running this command again is safe.');
      } else {
        lines.push('', 'The action logs were rewritten to their corrected values, so running this command again will not double-pay them.');
      }

      return message.reply({ content: lines.join('\n').slice(0, 1900) }).catch(() => {});
    } catch (err) {
      console.error('[repaircurrentstream] error:', err);
      return message.reply({
        content: `Failed to repair the current stream: ${err?.message || 'unknown error'}`,
      }).catch(() => {});
    }
  },
};
