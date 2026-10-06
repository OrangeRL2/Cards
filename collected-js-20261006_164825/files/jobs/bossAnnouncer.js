// jobs/bossAnnouncer.js
const BossEvent = require('../models/BossEvent');
const oshis = require('../config/oshis');
const { buildOshiOsrImageUrl } = require('../utils/bossUtils');
const { EmbedBuilder } = require('discord.js');
const config = require('../config.json');

async function announceActivatedEvents(client) {
  const now = new Date();
  const toActivate = await BossEvent.find({ status: 'scheduled', spawnAt: { $lte: now }, endsAt: { $gt: now } });
  if (!toActivate.length) return;

  for (const ev of toActivate) {
    const oshiCfg = oshis.find(o => o.id === ev.oshiId);
    const oshiLabel = oshiCfg ? oshiCfg.label : ev.oshiId;
    const imageUrl = buildOshiOsrImageUrl(oshiLabel, 'OSR');

    ev.status = 'active';
    ev.imageUrl = imageUrl;
    await ev.save();

    const embed = new EmbedBuilder()
      .setTitle(`Boss spawned: ${oshiLabel}`)
      .setDescription(`A 24-hour boss event has started for **${oshiLabel}**! Earn fans by liking, subscribing, superchat, and more.`)
      .setColor(0xFF69B4)
      .setImage(imageUrl)
      .addFields(
        { name: 'Ends', value: `<t:${Math.floor(ev.endsAt.getTime() / 1000)}:R>`, inline: true },
        { name: 'Event ID', value: ev.eventId, inline: true }
      );

    try {
      const channelId = config.bossChannelId;
      if (!channelId) {
        console.warn('bossChannelId not set in config.json; skipping announcement for', ev.eventId);
        continue;
      }
      const ch = await client.channels.fetch(channelId);
      if (ch && ch.isTextBased && ch.send) {
        await ch.send({ embeds: [embed] });
      } else {
        console.warn('Configured boss channel is not text-based or could not be fetched:', channelId);
      }
    } catch (err) {
      console.error('announceActivatedEvents send error', err);
    }
  }
}

module.exports = { announceActivatedEvents };
