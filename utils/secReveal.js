'use strict';

const { EmbedBuilder } = require('discord.js');

// Keep the rare SEC animation while guaranteeing a readable result handoff
// before the potentially slow card-artwork upload. This never writes rewards.
async function showSecReveal(interaction, hasSEC, textPayload, delayMs = 1200, tag = 'pull') {
  if (!hasSEC) return;
  //const gifUrl = 'https://media.discordapp.net/attachments/1046811248647475302/1437428522577821828/Ran_chan_drop_kick.gif';
  const gifUrl = 'https://media.discordapp.net/attachments/1532321010093785178/1563165827425894421/sorascary.gif';
  try {
    await interaction.editReply({
      content: null,
      embeds: [new EmbedBuilder()
        .setTitle('**!?!?!?!?!?!?!?!?!?!?!?!?**')
        .setColor(0xFFD700)
        .setImage(gifUrl)],
      attachments: [],
      components: [],
    });
  } catch (err) {
    console.warn(`[${tag}] SEC animation edit failed:`, err);
  }

  if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));

  // Do not leave the animation as the last visible state while a local
  // image gets processed and uploaded to Discord. Give players their saved
  // card results first; the caller subsequently upgrades to the artwork.
  try {
    await interaction.editReply(textPayload);
  } catch (err) {
    console.error(`[${tag}] SEC result handoff failed:`, err);
  }
}

module.exports = { showSecReveal };
