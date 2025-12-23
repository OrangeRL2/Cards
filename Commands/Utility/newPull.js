// Commands/Utility/pull.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');

const User = require('../../models/User');
const { drawPack } = require('../../utils/newWeightedDraw');
const pullQuota = require('../../utils/pullQuota');

const IMAGE_BASE = 'https://152.69.195.48/images';
const PAGE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const gifs = [
  'https://media.discordapp.net/attachments/1046811248647475302/1437428233086963774/ppp.gif',
  'https://media.discordapp.net/attachments/1046811248647475302/1437428255249535096/ag.gif',
  'https://media.discordapp.net/attachments/1046811248647475302/1437428283217149962/hhw.gif',
  'https://media.discordapp.net/attachments/1046811248647475302/1437428356617338891/Roselia.gif',
  'https://media.discordapp.net/attachments/1046811248647475302/1437428386988556438/MyGO.gif',
  'https://cdn.discordapp.com/attachments/802431770023952406/1438516550628937819/Morf.gif',
  'https://cdn.discordapp.com/attachments/986110973574283265/1446127876339400724/ave_mujica.gif',
  'https://cdn.discordapp.com/attachments/986110973574283265/1441054422401683626/Pasupare.gif',
  'https://cdn.discordapp.com/attachments/802431770023952406/1443593296189456486/ras.gif'
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Consume pulls using pullQuota as the authoritative source.
 * Returns { success, consumedFromEvent, consumedFromTimed, doc, remainingEvent, remainingTimed, nextRefillInMs }
 */
async function consumePulls(discordUserId, amount, allowEvent) {
  if (allowEvent) {
    const { doc } = await pullQuota.getUpdatedQuota(discordUserId);
    if (!doc) {
      return { success: false, consumedFromEvent: 0, consumedFromTimed: 0, doc: null, remainingEvent: 0, remainingTimed: 0, nextRefillInMs: 0 };
    }

    const needed = amount;
    let consumedFromEvent = 0;
    let consumedFromTimed = 0;

    if (doc.eventPulls >= needed) {
      consumedFromEvent = needed;
      doc.eventPulls -= consumedFromEvent;
    } else if (doc.eventPulls > 0) {
      consumedFromEvent = doc.eventPulls;
      doc.eventPulls = 0;
    }

    const remainingNeeded = needed - consumedFromEvent;
    if (remainingNeeded > 0 && doc.pulls > 0) {
      consumedFromTimed = Math.min(doc.pulls, remainingNeeded);
      const wasFullBefore = doc.pulls >= pullQuota.MAX_STOCK;
      doc.pulls = Math.max(0, doc.pulls - consumedFromTimed);
      if (wasFullBefore && consumedFromTimed > 0) doc.lastRefill = new Date();
    }

    await doc.save();

    let nextIn = 0;
    if (doc.pulls < pullQuota.MAX_STOCK) {
      const now = Date.now();
      const lastRefillTs = doc.lastRefill ? new Date(doc.lastRefill).getTime() : now;
      nextIn = Math.max(0, pullQuota.REFILL_INTERVAL_MS - (now - lastRefillTs));
    }

    const success = (consumedFromEvent + consumedFromTimed) === needed;
    return { success, consumedFromEvent, consumedFromTimed, doc, remainingEvent: doc.eventPulls, remainingTimed: doc.pulls, nextRefillInMs: nextIn };
  } else {
    const { doc } = await pullQuota.getUpdatedQuota(discordUserId);
    if (!doc) {
      return { success: false, consumedFromEvent: 0, consumedFromTimed: 0, doc: null, remainingEvent: 0, remainingTimed: 0, nextRefillInMs: 0 };
    }

    if (doc.pulls > 0) {
      const consumedFromTimed = 1;
      const wasFullBefore = doc.pulls >= pullQuota.MAX_STOCK;
      doc.pulls = Math.max(0, doc.pulls - consumedFromTimed);
      if (wasFullBefore) doc.lastRefill = new Date();
      await doc.save();

      let nextIn = 0;
      if (doc.pulls < pullQuota.MAX_STOCK) {
        const now = Date.now();
        const lastRefillTs = doc.lastRefill ? new Date(doc.lastRefill).getTime() : now;
        nextIn = Math.max(0, pullQuota.REFILL_INTERVAL_MS - (now - lastRefillTs));
      }

      return { success: true, consumedFromEvent: 0, consumedFromTimed, doc, remainingEvent: doc.eventPulls, remainingTimed: doc.pulls, nextRefillInMs: nextIn };
    }

    return { success: false, consumedFromEvent: 0, consumedFromTimed: 0, doc, remainingEvent: doc.eventPulls, remainingTimed: doc.pulls, nextRefillInMs: 0 };
  }
}

/* Helpers for name normalization and escaping */
function normalizeForKey(name) {
  return name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function escapeLinkText(text) {
  return text.replace(/([\\_*[\]()~`>#\-=|{}.!])/g, '\\$1');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Spend a single pull to draw one pack of cards.')
    .addBooleanOption(option =>
      option.setName('event')
        .setDescription('Allow using event pulls if timed pulls are insufficient (true or false).')
        .setRequired(false)
    ),
  requireOshi: true,
  async execute(interaction) {
    await interaction.deferReply();

    const DEFAULT_GIF_DURATION_MS = 1200;
    let gifDurationMs = DEFAULT_GIF_DURATION_MS;

    // Show loading GIF
    const gifUrl2 = gifs[Math.floor(Math.random() * gifs.length)];
    let gifShownAt = Date.now();
    try {
      const loadingEmbed = new EmbedBuilder()
        .setTitle('*PULLING...*')
        .setColor(0x00BBFF)
        .setImage(gifUrl2);
      await interaction.editReply({ embeds: [loadingEmbed] });
      gifShownAt = Date.now();
    } catch (err) {
      console.warn('Failed to show loading gif:', err);
      gifShownAt = Date.now();
    }

    const discordUserId = interaction.user.id;
    const amount = 1; // single pull
    const allowEvent = Boolean(interaction.options.getBoolean('event'));

    // Informational quota check
    let quotaDoc;
    try {
      const { doc } = await pullQuota.getUpdatedQuota(discordUserId);
      quotaDoc = doc;
    } catch (err) {
      console.error('quota check error:', err);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < gifDurationMs) await sleep(gifDurationMs - elapsed);
      await interaction.editReply({ content: 'Failed to check pull quota. Please try again later.' });
      return;
    }

    const hasEnoughPulls = !!quotaDoc && (allowEvent ? (quotaDoc.eventPulls + quotaDoc.pulls) >= amount : quotaDoc.pulls >= amount);
    if (!hasEnoughPulls) {
      const nextInMs = quotaDoc ? (quotaDoc.pulls < pullQuota.MAX_STOCK ? Math.max(0, pullQuota.REFILL_INTERVAL_MS - (Date.now() - new Date(quotaDoc.lastRefill || Date.now()).getTime())) : 0) : 0;
      const nextRefillText = nextInMs > 0 ? `<t:${Math.floor((Date.now() + nextInMs) / 1000)}:R>` : 'Refill scheduled';
      const embed = new EmbedBuilder()
        .setTitle('Not enough pulls available')
        .setColor(0xFF5555)
        .addFields(
          { name: 'Timed pulls', value: `${quotaDoc?.pulls || 0}`, inline: true },
          { name: 'Event pulls', value: `${quotaDoc?.eventPulls || 0}`, inline: true },
          { name: 'Next timed pull', value: nextRefillText, inline: true },
        );
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < gifDurationMs) await sleep(gifDurationMs - elapsed);
      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }

    // Draw pack first
    let pack;
    try {
      pack = await drawPack(discordUserId, null); // [{ rarity, file }, ...]
    } catch (err) {
      console.error('drawPack error:', err);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < gifDurationMs) await sleep(gifDurationMs - elapsed);
      await interaction.editReply({ content: 'An error occurred while drawing the pack. Please try again.', components: [] });
      return;
    }

    // Consume pulls (authoritative)
    let consumeResult;
    try {
      consumeResult = await consumePulls(discordUserId, amount, allowEvent);
    } catch (err) {
      console.error('consumePulls error:', err);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < gifDurationMs) await sleep(gifDurationMs - elapsed);
      await interaction.editReply({ content: 'Failed to consume pulls. Please try again later.', components: [] });
      return;
    }

    if (!consumeResult.success) {
      const nextRefillText = consumeResult.nextRefillInMs > 0 ? `<t:${Math.floor((Date.now() + consumeResult.nextRefillInMs) / 1000)}:R>` : 'Refill scheduled';
      const embed = new EmbedBuilder()
        .setTitle('Not enough pulls available')
        .setColor(0xFF5555)
        .addFields(
          { name: 'Timed pulls', value: `${consumeResult.remainingTimed}`, inline: true },
          { name: 'Event pulls', value: `${consumeResult.remainingEvent}`, inline: true },
          { name: 'Next timed pull', value: nextRefillText, inline: true },
        );
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < gifDurationMs) await sleep(gifDurationMs - elapsed);
      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }

    // Persist cards and increment user's pulls once
    const pageItems = [];
    const allNames = [];
    const now = new Date();

    try {
      // Ensure user document exists (upsert minimal doc)
      await User.updateOne({ id: discordUserId }, { $setOnInsert: { id: discordUserId, pulls: 0, cards: [] } }, { upsert: true });

      for (const item of pack) {
        const { rarity, file } = item;
        const base = path.basename(file);
        const ext = path.extname(base);
        const raw = base.slice(0, base.length - ext.length);
        const displayName = raw.replace(/[_-]+/g, ' ').trim();

        // Build a normalized key and a regex for tolerant matching
        const key = normalizeForKey(displayName);
        const nameRegex = new RegExp(`^${escapeRegex(key)}$`, 'i');

        // Try to increment existing array element using a tolerant match on a normalized key
        // We don't have a stored key field, so match against normalized name via regex on cards.name
        const incResult = await User.updateOne(
          { id: discordUserId, "cards.name": { $regex: nameRegex }, "cards.rarity": rarity },
          {
            $inc: { "cards.$.count": 1 },
            $set: { "cards.$.lastAcquiredAt": now }
          }
        );

        // If matched, read back the matched element to get the new count
        let currentCount = 1;
        if (incResult && incResult.matchedCount > 0) {
          const readDoc = await User.findOne(
            { id: discordUserId, "cards.name": { $regex: nameRegex }, "cards.rarity": rarity },
            { "cards.$": 1 }
          ).lean();

          if (readDoc && Array.isArray(readDoc.cards) && readDoc.cards[0]) {
            currentCount = readDoc.cards[0].count || 1;
          } else {
            // Defensive aggregation fallback
            const agg = await User.aggregate([
              { $match: { id: discordUserId } },
              { $unwind: "$cards" },
              { $match: { "cards.rarity": rarity, "cards.name": { $regex: nameRegex } } },
              { $group: { _id: null, totalCount: { $sum: "$cards.count" }, lastAcquiredAt: { $max: "$cards.lastAcquiredAt" } } }
            ]);
            currentCount = (agg.length > 0 && agg[0].totalCount) ? agg[0].totalCount : 1;
          }
        } else {
          // No matched element existed; attempt a guarded push (only push if no matching element exists now)
          await User.updateOne(
            {
              id: discordUserId,
              $nor: [{ cards: { $elemMatch: { name: { $regex: nameRegex }, rarity } } }]
            },
            {
              $push: {
                cards: { name: displayName, rarity, count: 1, firstAcquiredAt: now, lastAcquiredAt: now }
              }
            }
          );

          // Read back authoritative element (handles race where another request pushed first)
          const readDoc = await User.findOne(
            { id: discordUserId, "cards.name": { $regex: nameRegex }, "cards.rarity": rarity },
            { "cards.$": 1 }
          ).lean();

          if (readDoc && Array.isArray(readDoc.cards) && readDoc.cards[0]) {
            currentCount = readDoc.cards[0].count || 1;
          } else {
            // Defensive aggregation if still not found
            const agg = await User.aggregate([
              { $match: { id: discordUserId } },
              { $unwind: "$cards" },
              { $match: { "cards.name": { $regex: nameRegex }, "cards.rarity": rarity } },
              { $group: { _id: null, totalCount: { $sum: "$cards.count" }, lastAcquiredAt: { $max: "$cards.lastAcquiredAt" } } }
            ]);
            currentCount = (agg.length > 0 && agg[0].totalCount) ? agg[0].totalCount : 1;
          }
        }

        const encodedUrl = `${IMAGE_BASE.replace(/\/$/, '')}/${rarity}/${encodeURIComponent(raw)}.png`;
        const visiblePrefix = `[${rarity}] - `;
        const titleBody = `${displayName}`;
        const titleCount = ` - #${currentCount}`;
        const titleLine = `${visiblePrefix}${titleBody}`;

        pageItems.push({ rarity, rawName: raw, displayName, titleLine, imageUrl: encodedUrl });
        allNames.push(`${visiblePrefix}[${escapeLinkText(titleBody)}](${encodedUrl})${titleCount}`);
      }

      // increment user's pulls once (informational)
      await User.updateOne({ id: discordUserId }, { $inc: { pulls: 1 } });
    } catch (err) {
      console.error('atomic update error:', err);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < gifDurationMs) await sleep(gifDurationMs - elapsed);
      await interaction.editReply({ content: 'An error occurred while saving your pull. Please try again.', components: [] });
      return;
    }

    // Build description and truncate safely
    let descriptionAll = allNames.join('\n');
    const MAX_DESC = 4096;
    if (descriptionAll.length > MAX_DESC) {
      const truncated = descriptionAll.slice(0, MAX_DESC - 80);
      const lastNl = truncated.lastIndexOf('\n');
      const visible = lastNl > 0 ? truncated.slice(0, lastNl) : truncated;
      const visibleCount = visible.split('\n').filter(Boolean).length;
      const totalCount = allNames.length;
      const omitted = totalCount - visibleCount;
      descriptionAll = `${visible}\n...and ${omitted} more`;
    }

    const elapsedSinceGif = Date.now() - gifShownAt;
    if (elapsedSinceGif < gifDurationMs) await sleep(gifDurationMs - elapsedSinceGif);

    // If any SEC was pulled, show a special reveal GIF before the result embed
    const hasSEC = pageItems.some(it => String(it.rarity ?? '').toUpperCase() === 'SEC');
    if (hasSEC) {
      const specialGifUrl = 'https://media.discordapp.net/attachments/1046811248647475302/1437428522577821828/Ran_chan_drop_kick.gif';
      try {
        const secEmbed = new EmbedBuilder()
          .setTitle('**!?!?!?!?!?!?!?!?!?!?!?!?**')
          .setColor(0xFFD700)
          .setImage(specialGifUrl);

        await interaction.editReply({ embeds: [secEmbed], components: [] });
        await sleep(gifDurationMs);
      } catch (err) {
        console.warn('failed to show SEC reveal gif:', err);
      }
    }

    // Build embed maker
    function makeEmbed(idx) {
      const it = pageItems[idx];
      return new EmbedBuilder()
        .setTitle(`Card: ${idx + 1} **[${it.rarity}]** - ${it.displayName}`)
        .setDescription(descriptionAll)
        .setColor(0x00BB88)
        .addFields(
          { name: 'Timed pulls remaining', value: `${consumeResult.remainingTimed}`, inline: true },
          { name: 'Event pulls remaining', value: `${consumeResult.remainingEvent}`, inline: true },
        )
        .setImage(it.imageUrl)
        .setURL(it.imageUrl)
        .setFooter({ text: `Card: ${idx + 1} / ${pageItems.length}` });
    }

    // Buttons: create fresh instances for enabled/disabled rows
    const prevBtnEnabled = new ButtonBuilder().setCustomId('prev').setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(pageItems.length <= 1);
    const nextBtnEnabled = new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(pageItems.length <= 1);
    const row = new ActionRowBuilder().addComponents(prevBtnEnabled, nextBtnEnabled);

    const prevBtnDisabled = new ButtonBuilder().setCustomId('prev').setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(true);
    const nextBtnDisabled = new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(true);
    const disableRow = new ActionRowBuilder().addComponents(prevBtnDisabled, nextBtnDisabled);

    const message = await interaction.editReply({ embeds: [makeEmbed(0)], components: [row] });

    if (pageItems.length <= 1) {
      setTimeout(async () => {
        try { await message.edit({ components: [disableRow] }); } catch (e) { /* ignore */ }
      }, Math.min(PAGE_TIMEOUT_MS, 10_000));
      return;
    }

    const collector = message.createMessageComponentCollector({ filter: (i) => i.user.id === discordUserId, time: PAGE_TIMEOUT_MS });
    let pageIndex = 0;

    collector.on('collect', async (btnInt) => {
      try {
        if (btnInt.customId === 'prev') pageIndex = (pageIndex - 1 + pageItems.length) % pageItems.length;
        else if (btnInt.customId === 'next') pageIndex = (pageIndex + 1) % pageItems.length;
        else return await btnInt.reply({ content: 'Unknown action', ephemeral: true });

        await btnInt.update({ embeds: [makeEmbed(pageIndex)], components: [row] });
      } catch (err) {
        console.error('collector interaction error:', err);
      }
    });

    collector.on('end', async () => {
      try { await message.edit({ components: [disableRow] }); } catch (e) { /* ignore */ }
    });
  },
};
