// jobs/bossActivator.js (excerpt)
const { buildOshiOsrImageUrl } = require('../utils/bossUtils');
const BossEvent = require('../models/BossEvent');
const { EmbedBuilder } = require('discord.js');
const DISCORD_ANNOUNCE_CHANNEL_ID = process.env.BOSS_ANNOUNCE_CHANNEL_ID; // set in env

async function announceActivatedEvents(client) {
  const now = new Date();
  // find events that just became active (status scheduled and spawnAt <= now)
  const toActivate = await BossEvent.find({ status: 'scheduled', spawnAt: { $lte: now }, endsAt: { $gt: now } });
  if (!toActivate || toActivate.length === 0) return;

  for (const ev of toActivate) {
    // mark active
    ev.status = 'active';
    await ev.save();

    // get oshi label from config
    const oshis = require('../config/oshis');
    const oshiCfg = oshis.find(o => o.id === ev.oshiId);
    const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;

    // build image URL like OSR <oshiLabel> 001
    const imageUrl = buildOshiOsrImageUrl(oshiLabel, 'OSR');

    // build embed
    const embed = new EmbedBuilder()
      .setTitle(`A Boss has spawned: ${oshiLabel}`)
      .setDescription(`A 24-hour boss event has started for **${oshiLabel}**! Earn fans by liking, subscribing, superchat, and more.`)
      .setColor(0xFF69B4)
      .setImage(imageUrl)
      .addFields(
        { name: 'Ends', value: `<t:${Math.floor(ev.endsAt.getTime() / 1000)}:R>`, inline: true },
        { name: 'Event ID', value: ev.eventId, inline: true }
      );

    // send to announce channel (client is your Discord client)
    try {
      const ch = await client.channels.fetch(DISCORD_ANNOUNCE_CHANNEL_ID);
      if (ch && ch.isTextBased && ch.send) {
        await ch.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error('Failed to announce boss spawn:', err);
    }
  }
}

module.exports = { announceActivatedEvents };
