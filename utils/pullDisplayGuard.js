'use strict';

// A display-only safety net for operations that stall before reaching the
// existing showSavedPull() error handler (MongoDB, quota, artwork, etc.).
// This never grants cards, consumes pulls, changes Candy, or retries draws.
const { EmbedBuilder } = require('discord.js');

// Stage tracking always runs, but routine per-step console logs are off.
// Set PULL_PROGRESS_VERBOSE=1 when diagnosing a specific problem.
const VERBOSE_PROGRESS = process.env.PULL_PROGRESS_VERBOSE === '1';

function isAnimationPayload(payload) {
  const embeds = Array.isArray(payload?.embeds) ? payload.embeds : [];
  return embeds.some(embed => {
    const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
    const title = String(data?.title || '').replace(/\*/g, '');
    return /PULLING\.\.\./i.test(title) || /^[!?]{6,}$/.test(title);
  });
}

function startPullDisplayGuard(interaction, tag = 'pull', {
  warningAfterMs = 5000, lateRetryMs = 13000, stallLogMs = 30000,
  inflightGraceMs = 6000, secWarningAfterMs = 3500,
} = {}) {
  const sendEdit = interaction.editReply.bind(interaction);
  const started = Date.now();
  let stageName = 'initializing';
  let savedLines = null;
  let completed = false;
  let pendingNotice = null;
  let busyWithFinalEdit = false;
  let finalEditStartedAt = 0;
  let secTimer = null;
  let noticeShown = false;

  const trace = (kind, extra = '', force = false) => {
    if (!VERBOSE_PROGRESS && !force) return;
    console.log(
      `[${tag}-progress] ${kind}: interaction=${interaction.id || '?'} user=${interaction.user?.id || '?'} stage=${stageName} elapsed=${Date.now() - started}ms${extra ? ` ${extra}` : ''}`
    );
  };

  const warning = () => {
    if (completed || (busyWithFinalEdit && Date.now() - finalEditStartedAt < inflightGraceMs)) return;
    // Multiple calls are serialized to prevent an old notice overwriting a
    // newer saved-card notice.
    const earlier = pendingNotice;
    const run = async () => {
      if (earlier) await earlier.catch(() => null);
      if (completed || (busyWithFinalEdit && Date.now() - finalEditStartedAt < inflightGraceMs)) return;
      const hasSaved = Array.isArray(savedLines);
      const embed = new EmbedBuilder()
        .setTitle(hasSaved ? '🎴 Cards saved — finishing your pull' : '⏳ Pull still processing')
        .setDescription(hasSaved
          ? `Your cards are in your inventory. The final artwork and bonus information are still loading.\n\n${savedLines.join('\n')}`.slice(0, 4096)
          : 'The bot is still processing this pull. Please do not repeat it until you check your inventory and pull balance.');
      try {
        await sendEdit({ content: null, embeds: [embed], attachments: [], components: [] });
        noticeShown = true;
        trace('recovery notice displayed', hasSaved ? '(cards saved)' : '(awaiting completion)', true);
      } catch (error) {
        console.error(`[${tag}-progress] could not clear loading GIF`, { interaction: interaction.id, stage: stageName, code: error?.code, message: error?.message });
      }
    };
    pendingNotice = run();
    return pendingNotice;
  };

  const warningTimer = setTimeout(() => { void warning(); }, warningAfterMs);
  warningTimer.unref?.();
  const lateNoticeTimer = setTimeout(() => { if (!completed && !noticeShown) void warning(); }, lateRetryMs);
  lateNoticeTimer.unref?.();
  const diagnosticTimer = setTimeout(() => {
    if (!completed) {
      trace('SLOW PULL (30s)', savedLines ? '(inventory saved)' : '(inventory not confirmed saved)', true);
      if (!noticeShown) void warning();
    }
  }, stallLogMs);
  diagnosticTimer.unref?.();

  // Observe *every* ordinary edit, including early validation failures. When
  // Discord confirms a non-loading result, no delayed notice may overwrite it.
  interaction.editReply = async function guardedEditReply(payload, ...args) {
    const animated = isAnimationPayload(payload);
    if (animated && /^[!?]{6,}$/.test(String((payload.embeds?.[0]?.toJSON?.() || payload.embeds?.[0])?.title || '').replace(/\*/g, ''))) {
      // A special SEC animation can start long after the original GIF was
      // cleared, so it needs its own recovery timer.
      clearTimeout(secTimer);
      secTimer = setTimeout(() => { if (!completed) void warning(); }, secWarningAfterMs);
      secTimer.unref?.();
    }
    if (!animated) {
      busyWithFinalEdit = true;
      finalEditStartedAt = Date.now();
      if (pendingNotice) await pendingNotice.catch(() => null);
    }
    try {
      const message = await sendEdit(payload, ...args);
      if (!animated) {
        completed = true;
        clearTimeout(warningTimer);
        clearTimeout(lateNoticeTimer);
        clearTimeout(diagnosticTimer);
        clearTimeout(secTimer);
        trace('reply updated');
      }
      return message;
    } catch (error) {
      if (!animated) busyWithFinalEdit = false;
      throw error;
    }
  };

  return {
    stage(name) { stageName = name; trace('stage'); },
    saved(cards) {
      savedLines = (Array.isArray(cards) ? cards : [])
        .slice(0, 35).map(card => {
          const rarity = String(card?.rarity || '?').replace(/[\r\n]/g, '');
          const name = String(card?.displayName || card?.name || 'Unknown').replace(/[\r\n]/g, '');
          return `[${rarity}] ${name}`;
        });
      const remaining = (cards?.length || 0) - savedLines.length;
      if (remaining > 0) savedLines.push(`…and ${remaining} more cards`);
      trace('inventory save confirmed', `(${cards?.length || 0} cards)`);
      // If the initial warning is already visible, upgrade it with the actual
      // saved card names even while optional post-save work is pending.
      if (noticeShown && !completed) void warning();
    },
  };
}

module.exports = { startPullDisplayGuard, isAnimationPayload };
