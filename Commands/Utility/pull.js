// Commands/Utility/pull.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');

const User = require('../../models/User');
const pullQuota = require('../../utils/pullQuota');
const { drawPack } = require('../../utils/newWeightedDraw');
const { drawPackBoss } = require('../../utils/drawPackBoss');
const { getBossChannelDrawToken } = require('../../utils/bossPullBias');

const inFlightInteractions = new Map(); // simple in-process idempotency guard
const IMAGE_BASE = 'http://152.69.195.48/images';
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
  function computeNextRefill(doc) {
    if (!doc) return null;
    const now = Date.now();
    if (doc.lastRefill) {
      const lastRefillTs = new Date(doc.lastRefill).getTime();
      const remaining = Math.max(0, pullQuota.REFILL_INTERVAL_MS - (now - lastRefillTs));
      return remaining;
    } else {
      return (doc.pulls >= pullQuota.MAX_STOCK) ? 0 : pullQuota.REFILL_INTERVAL_MS;
    }
  }

  const { doc } = await pullQuota.getUpdatedQuota(discordUserId);
  if (!doc) {
    return {
      success: false,
      consumedFromEvent: 0,
      consumedFromTimed: 0,
      doc: null,
      remainingEvent: 0,
      remainingTimed: 0,
      nextRefillInMs: null
    };
  }

  if (allowEvent) {
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

    await doc.save?.();

    const nextIn = computeNextRefill(doc);
    const success = (consumedFromEvent + consumedFromTimed) === needed;
    return {
      success,
      consumedFromEvent,
      consumedFromTimed,
      doc,
      remainingEvent: doc.eventPulls,
      remainingTimed: doc.pulls,
      nextRefillInMs: nextIn
    };
  } else {
    if (doc.pulls > 0) {
      const consumedFromTimed = 1;
      const wasFullBefore = doc.pulls >= pullQuota.MAX_STOCK;
      doc.pulls = Math.max(0, doc.pulls - consumedFromTimed);
      if (wasFullBefore) doc.lastRefill = new Date();
      await doc.save?.();

      const nextIn = computeNextRefill(doc);
      return {
        success: true,
        consumedFromEvent: 0,
        consumedFromTimed,
        doc,
        remainingEvent: doc.eventPulls,
        remainingTimed: doc.pulls,
        nextRefillInMs: nextIn
      };
    }

    const nextIn = computeNextRefill(doc);
    return {
      success: false,
      consumedFromEvent: 0,
      consumedFromTimed: 0,
      doc,
      remainingEvent: doc.eventPulls,
      remainingTimed: doc.pulls,
      nextRefillInMs: nextIn
    };
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

    if (inFlightInteractions.has(interaction.id)) {
      try { await interaction.editReply({ content: 'This interaction is already being processed. Please wait.' }); } catch (e) { /* ignore */ }
      return;
    }
    inFlightInteractions.set(interaction.id, Date.now());

    // Show loading GIF
    const gifUrl2 = gifs[Math.floor(Math.random() * gifs.length)];
    let gifShownAt = Date.now();
    let loadingEmbed;
    try {
      loadingEmbed = new EmbedBuilder().setTitle('*PULLING...*').setColor(0x00BBFF).setImage(gifUrl2);
      await interaction.editReply({ embeds: [loadingEmbed] });
      gifShownAt = Date.now();
    } catch (err) { gifShownAt = Date.now(); }

    const discordUserId = interaction.user.id;
    const amount = 1;
    const allowEvent = Boolean(interaction.options.getBoolean('event'));

    // AUTHORITATIVE: consume pulls BEFORE drawing pack
    let consumeResult;
    try {
      consumeResult = await consumePulls(discordUserId, amount, allowEvent);
    } catch (err) {
      console.error('consumePulls error (pre-draw):', err);
      inFlightInteractions.delete(interaction.id);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < gifDurationMs) await sleep(gifDurationMs - elapsed);
      await interaction.editReply({ content: 'Failed to consume pulls. Please try again later.', components: [] }).catch(() => null);
      return;
    }

    if (!consumeResult.success) {
      const nextRefillText = (typeof consumeResult.nextRefillInMs === 'number' && consumeResult.nextRefillInMs > 0)
        ? `<t:${Math.floor((Date.now() + consumeResult.nextRefillInMs) / 1000)}:R>`
        : 'Refill scheduled';
      const embed = new EmbedBuilder()
        .setTitle('Not enough pulls available')
        .setColor(0xFF5555)
        .addFields(
          { name: 'Timed pulls', value: `${consumeResult.remainingTimed}`, inline: true },
          { name: 'Event pulls', value: `${consumeResult.remainingEvent}`, inline: true },
          { name: 'Next timed pull', value: nextRefillText, inline: true },
        );
      inFlightInteractions.delete(interaction.id);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < gifDurationMs) await sleep(gifDurationMs - elapsed);
      await interaction.editReply({ embeds: [embed], components: [] }).catch(() => null);
      return;
    }

    // Boss bias check (non-fatal)
    let bossChannelBias = null;
    try {
      bossChannelBias = await getBossChannelDrawToken(interaction);
      if (bossChannelBias && bossChannelBias.biased && bossChannelBias.drawToken && loadingEmbed) {
        try {
          loadingEmbed.setFooter({ text: `The algorithm has found: ${bossChannelBias.drawToken}!` });
          loadingEmbed.setColor(0xFFD700);
          await interaction.editReply({ embeds: [loadingEmbed] }).catch(() => null);
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.warn('[pull] boss-channel bias check failed', e);
      bossChannelBias = { drawToken: null, biased: false };
    }

    // Draw pack: if boss bias present, use drawPackBoss (per-slot 50% bias), otherwise normal drawPack
    let pack;
    try {
      if (bossChannelBias && bossChannelBias.biased && bossChannelBias.drawToken) {
        pack = await drawPackBoss(discordUserId, bossChannelBias.drawToken);
      } else {
        pack = await drawPack(discordUserId, null);
      }
    } catch (err) {
      console.error('drawPack error after consume:', err);
      // Attempt refund
      try {
        const { doc } = await pullQuota.getUpdatedQuota(discordUserId);
        if (doc) {
          const inc = {};
          if (consumeResult.consumedFromEvent) inc.eventPulls = consumeResult.consumedFromEvent;
          if (consumeResult.consumedFromTimed) inc.pulls = consumeResult.consumedFromTimed;
          if (Object.keys(inc).length > 0) {
            await pullQuota._model?.updateOne?.({ id: discordUserId }, { $inc: inc }).catch(() => null);
            if (!pullQuota._model) {
              if (consumeResult.consumedFromEvent) doc.eventPulls = (doc.eventPulls || 0) + consumeResult.consumedFromEvent;
              if (consumeResult.consumedFromTimed) doc.pulls = (doc.pulls || 0) + consumeResult.consumedFromTimed;
              await doc.save?.().catch(() => null);
            }
          }
        }
      } catch (refundErr) {
        console.error('refund error after draw failure:', refundErr);
      }

      inFlightInteractions.delete(interaction.id);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < gifDurationMs) await sleep(gifDurationMs - elapsed);
      await interaction.editReply({ content: 'An error occurred while drawing the pack. Your pull has been refunded. Please try again.', components: [] }).catch(() => null);
      return;
    }

    // Persist cards and increment user's pulls once (informational)
    const pageItems = [];
    const allNames = [];
    const now = new Date();

    try {
      await User.updateOne?.({ id: discordUserId }, { $setOnInsert: { id: discordUserId, pulls: 0, cards: [] } }, { upsert: true });

      for (const item of pack) {
        const { rarity, file } = item;
        const base = path.basename(file);
        const ext = path.extname(base);
        const raw = base.slice(0, base.length - ext.length);
        const displayName = raw.replace(/[_-]+/g, ' ').trim();

        const key = normalizeForKey(displayName);
        const nameRegex = new RegExp(`^${escapeRegex(key)}$`, 'i');

        const incResult = await User.updateOne?.(
          {
            id: discordUserId,
            cards: {
              $elemMatch: {
                name: { $regex: nameRegex },
                rarity: rarity
              }
            }
          },
          {
            $inc: { "cards.$.count": 1 },
            $set: { "cards.$.lastAcquiredAt": now }
          }
        );

        let currentCount = 1;
        if (incResult && incResult.matchedCount > 0) {
          const readDoc = await User.findOne?.(
            {
              id: discordUserId,
              cards: {
                $elemMatch: {
                  name: { $regex: nameRegex },
                  rarity: rarity
                }
              }
            },
            { "cards.$": 1 }
          )?.lean?.();

          if (readDoc && Array.isArray(readDoc.cards) && readDoc.cards[0]) {
            currentCount = readDoc.cards[0].count || 1;
          } else {
            const agg = await User.aggregate?.([
              { $match: { id: discordUserId } },
              { $unwind: "$cards" },
              { $match: { "cards.rarity": rarity, "cards.name": { $regex: nameRegex } } },
              { $group: { _id: null, totalCount: { $sum: "$cards.count" }, lastAcquiredAt: { $max: "$cards.lastAcquiredAt" } } }
            ]);
            currentCount = (agg && agg.length > 0 && agg[0].totalCount) ? agg[0].totalCount : 1;
          }
        } else {
          await User.updateOne?.(
            {
              id: discordUserId,
              $nor: [{
                cards: {
                  $elemMatch: {
                    name: { $regex: nameRegex },
                    rarity: rarity
                  }
                }
              }]
            },
            {
              $push: {
                cards: { name: displayName, rarity, count: 1, firstAcquiredAt: now, lastAcquiredAt: now }
              }
            }
          );

          const readDoc = await User.findOne?.(
            {
              id: discordUserId,
              cards: {
                $elemMatch: {
                  name: { $regex: nameRegex },
                  rarity: rarity
                }
              }
            },
            { "cards.$": 1 }
          )?.lean?.();

          if (readDoc && Array.isArray(readDoc.cards) && readDoc.cards[0]) {
            currentCount = readDoc.cards[0].count || 1;
          } else {
            const agg = await User.aggregate?.([
              { $match: { id: discordUserId } },
              { $unwind: "$cards" },
              { $match: { "cards.name": { $regex: nameRegex }, "cards.rarity": rarity } },
              { $group: { _id: null, totalCount: { $sum: "$cards.count" }, lastAcquiredAt: { $max: "$cards.lastAcquiredAt" } } }
            ]);
            currentCount = (agg && agg.length > 0 && agg[0].totalCount) ? agg[0].totalCount : 1;
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
    } catch (err) {
      console.error('atomic update error after consume:', err);
      // refund attempt
      try {
        const { doc } = await pullQuota.getUpdatedQuota(discordUserId);
        if (doc) {
          const inc = {};
          if (consumeResult.consumedFromEvent) inc.eventPulls = consumeResult.consumedFromEvent;
          if (consumeResult.consumedFromTimed) inc.pulls = consumeResult.consumedFromTimed;
          if (Object.keys(inc).length > 0) {
            await pullQuota._model?.updateOne?.({ id: discordUserId }, { $inc: inc }).catch(() => null);
            if (!pullQuota._model) {
              if (consumeResult.consumedFromEvent) doc.eventPulls = (doc.eventPulls || 0) + consumeResult.consumedFromEvent;
              if (consumeResult.consumedFromTimed) doc.pulls = (doc.pulls || 0) + consumeResult.consumedFromTimed;
              await doc.save?.().catch(() => null);
            }
          }
        }
      } catch (refundErr) {
        console.error('refund error after atomic update failure:', refundErr);
      }

      inFlightInteractions.delete(interaction.id);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < gifDurationMs) await sleep(gifDurationMs - elapsed);
      await interaction.editReply({ content: 'An error occurred while saving your pull. Your pull has been refunded. Please try again.', components: [] }).catch(() => null);
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
        const secEmbed = new EmbedBuilder().setTitle('**!?!?!?!?!?!?!?!?!?!?!?!?**').setColor(0xFFD700).setImage(specialGifUrl);
        await interaction.editReply({ embeds: [secEmbed], components: [] }).catch(() => null);
        await sleep(gifDurationMs);
      } catch (err) { /* ignore */ }
    }

    try { await User.updateOne?.({ id: discordUserId }, { $inc: { pulls: 1 } }); } catch (e) { /* ignore */ }

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
        .setFooter({ text: `Card: ${idx + 1} / ${pageItems.length} | Pull by: ${interaction.user.username}` });
    }

    const prevBtnEnabled = new ButtonBuilder().setCustomId('prev').setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(pageItems.length <= 1);
    const nextBtnEnabled = new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(pageItems.length <= 1);
    const row = new ActionRowBuilder().addComponents(prevBtnEnabled, nextBtnEnabled);

    const prevBtnDisabled = new ButtonBuilder().setCustomId('prev').setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(true);
    const nextBtnDisabled = new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(true);
    const disableRow = new ActionRowBuilder().addComponents(prevBtnDisabled, nextBtnDisabled);

    const message = await interaction.editReply({ embeds: [makeEmbed(0)], components: [row] }).catch(() => null);

    if (!message) {
      inFlightInteractions.delete(interaction.id);
      return;
    }

    if (pageItems.length <= 1) {
      setTimeout(async () => {
        try { await message.edit({ components: [disableRow] }); } catch (e) { /* ignore */ }
      }, Math.min(PAGE_TIMEOUT_MS, 10_000));
      inFlightInteractions.delete(interaction.id);
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
      inFlightInteractions.delete(interaction.id);
    });
  }
};
