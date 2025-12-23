// Commands/Utility/pull.js
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
const gifMorfonica =       'https://cdn.discordapp.com/attachments/802431770023952406/1438516550628937819/Morf.gif';
const gifMujica =       'https://cdn.discordapp.com/attachments/986110973574283265/1446127876339400724/ave_mujica.gif';
const gifPasupare =   'https://cdn.discordapp.com/attachments/986110973574283265/1441054422401683626/Pasupare.gif';
const gifRAS =       'https://cdn.discordapp.com/attachments/802431770023952406/1443593296189456486/ras.gif';
let GIF_DURATION_MS = 1200;
const gifs = [gifPopipa, gifAfterglow, gifHarohapi, gifRoselia, gifMyGo, gifMorfonica, gifMujica, gifPasupare, gifRAS];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to consume pulls (extracted for reuse)
async function consumePulls(discordUserId, amount, allowEvent) {
  if (allowEvent) {
    // Deterministic consumption: use event pulls first, then timed pulls
    const { doc, nextRefillInMs } = await pullQuota.getUpdatedQuota(discordUserId);

    if (!doc) {
      return {
        success: false,
        consumedFromEvent: 0,
        consumedFromTimed: 0,
        doc,
        remainingEvent: 0,
        remainingTimed: 0,
        nextRefillInMs,
      };
    }

    const needed = amount;
    let consumedFromEvent = 0;
    let consumedFromTimed = 0;

    // use event pulls first
    if (doc.eventPulls >= needed) {
      consumedFromEvent = needed;
      doc.eventPulls -= consumedFromEvent;
    } else if (doc.eventPulls > 0) {
      consumedFromEvent = doc.eventPulls;
      doc.eventPulls = 0;
    }

    const remainingNeeded = needed - consumedFromEvent;

    if (remainingNeeded > 0 && doc.pulls > 0) {
      // consume from timed pulls for the rest
      consumedFromTimed = Math.min(doc.pulls, remainingNeeded);
      const wasFullBefore = doc.pulls >= pullQuota.MAX_STOCK;
      doc.pulls = Math.max(0, doc.pulls - consumedFromTimed);
      if (wasFullBefore && consumedFromTimed > 0) {
        // start refill timer now if we removed from a full pool
        doc.lastRefill = new Date();
      }
    }

    await doc.save();

    // recompute nextRefillInMs after mutation
    let nextIn = 0;
    if (doc.pulls < pullQuota.MAX_STOCK) {
      const now = Date.now();
      const lastRefillTs = doc.lastRefill ? new Date(doc.lastRefill).getTime() : now;
      nextIn = Math.max(0, pullQuota.REFILL_INTERVAL_MS - (now - lastRefillTs));
    }

    const success = (consumedFromEvent + consumedFromTimed) === needed;

    return {
      success,
      consumedFromEvent,
      consumedFromTimed,
      doc,
      remainingEvent: doc.eventPulls,
      remainingTimed: doc.pulls,
      nextRefillInMs: nextIn,
    };
  } else {
    // timed-only branch
    const { doc, nextRefillInMs } = await pullQuota.getUpdatedQuota(discordUserId);

    if (!doc) {
      return {
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

      return {
        success: true,
        consumedFromEvent: 0,
        consumedFromTimed,
        doc,
        remainingEvent: doc.eventPulls,
        remainingTimed: doc.pulls,
        nextRefillInMs: nextIn,
      };
    } else {
      return {
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

    // FIRST: Check if user has enough pulls without consuming them
    let hasEnoughPulls = false;
    let quotaCheck;
    try {
      const { doc } = await pullQuota.getUpdatedQuota(discordUserId);
      if (!doc) {
        hasEnoughPulls = false;
      } else if (allowEvent) {
        hasEnoughPulls = (doc.eventPulls + doc.pulls) >= amount;
      } else {
        hasEnoughPulls = doc.pulls >= amount;
      }
      quotaCheck = doc;
    } catch (err) {
      console.error('quota check error:', err);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < GIF_DURATION_MS) await sleep(GIF_DURATION_MS - elapsed);
      await interaction.editReply({ content: 'Failed to check pull quota. Please try again later.' });
      return;
    }

    if (!hasEnoughPulls) {
      const nextInMs = quotaCheck ? (quotaCheck.pulls < pullQuota.MAX_STOCK ? 
        Math.max(0, pullQuota.REFILL_INTERVAL_MS - (Date.now() - new Date(quotaCheck.lastRefill).getTime())) : 0) : 0;
      const nextRefillText = nextInMs > 0 ? `<t:${Math.floor((Date.now() + nextInMs) / 1000)}:R>` : 'Refill scheduled';
      const embed = new EmbedBuilder()
        .setTitle('Not enough pulls available')
        .setColor(0xFF5555)
        .addFields(
          { name: 'Timed pulls', value: `${quotaCheck?.pulls || 0}`, inline: true },
          { name: 'Event pulls', value: `${quotaCheck?.eventPulls || 0}`, inline: true },
          { name: 'Next timed pull', value: nextRefillText, inline: true },
        );
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < GIF_DURATION_MS) await sleep(GIF_DURATION_MS - elapsed);
      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }

    // Draw the pack FIRST (before consuming pulls)
    let pack;
    try {
      pack = await drawPack(discordUserId, null); // [{ rarity, file }, ...]
    } catch (err) {
      console.error('drawPack error:', err);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < GIF_DURATION_MS) await sleep(GIF_DURATION_MS - elapsed);
      await interaction.editReply({ content: 'An error occurred while drawing the pack. Please try again.', components: [] });
      return;
    }

  
    // Ensure user document exists and add cards
    let userDoc = await User.findOne({ id: discordUserId }).exec();
    if (!userDoc) userDoc = await User.create({ id: discordUserId });

    // helper: escape ] and ) which break Markdown link syntax
    function escapeLinkText(text) {
      return text.replace(/([\\_*[\]()~`>#\-=|{}.!])/g, '\\$1');
    }
    function prettyRarityPlain(r) { return `[${r}]`; }
    const pageItems = [];
    const allNames = [];

    for (const item of pack) {
      const { rarity, file } = item;
      const base = path.basename(file);
      const ext = path.extname(base);
      const raw = base.slice(0, base.length - ext.length);
      const displayName = raw.replace(/[_-]+/g, ' ').trim();

      // ensure cards array exists defensively
      userDoc.cards = userDoc.cards || [];
      let card = userDoc.cards.find(c => c.name === displayName && c.rarity === rarity);
      if (!card) {
        card = { name: displayName, rarity, count: 1, timestamps: [new Date()] };
        userDoc.cards.push(card);
      } else {
        card.count = (card.count || 0) + 1;
        card.timestamps = card.timestamps || [];
        card.timestamps.push(new Date());
      }

      // encode only the filename segment; normalize IMAGE_BASE trailing slash
      const encodedUrl = `${IMAGE_BASE.replace(/\/$/,'')}/${rarity}/${encodeURIComponent(raw)}.png`;

      // Use normal ASCII brackets as plain text; make only "Name - #N" the clickable link
      const visiblePrefix = `${prettyRarityPlain(rarity)} - `;
      const titleBody = `${displayName}`; // link text (escaped)
      const titleCount = ` - #${card.count}`; // link text (escaped)
      const titleLine = `${visiblePrefix}${titleBody}`; // for other uses (pageItems, logs)

      pageItems.push({
        rarity,
        rawName: raw,
        displayName,
        titleLine,
        imageUrl: encodedUrl,
      });

      // single push to allNames: prefix (plain) + clickable link (escaped)
      allNames.push(`${visiblePrefix}[${escapeLinkText(titleBody)}](${encodedUrl})${titleCount}`);
    }

    // increment and persist user pulls
    userDoc.pulls = (userDoc.pulls || 0) + 1;
    await userDoc.save();

    // join and safely truncate description
    let descriptionAll = allNames.join('\n');
    const MAX_DESC = 4096;
    if (descriptionAll.length > MAX_DESC) {
      // keep full lines, then indicate how many were omitted
      const truncated = descriptionAll.slice(0, MAX_DESC - 80); // leave room for suffix
      const lastNl = truncated.lastIndexOf('\n');
      const visible = lastNl > 0 ? truncated.slice(0, lastNl) : truncated;
      const visibleCount = visible.split('\n').filter(Boolean).length;
      const totalCount = allNames.length;
      const omitted = totalCount - visibleCount;
      descriptionAll = `${visible}\n...and ${omitted} more`;
    }

    const elapsedSinceGif = Date.now() - gifShownAt;
    if (elapsedSinceGif < GIF_DURATION_MS) {
      await sleep(GIF_DURATION_MS - elapsedSinceGif);
    }

    // If any SEC was pulled, show a special reveal GIF before the result embed
    const hasSEC = pageItems.some(it => String(it.rarity ?? '').toUpperCase() === 'SEC');
    if (hasSEC) {
      GIF_DURATION_MS = 1200;
      const specialGifUrl = 'https://media.discordapp.net/attachments/1046811248647475302/1437428522577821828/Ran_chan_drop_kick.gif?ex=691680e1&is=69152f61&hm=e4f0afaf8c0fdf11d05a0c0eedb8198fd8b16809fe3414a4e4ed9dc4302118be&=';
      try {
        const secEmbed = new EmbedBuilder()
          .setTitle('**!?!?!?!?!?!?!?!?!?!?!?!?**')
          .setColor(0xFFD700)
          .setImage(specialGifUrl);

        await interaction.editReply({ embeds: [secEmbed], components: [] });
        await sleep(GIF_DURATION_MS);
      } catch (err) {
        console.warn('failed to show SEC reveal gif:', err);
      }
    }
     // NOW consume pulls only after we know the drawing succeeded
    let consumeResult;
    try {
      consumeResult = await consumePulls(discordUserId, amount, allowEvent);
    } catch (err) {
      console.error('consumePulls error:', err);
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < GIF_DURATION_MS) await sleep(GIF_DURATION_MS - elapsed);
      await interaction.editReply({ content: 'Failed to consume pulls. Please try again later.', components: [] });
      return;
    }

    if (!consumeResult.success) {
      // This should rarely happen since we checked above, but handle it just in case
      const nextRefillText = consumeResult.nextRefillInMs > 0 ? 
        `<t:${Math.floor((Date.now() + consumeResult.nextRefillInMs) / 1000)}:R>` : 'Refill scheduled';
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
    // Rest of the code remains the same...
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