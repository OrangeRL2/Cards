// commands/misc/pull.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');

const User = require('../../models/User');
const { drawPack } = require('../../utils/newWeightedDraw');
const pullQuota = require('../../utils/pullQuota');

const IMAGE_BASE = 'http://152.69.195.48/images';
const PAGE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const gifPopipa =     'https://media.discordapp.net/attachments/1046811248647475302/1437428233086963774/ppp.gif';
const gifAfterglow =  'https://media.discordapp.net/attachments/1046811248647475302/1437428255249535096/ag.gif';
const gifHarohapi =   'https://media.discordapp.net/attachments/1046811248647475302/1437428283217149962/hhw.gif';
const gifRoselia =    'https://media.discordapp.net/attachments/1046811248647475302/1437428356617338891/Roselia.gif';
const gifMyGo =       'https://media.discordapp.net/attachments/1046811248647475302/1437428386988556438/MyGO.gif';
const GIF_DURATION_MS = 900;
const gifs = [gifPopipa, gifAfterglow, gifHarohapi, gifRoselia, gifMyGo];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    const amount = 1; // force single pull
    const allowEvent = Boolean(interaction.options.getBoolean('event'));

    // consume exactly 1 pull
    let consumeResult;
    try {
      if (allowEvent) {
        // Use existing logic that prefers timed then event pulls
        consumeResult = await pullQuota.consumePulls(discordUserId, amount);
      } else {
        // Force consume from timed pulls only (no event pulls)
        // We'll reuse getUpdatedQuota to refresh timed pulls first
        const { doc, nextRefillInMs } = await pullQuota.getUpdatedQuota(discordUserId);

        if (!doc) {
          // Shouldn't happen but handle defensively
          consumeResult = {
            success: false,
            consumedFromEvent: 0,
            consumedFromTimed: 0,
            doc,
            remainingEvent: 0,
            remainingTimed: 0,
            nextRefillInMs,
          };
        } else if (doc.pulls > 0) {
          const consumedFromTimed = 1;
          const wasFullBefore = doc.pulls >= pullQuota.MAX_STOCK;
          doc.pulls = Math.max(0, doc.pulls - consumedFromTimed);
          if (wasFullBefore) {
            // start refill timer now if we removed from a full pool
            doc.lastRefill = new Date();
          }
          await doc.save();

          // Recompute nextRefillInMs after mutation
          let nextIn = 0;
          if (doc.pulls < pullQuota.MAX_STOCK) {
            const now = Date.now();
            const lastRefillTs = doc.lastRefill ? new Date(doc.lastRefill).getTime() : now;
            nextIn = Math.max(0, pullQuota.REFILL_INTERVAL_MS - (now - lastRefillTs));
          }

          consumeResult = {
            success: true,
            consumedFromEvent: 0,
            consumedFromTimed,
            doc,
            remainingEvent: doc.eventPulls,
            remainingTimed: doc.pulls,
            nextRefillInMs: nextIn,
          };
        } else {
          // No timed pulls available and event usage disallowed -> fail
          consumeResult = {
            success: false,
            consumedFromEvent: 0,
            consumedFromTimed: 0,
            doc,
            remainingEvent: doc.eventPulls,
            remainingTimed: doc.pulls,
            nextRefillInMs,
          };
        }
      }
    } catch (err) {
      console.error('consumePulls error:', err);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < GIF_DURATION_MS) await sleep(GIF_DURATION_MS - elapsed);
      await interaction.editReply({ content: 'Failed to check pull quota. Please try again later.' });
      return;
    }

    if (!consumeResult.success) {
      const nextInMs = consumeResult.nextRefillInMs ?? 0;
      const nextRefillText = nextInMs > 0 ? `<t:${Math.floor((Date.now() + nextInMs) / 1000)}:R>` : 'Refill scheduled';
      const embed = new EmbedBuilder()
        .setTitle('Not enough pulls available')
        .setColor(0xFF5555)
        .addFields(
          { name: 'Timed pulls', value: `${consumeResult.remainingTimed}`, inline: true },
          { name: 'Event pulls', value: `${consumeResult.remainingEvent}`, inline: true },
          { name: 'Next timed pull', value: nextRefillText, inline: true },
        );
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < GIF_DURATION_MS) await sleep(GIF_DURATION_MS - elapsed);
      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }

    const consumedTimed = consumeResult.consumedFromTimed || 0;
    const consumedEvent = consumeResult.consumedFromEvent || 0;

    // Draw exactly one pack
    let pack;
    try {
      pack = drawPack(); // [{ rarity, file }, ...]
    } catch (err) {
      console.error('drawPack error:', err);
      // rollback
      try {
        if (consumedEvent > 0) await pullQuota.addEventPulls(discordUserId, consumedEvent);
        if (consumedTimed > 0) {
          const { doc } = await pullQuota.getUpdatedQuota(discordUserId);
          doc.pulls = Math.min(pullQuota.MAX_STOCK, doc.pulls + consumedTimed);
          await doc.save();
        }
      } catch (rbErr) {
        console.warn('rollback failed:', rbErr);
      }
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < GIF_DURATION_MS) await sleep(GIF_DURATION_MS - elapsed);
      await interaction.editReply({ content: 'An error occurred while drawing the pack. Your pull has been refunded (if possible).', components: [] });
      return;
    }

    // Ensure user document exists
    let userDoc = await User.findOne({ id: discordUserId }).exec();
    if (!userDoc) userDoc = await User.create({ id: discordUserId });

    // Prepare items
    const pageItems = [];
    const allNames = [];
    for (const item of pack) {
      const { rarity, file } = item;
      const base = path.basename(file);
      const ext = path.extname(base);
      const raw = base.slice(0, base.length - ext.length);
      const displayName = raw.replace(/[_-]+/g, ' ').trim();

      let card = userDoc.cards.find(c => c.name === displayName && c.rarity === rarity);
      if (!card) {
        card = { name: displayName, rarity, count: 1, timestamps: [new Date()] };
        userDoc.cards.push(card);
      } else {
        card.count = (card.count || 0) + 1;
        card.timestamps = card.timestamps || [];
        card.timestamps.push(new Date());
      }

      const encodedUrl = encodeURI(`${IMAGE_BASE}/${rarity}/${raw}.png`);
      const titleLine = `**[${rarity}]** - ${displayName} - #${card.count}`;

      pageItems.push({
        rarity,
        rawName: raw,
        displayName,
        titleLine,
        imageUrl: encodedUrl,
      });

      allNames.push(`${titleLine}`);
    }

    userDoc.pulls = (userDoc.pulls || 0) + 1;
    await userDoc.save();

    const descriptionAll = `${allNames.join('\n')}`;

    // Embed maker
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

    const prevBtn = new ButtonBuilder().setCustomId('prev').setLabel('◀ Prev').setStyle(ButtonStyle.Primary);
    const nextBtn = new ButtonBuilder().setCustomId('next').setLabel('Next ▶').setStyle(ButtonStyle.Primary);
    const disableRow = new ActionRowBuilder().addComponents(
      prevBtn.setDisabled(true),
      nextBtn.setDisabled(true)
    );

    const row = new ActionRowBuilder().addComponents(
      prevBtn.setDisabled(pageItems.length <= 1),
      nextBtn.setDisabled(pageItems.length <= 1)
    );

    const elapsed2 = Date.now() - gifShownAt;
    if (elapsed2 < GIF_DURATION_MS) {
      await sleep(GIF_DURATION_MS - elapsed2);
    }

    const message = await interaction.editReply({
      embeds: [makeEmbed(0)],
      components: [row],
    });

    if (pageItems.length <= 1) {
      setTimeout(async () => {
        try { await message.edit({ components: [disableRow] }); } catch (e) { /* ignore */ }
      }, Math.min(PAGE_TIMEOUT_MS, 10_000));
      return;
    }

    const collector = message.createMessageComponentCollector({
      filter: (i) => i.user.id === discordUserId,
      time: PAGE_TIMEOUT_MS,
    });

    let pageIndex = 0;
    collector.on('collect', async (btnInt) => {
      try {
        if (btnInt.customId === 'prev') {
          pageIndex = (pageIndex - 1 + pageItems.length) % pageItems.length;
        } else if (btnInt.customId === 'next') {
          pageIndex = (pageIndex + 1) % pageItems.length;
        } else {
          return await btnInt.reply({ content: 'Unknown action', ephemeral: true });
        }

        await btnInt.update({
          embeds: [makeEmbed(pageIndex)],
          components: [row],
        });
      } catch (err) {
        console.error('collector interaction error:', err);
      }
    });

    collector.on('end', async () => {
      try { await message.edit({ components: [disableRow] }); } catch (e) { /* ignore */ }
    });
  },
};