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
const gifMorfonica =  'https://cdn.discordapp.com/attachments/802431770023952406/1438516550628937819/Morf.gif';
let GIF_DURATION_MS = 1200;
const gifs = [gifPopipa, gifAfterglow, gifHarohapi, gifRoselia, gifMyGo, gifMorfonica];

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
    // We'll capture whether the user was on their last timed pull BEFORE we mutate quota
    let wasLastTimedPullBefore = false;

    try {
      if (allowEvent) {
        // Deterministic consumption: use event pulls first, then timed pulls
        const { doc, nextRefillInMs } = await pullQuota.getUpdatedQuota(discordUserId);

        // capture pre-mutation timed-pull state
        wasLastTimedPullBefore = !!(doc && typeof doc.pulls === 'number' && doc.pulls === 1);

        if (!doc) {
          consumeResult = {
            success: false,
            consumedFromEvent: 0,
            consumedFromTimed: 0,
            doc,
            remainingEvent: 0,
            remainingTimed: 0,
            nextRefillInMs,
          };
        } else {
          const needed = amount; // currently 1
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

          consumeResult = {
            success,
            consumedFromEvent,
            consumedFromTimed,
            doc,
            remainingEvent: doc.eventPulls,
            remainingTimed: doc.pulls,
            nextRefillInMs: nextIn,
          };
        }
      } else {
        // existing timed-only branch (unchanged except we capture pre-mutation state)
        const { doc, nextRefillInMs } = await pullQuota.getUpdatedQuota(discordUserId);

        // capture pre-mutation timed-pull state
        wasLastTimedPullBefore = !!(doc && typeof doc.pulls === 'number' && doc.pulls === 1);

        if (!doc) {
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
      // pass in the pre-consumption boolean so drawPack knows if this was the last timed pull BEFORE we mutated the quota
      pack = await drawPack(discordUserId, null); // [{ rarity, file }, ...]
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

    // --- NEW: atomic user updates to avoid VersionError and document contention ---
    // We'll upsert the user, increment pulls, and then for each card either increment the existing array element or push a new one.
    // After updates, we re-fetch a fresh user doc (lean) to build pageItems and counts.

    // Ensure user document exists and increment pulls atomically
    try {
      // Upsert user with incremented pulls
      await User.updateOne(
        { id: discordUserId },
        { $inc: { pulls: 1 }, $setOnInsert: { id: discordUserId } },
        { upsert: true }
      ).exec();
    } catch (err) {
      console.error('user upsert/pull increment failed:', err);
      // Attempt to rollback quota consumption if possible
      try {
        if (consumedEvent > 0) await pullQuota.addEventPulls(discordUserId, consumedEvent);
        if (consumedTimed > 0) {
          const { doc } = await pullQuota.getUpdatedQuota(discordUserId);
          doc.pulls = Math.min(pullQuota.MAX_STOCK, doc.pulls + consumedTimed);
          await doc.save();
        }
      } catch (rbErr) {
        console.warn('rollback failed after user upsert failure:', rbErr);
      }
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < GIF_DURATION_MS) await sleep(GIF_DURATION_MS - elapsed);
      await interaction.editReply({ content: 'Failed to persist your pull. Your pull may have been refunded (if possible).', components: [] });
      return;
    }

    // For each card in pack, atomically increment or add
    try {
      for (const item of pack) {
        const { rarity, file } = item;
        const base = path.basename(file);
        const ext = path.extname(base);
        const raw = base.slice(0, base.length - ext.length);
        const displayName = raw.replace(/[_-]+/g, ' ').trim();

        // Try to increment existing card entry
        const incResult = await User.updateOne(
          { id: discordUserId, 'cards.name': displayName, 'cards.rarity': rarity },
          {
            $inc: { 'cards.$.count': 1 },
            $push: { 'cards.$.timestamps': new Date() }
          }
        ).exec();

        // If no matching card element existed, push a new one
        if (!incResult.matchedCount || incResult.matchedCount === 0) {
          try {
            await User.updateOne(
              { id: discordUserId },
              {
                $push: {
                  cards: {
                    name: displayName,
                    rarity,
                    count: 1,
                    timestamps: [new Date()]
                  }
                }
              }
            ).exec();
          } catch (pushErr) {
            // Rare race: another concurrent process may have created the card element between the two updates.
            // Try to increment again as a fallback.
            try {
              await User.updateOne(
                { id: discordUserId, 'cards.name': displayName, 'cards.rarity': rarity },
                {
                  $inc: { 'cards.$.count': 1 },
                  $push: { 'cards.$.timestamps': new Date() }
                }
              ).exec();
            } catch (finalErr) {
              console.warn('Failed to add or increment card for user', discordUserId, displayName, finalErr);
            }
          }
        }
      }
    } catch (err) {
      console.error('card atomic updates failed:', err);
      // best-effort rollback of quota (don't attempt to revert partial card writes)
      try {
        if (consumedEvent > 0) await pullQuota.addEventPulls(discordUserId, consumedEvent);
        if (consumedTimed > 0) {
          const { doc } = await pullQuota.getUpdatedQuota(discordUserId);
          doc.pulls = Math.min(pullQuota.MAX_STOCK, doc.pulls + consumedTimed);
          await doc.save();
        }
      } catch (rbErr) {
        console.warn('rollback failed after card update error:', rbErr);
      }
      const elapsed = Date.now() - gifShownAt;
      if (elapsed < GIF_DURATION_MS) await sleep(GIF_DURATION_MS - elapsed);
      await interaction.editReply({ content: 'Failed to persist your card results. Your pull may have been refunded (if possible).', components: [] });
      return;
    }

    // Re-fetch fresh user doc for display (lean to avoid mongoose document versioning in memory)
    let userDocFresh;
    try {
      userDocFresh = await User.findOne({ id: discordUserId }).lean().exec();
      if (!userDocFresh) {
        // Unexpected: create minimal view to continue
        userDocFresh = { id: discordUserId, cards: [], pulls: 0 };
      }
    } catch (err) {
      console.error('failed to load fresh user doc for display:', err);
      userDocFresh = { id: discordUserId, cards: [], pulls: 0 };
    }

    // --- post-draw processing (adjusted to use fresh doc) ---
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

      // find the updated card entry in userDocFresh to get current count
      const cardEntry = (userDocFresh.cards || []).find(c => c.name === displayName && c.rarity === rarity);
      const cardCount = (cardEntry && typeof cardEntry.count === 'number') ? cardEntry.count : 1;

      // encode only the filename segment; normalize IMAGE_BASE trailing slash
      const encodedUrl = `${IMAGE_BASE.replace(/\/$/,'')}/${rarity}/${encodeURIComponent(raw)}.png`;

      // Use normal ASCII brackets as plain text; make only "Name - #N" the clickable link
      const visiblePrefix = `${prettyRarityPlain(rarity)} - `;
      const titleBody = `${displayName}`; // link text (escaped)
      const titleCount = ` - #${cardCount}`; // link text (escaped)
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

        // show the special GIF (replace current reply contents)
        await interaction.editReply({ embeds: [secEmbed], components: [] });

        // ensure the GIF is visible long enough
        await sleep(GIF_DURATION_MS);
      } catch (err) {
        console.warn('failed to show SEC reveal gif:', err);
      }
    }

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
