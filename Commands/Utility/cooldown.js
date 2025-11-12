// Commands/Utility/cooldown.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const pullQuota = require('../../utils/pullQuota');

function isIgnorableDiscordError(err) {
  if (!err) return false;
  try {
    const code = err.code ?? err?.error?.code;
    const status = err.status ?? err?.httpStatus ?? err?.statusCode;
    if (code === 10062) return true; // Unknown Interaction
    if (status === 404) return true;  // Not Found
  } catch (e) { /* ignore */ }
  return false;
}

async function safeEditReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(payload);
    } else {
      return await interaction.reply(payload);
    }
  } catch (err) {
    if (isIgnorableDiscordError(err)) {
      console.debug('Ignored Discord error when editing/replying:', err?.code ?? err?.status ?? err?.message);
      return null;
    }
    console.error('Failed to edit/reply interaction:', err);
    return null;
  }
}

async function safeUpdateComponent(interaction, payload) {
  try {
    return await interaction.update(payload);
  } catch (err) {
    if (isIgnorableDiscordError(err)) {
      console.debug('Ignored Discord error when updating component interaction:', err?.code ?? err?.status ?? err?.message);
      return null;
    }
    console.error('Failed to update component interaction:', err);
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate().catch(() => null);
      }
    } catch (e) { /* ignore */ }
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cooldown')
    .setDescription('Show your pull cooldown and remaining pulls.'),
  requireOshi: true,
  async execute(interaction) {
    // try to defer reply; ignore ignorable failures
    try {
      await interaction.deferReply();
    } catch (err) {
      if (!isIgnorableDiscordError(err)) console.error('Failed to defer reply:', err);
    }

    const discordUserId = interaction.user.id;

    // Fetch updated quota
    let res;
    try {
      res = await pullQuota.getUpdatedQuota(discordUserId);
    } catch (err) {
      console.error('pullQuota.getUpdatedQuota error:', err);
      await safeEditReply(interaction, { content: 'Failed to check pull quota. Please try again later.' });
      return;
    }

    const doc = res?.doc ?? null;

    // Prefer explicit helper-provided nextRefillInMs (already relative ms until next token)
    let nextInMs = Number.isFinite(res?.nextRefillInMs) ? Math.max(0, res.nextRefillInMs) : 0;

    // Fallback: if helper didn't provide nextRefillInMs, compute from doc.lastRefill + REFILL_INTERVAL_MS
    if (!nextInMs && doc) {
      try {
        const MAX = pullQuota.MAX_STOCK;
        const INTERVAL = pullQuota.REFILL_INTERVAL_MS;
        const pulls = typeof doc.pulls === 'number' ? doc.pulls : 0;
        if (pulls < MAX) {
          const last = doc.lastRefill ? new Date(doc.lastRefill).getTime() : Date.now();
          const now = Date.now();
          const elapsed = now - last;
          nextInMs = Math.max(0, INTERVAL - elapsed);
        } else {
          nextInMs = 0;
        }
      } catch (e) {
        nextInMs = 0;
      }
    }

    const hasRefillInfo = (res?.nextRefillInMs != null) || (doc?.lastRefill != null) || (doc?.pulls != null);
    const nextRefillText = nextInMs > 0
      ? `<t:${Math.floor((Date.now() + nextInMs) / 1000)}:R>`
      : (hasRefillInfo ? 'Refill available now' : 'Refill scheduled');

    const remainingTimed = doc && typeof doc.pulls === 'number' ? doc.pulls : 0;
    const remainingEvent = doc && typeof doc.eventPulls === 'number' ? doc.eventPulls : 0;

    const embed = new EmbedBuilder()
      .setTitle('Pull cooldown')
      .setColor(nextInMs > 0 ? 0xFFAA22 : 0x22BB66)
      .addFields(
        { name: 'Timed pulls', value: `${remainingTimed}`, inline: true },
        { name: 'Event pulls', value: `${remainingEvent}`, inline: true },
        { name: 'Next timed pull', value: nextRefillText, inline: true }
      );

    await safeEditReply(interaction, { embeds: [embed] });

    // Export safeUpdateComponent for collectors elsewhere if needed:
    // use safeUpdateComponent(btnInteraction, payload) to avoid 10062/404 crashes.
  },
};
