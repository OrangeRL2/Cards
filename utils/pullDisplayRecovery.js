'use strict';

// Display-only rescue path. It never reruns draws, quotas, or card writes.
function logError(tag, stage, error, interaction) {
  console.error(`[${tag}-display] ${stage} failed`, {
    interactionId: interaction?.id || null,
    userId: interaction?.user?.id || null,
    channelId: interaction?.channelId || interaction?.channel?.id || null,
    code: error?.code || error?.rawError?.code || null,
    status: error?.status || null,
    message: error?.message || String(error),
  });
}

async function showSavedPull(interaction, imagePayload, textPayload, tag = 'pull') {
  try {
    const message = await interaction.editReply(imagePayload);
    if (!message) throw new Error('editReply did not return a message');
    console.log(`[${tag}-display] result shown: message=${message.id || 'unknown'} interaction=${interaction.id || 'unknown'}`);
    return { message, image: true };
  } catch (error) {
    logError(tag, 'image edit', error, interaction);
  }

  try {
    const message = await interaction.editReply(textPayload);
    if (!message) throw new Error('Text fallback did not return a message');
    console.log(`[${tag}-display] text fallback shown: message=${message.id || 'unknown'}`);
    return { message, image: false };
  } catch (error) {
    logError(tag, 'text edit', error, interaction);
  }

  // Message#edit uses the channel's message endpoint rather than the
  // interaction/webhook endpoint. It may still work if the latter fails.
  if (typeof interaction.fetchReply === 'function') {
    try {
      const original = await interaction.fetchReply();
      if (original?.edit) {
        const message = await original.edit(textPayload);
        console.log(`[${tag}-display] original message recovered: message=${message.id || 'unknown'}`);
        return { message, image: false };
      }
    } catch (error) {
      logError(tag, 'direct message edit', error, interaction);
    }
  }

  // Last resort: players must see their saved cards even if the loading
  // message is no longer editable. Never re-grant the inventory here.
  if (typeof interaction?.channel?.send !== 'function') {
    throw new Error('Cannot recover saved pull: channel.send unavailable');
  }
  let message;
  try {
    message = await interaction.channel.send({
      ...textPayload,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logError(tag, 'separate result message', error, interaction);
    throw error;
  }
  console.warn(`[${tag}-display] result posted separately: message=${message.id || 'unknown'} interaction=${interaction.id || 'unknown'}`);
  try {
    if (typeof interaction.deleteReply === 'function') {
      await interaction.deleteReply();
    } else {
      await interaction.editReply({
        content: 'Results posted in the message below.',
        embeds: [], attachments: [], components: [],
      });
    }
  } catch (error) {
    logError(tag, 'loading message cleanup', error, interaction);
  }
  return { message, image: false, separate: true };
}

module.exports = { showSavedPull };
