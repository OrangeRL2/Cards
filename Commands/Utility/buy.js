// commands/Utility/shop.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  Colors,
} = require('discord.js');
const mongoose = require('mongoose');

const User = require('../../models/User');
const SHOP_ITEMS = require('../../config/shop-items');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const COST_TIERS = [
  { id: 'all', label: 'All Cards', min: -Infinity, max: Infinity },
  { id: 'tier1', label: 'Cheapies', min: 0, max: 1000 },
  { id: 'tier2', label: 'Expensives', min: 1001, max: 5000 },
  { id: 'tier3', label: 'Expensiver', min: 5001, max: 10000 },
  { id: 'tier4', label: 'Super Expensive', min: 10001, max: Infinity },
];

const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';
const ITEMS_PER_PAGE = 5;
const IDLE_LIMIT = 120_000; // 2 minutes
const gifPopipa = 'https://media.discordapp.net/attachments/1438508130165067818/1445661642158374972/tazuna-hayakawa-tazunahayakawa.gif?ex=693128d2&is=692fd752&hm=3dbd79e0a19920088c556e30521108255ac86bb12fe00a9ec9529c0ae51c614d&=';
let GIF_DURATION_MS = 2250;
const gifs = [gifPopipa];

function escapeMarkdown(str = '') {
  return String(str).replace(/([\\_*[\]()~`>#\-=|{}.!])/g, '\\$1');
}
function buildImageUrl(rarity, imageFilename) {
  return `${IMAGE_BASE.replace(/\/$/, '')}/${encodeURIComponent(rarity)}/${encodeURIComponent(imageFilename)}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('For the fans. By the fans.'),
  requireOshi: true,

  async execute(interaction) {
    await interaction.deferReply();
    // Show loading GIF
    const gifUrl2 = gifs[Math.floor(Math.random() * gifs.length)];
    try {
      const loadingEmbed = new EmbedBuilder()
        .setTitle('*ENTERING SHOP...*')
        .setColor(0x00BBFF)
        .setImage(gifUrl2);

      await interaction.editReply({ embeds: [loadingEmbed] });
    } catch (err) {
      console.warn('Failed to show loading gif:', err);
    }
    await sleep(GIF_DURATION_MS);

    try {
      const filterR = interaction.options.getString('rarity');

      // Convert SHOP_ITEMS object to array of { id, ... }
      let allItems = Object.entries(SHOP_ITEMS)
        .map(([id, it]) => ({
          id,
          name: it.name,
          rarity: it.rarity,
          cost: Number(it.cost || 0),
          image: it.image,
          stock: typeof it.stock === 'number' ? it.stock : -1,
        }))
        .filter(it => !filterR || it.rarity === filterR);

      if (allItems.length === 0) {
        return interaction.editReply({ content: 'No shop items available for that filter.', ephemeral: true });
      }

      // Stable ordering
      /*allItems.sort((a, b) => {
        if (a.rarity === b.rarity) return a.name.localeCompare(b.name);
        return a.rarity.localeCompare(b.rarity);
      });*/

      // state for active tier
      let activeTier = 'all';

      // helper: filter by tier id
      function itemsForTier(tierId) {
        if (!tierId || tierId === 'all') return allItems.slice();
        const tier = COST_TIERS.find(t => t.id === tierId);
        if (!tier) return allItems.slice();
        return allItems.filter(it => it.cost >= tier.min && it.cost <= tier.max);
      }

      // Paginate helper
      function paginate(items) {
        const pages = [];
        for (let i = 0; i < items.length; i += ITEMS_PER_PAGE) pages.push(items.slice(i, i + ITEMS_PER_PAGE));
        return pages;
      }

      // Unique uid for this interaction
      const uid = `${interaction.id}_${Date.now()}`;

      // Build UI (embeds + rows) from a given items array
      function buildUi(items) {
        const pages = paginate(items);
        const totalPages = Math.max(1, pages.length);

        const listEmbeds = pages.map((chunk, pageIdx) => {
          const description = chunk.map((it, idx) => {
            const globalIndex = pageIdx * ITEMS_PER_PAGE + idx + 1;
            const stockText = it.stock === -1 ? '∞' : String(it.stock);
            if (it.stock === -1) {
              return `**${globalIndex}. [${it.rarity}] ${it.image}** ${escapeMarkdown(it.name)} \n**Cost:** ${it.cost} Fans`;
            } else {
              return `**${globalIndex}. [${it.rarity}] ${it.image}** ${escapeMarkdown(it.name)} \n**Cost:** ${it.cost} Fans - Stock: ${stockText}`;
            }
          }).join('\n');

          return new EmbedBuilder()
            .setTitle('Fan Shop')
            .setDescription(description || 'No items in this tier.')
            .setColor(Colors.Blurple)
            .setFooter({ text: `Page ${pageIdx + 1}/${totalPages} - Filter: ${COST_TIERS.find(t => t.id === activeTier)?.label || 'All Cards'}` });
        });

        const listRows = pages.map((chunk, pageIdx) => {
          const prev = new ButtonBuilder().setCustomId(`shop_list_prev_${pageIdx}_${uid}`).setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(false);
          const view = new ButtonBuilder().setCustomId(`shop_list_view_${pageIdx}_${uid}`).setLabel('🃏 Image').setStyle(ButtonStyle.Success);
          const next = new ButtonBuilder().setCustomId(`shop_list_next_${pageIdx}_${uid}`).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(false);
          const buy = new ButtonBuilder().setCustomId(`shop_list_buy_${pageIdx}_${uid}`).setLabel('Buy Selected').setStyle(ButtonStyle.Danger);
          return new ActionRowBuilder().addComponents(prev, view, next, buy);
        });

        if (listRows.length === 0) {
          const prev = new ButtonBuilder().setCustomId(`shop_list_prev_0_${uid}`).setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(false);
          const view = new ButtonBuilder().setCustomId(`shop_list_view_0_${uid}`).setLabel('🃏 Image').setStyle(ButtonStyle.Success);
          const next = new ButtonBuilder().setCustomId(`shop_list_next_0_${uid}`).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(false);
          const buy = new ButtonBuilder().setCustomId(`shop_list_buy_0_${uid}`).setLabel('Buy Selected').setStyle(ButtonStyle.Danger);
          listRows.push(new ActionRowBuilder().addComponents(prev, view, next, buy));
        }

        const imageEmbeds = items.map((it, i) =>
          new EmbedBuilder()
            .setTitle(`**[${it.rarity}]** ${escapeMarkdown(it.name)} - ${it.cost} Fans`)
            .setImage(buildImageUrl(it.rarity, `${it.image}.png`))
            .setColor(Colors.Green)
            .setFooter({ text: `Item ${i + 1} of ${items.length}` })
        );

        const imageRows = items.map((it, i) => {
          const prev = new ButtonBuilder().setCustomId(`shop_img_prev_${i}_${uid}`).setLabel('◀ Prev').setStyle(ButtonStyle.Primary).setDisabled(false);
          const buy = new ButtonBuilder().setCustomId(`shop_img_buy_${i}_${uid}`).setLabel(`Buy`).setStyle(ButtonStyle.Danger);
          const next = new ButtonBuilder().setCustomId(`shop_img_next_${i}_${uid}`).setLabel('Next ▶').setStyle(ButtonStyle.Primary).setDisabled(false);
          const back = new ButtonBuilder().setCustomId(`shop_img_back_${i}_${uid}`).setLabel('⤵️ Back').setStyle(ButtonStyle.Secondary);
          return new ActionRowBuilder().addComponents(prev, back, next, buy);
        });

        return { pages, listEmbeds, listRows, imageEmbeds, imageRows };
      }

      // Build tier select menu
      const selectOptions = COST_TIERS.map(t => ({
        label: t.label,
        value: t.id,
        description: t.id === 'all' ? 'Show all items' : ` `,
      }));
      const tierSelect = new StringSelectMenuBuilder()
        .setCustomId(`shop_tier_select_${uid}`)
        .setPlaceholder('Filter by price tier')
        .addOptions(selectOptions)
        .setMinValues(1)
        .setMaxValues(1);
      const selectRow = new ActionRowBuilder().addComponents(tierSelect);

      // initial UI build using all items
      let filteredItems = itemsForTier(activeTier);
      let { pages, listEmbeds, listRows, imageEmbeds, imageRows } = buildUi(filteredItems);
      let totalPages = Math.max(1, pages.length);

      // Send initial list page (include selectRow)
      await interaction.editReply({ embeds: [listEmbeds[0]], components: [selectRow, listRows[0]] });
      const message = await interaction.fetchReply();

      let listPage = 0;
      let imageIdx = 0;

      const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Any,
        time: IDLE_LIMIT,
        filter: comp => comp.user.id === interaction.user.id && String(comp.customId).endsWith(`_${uid}`),
      });

      let idleTimer = null;
      function resetIdle() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => collector.stop('idle'), IDLE_LIMIT);
      }
      resetIdle();

      // Flag to indicate we're in the middle of a reveal/purchase so we ignore other interactions
      let isRevealing = false;

      collector.on('collect', async comp => {
        resetIdle();
        if (isRevealing) {
          // ignore interactions while revealing
          try { if (!comp.replied && !comp.deferred) await comp.reply({ content: 'Please wait while the purchase completes.', ephemeral: true }); } catch {}
          return;
        }

        try {
          // handle tier select
          if (comp.isStringSelectMenu && comp.customId === `shop_tier_select_${uid}`) {
            activeTier = comp.values[0] || 'all';
            filteredItems = itemsForTier(activeTier);
            ({ pages, listEmbeds, listRows, imageEmbeds, imageRows } = buildUi(filteredItems));
            totalPages = Math.max(1, pages.length);
            listPage = 0;
            imageIdx = 0;
            await comp.update({ embeds: [listEmbeds[0]], components: [selectRow, listRows[0]] });
            return;
          }

          const cid = comp.customId;

          // LIST NAV
          if (cid.startsWith(`shop_list_prev_`)) {
            listPage = (listPage - 1 + Math.max(1, pages.length)) % Math.max(1, pages.length);
            await comp.update({ embeds: [listEmbeds[listPage]], components: [selectRow, listRows[listPage]] });
            return;
          }
          if (cid.startsWith(`shop_list_next_`)) {
            listPage = (listPage + 1) % Math.max(1, pages.length);
            await comp.update({ embeds: [listEmbeds[listPage]], components: [selectRow, listRows[listPage]] });
            return;
          }
          if (cid.startsWith(`shop_list_view_`)) {
            imageIdx = listPage * ITEMS_PER_PAGE;
            imageIdx = Math.max(0, Math.min(imageIdx, imageEmbeds.length - 1));
            await comp.update({
              embeds: [imageEmbeds[imageIdx] || new EmbedBuilder().setTitle('No items').setDescription('No items in this tier.')],
              components: [selectRow, imageRows[imageIdx] || listRows[listPage]],
            });
            return;
          }
          if (cid.startsWith(`shop_list_buy_`)) {
            // modal: ask for item number on page (no qty)
            const pageItems = pages[listPage] || [];
            const modalId = `shop_buy_modal_${listPage}_${uid}`;
            const modal = new ModalBuilder().setCustomId(modalId).setTitle('Buy from Shop');
            const itemInput = new TextInputBuilder()
              .setCustomId('item_on_page')
              .setLabel(`Item number on page (1–${pageItems.length || 1})`)
              .setStyle(TextInputStyle.Short)
              .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(itemInput));
            await comp.showModal(modal);

            try {
              const modalInt = await comp.awaitModalSubmit({
                filter: m => m.customId === modalId && m.user.id === interaction.user.id,
                time: 60_000,
              });

              resetIdle();

              // ACKNOWLEDGE the modal immediately so it disappears from the user's client.
              // Defer an ephemeral reply so the modal closes, then delete that ephemeral reply immediately
              // so the user does not see a lingering "thinking" ephemeral message.
              try {
                await modalInt.deferReply({ ephemeral: true });
                // delete the ephemeral deferred reply right away so there's no visible ephemeral "thinking" message
                try { await modalInt.deleteReply().catch(() => {}); } catch {}
              } catch (ackErr) {
                // fallback: try a quick ephemeral reply then delete it
                try { await modalInt.reply({ content: 'Processing purchase...', ephemeral: true }); await modalInt.deleteReply().catch(() => {}); } catch {}
              }

              // Now the modal is acknowledged and gone. Parse input and proceed.
              let itemNum = parseInt(modalInt.fields.getTextInputValue('item_on_page'), 10);
              if (isNaN(itemNum) || itemNum < 1) itemNum = 1;
              const globalIndex = listPage * ITEMS_PER_PAGE + (itemNum - 1);
              if (globalIndex < 0 || globalIndex >= filteredItems.length) {
                // Inform user via ephemeral (optional) or skip; keep ephemeral here for invalid input
                try { await modalInt.followUp({ content: 'Invalid item selection.', ephemeral: true }); } catch {}
                return;
              }
              const item = filteredItems[globalIndex];

              // Pass both the original interaction (for editing the main shop message) and the acknowledged modal interaction
              await handlePurchase(interaction, modalInt, item);
            } catch (err) {
              try { await comp.reply({ content: 'Purchase cancelled or timed out.', ephemeral: true }); } catch {}
            }

            return;
          }

          // IMAGE NAV
          if (cid.startsWith(`shop_img_prev_`)) {
            if (imageEmbeds.length === 0) {
              await comp.update({ embeds: [new EmbedBuilder().setTitle('No items').setDescription('No items in this tier.')], components: [selectRow, listRows[listPage]] });
              return;
            }
            imageIdx = (imageIdx - 1 + imageEmbeds.length) % imageEmbeds.length;
            await comp.update({ embeds: [imageEmbeds[imageIdx]], components: [selectRow, imageRows[imageIdx]] });
            return;
          }
          if (cid.startsWith(`shop_img_next_`)) {
            if (imageEmbeds.length === 0) {
              await comp.update({ embeds: [new EmbedBuilder().setTitle('No items').setDescription('No items in this tier.')], components: [selectRow, listRows[listPage]] });
              return;
            }
            imageIdx = (imageIdx + 1) % imageEmbeds.length;
            await comp.update({ embeds: [imageEmbeds[imageIdx]], components: [selectRow, imageRows[imageIdx]] });
            return;
          }
          if (cid.startsWith(`shop_img_back_`)) {
            listPage = Math.floor(imageIdx / ITEMS_PER_PAGE);
            await comp.update({ embeds: [listEmbeds[listPage]], components: [selectRow, listRows[listPage]] });
            return;
          }
          if (cid.startsWith(`shop_img_buy_`)) {
            const parts = cid.split('_'); // shop_img_buy_{i}_{uid}
            const idx = Number(parts[3]);
            const item = filteredItems[idx];
            if (!item) {
              try { await comp.reply({ content: 'Item not found.', ephemeral: true }); } catch {}
              return;
            }
            // direct purchase of one (component interaction)
            // Acknowledge the component interaction immediately so we can proceed
            try { await comp.deferUpdate(); } catch (e) { /* ignore */ }
            await handlePurchase(interaction, comp, item);
            return;
          }
        } catch (err) {
          console.error('shop collector error:', err);
          try { if (!comp.replied && !comp.deferred) await comp.reply({ content: 'Internal error.', ephemeral: true }); } catch {}
        }
      });

      collector.on('end', async () => {
        try {
          if (idleTimer) clearTimeout(idleTimer);
          const disabled = message.components.map(r => {
            const row = ActionRowBuilder.from(r);
            row.components.forEach(b => b.setDisabled(true));
            return row;
          });
          await message.edit({ components: disabled });
        } catch (err) {
          console.error('shop cleanup error:', err);
        }
      });

      // Purchase handler: buys exactly one
      async function handlePurchase(parentInteraction, responder, item) {
        // Prevent other interactions while revealing/purchasing
        isRevealing = true;
        try {
          // Stop collector to avoid race conditions and further clicks
          try { collector.stop('purchase'); } catch (e) { /* ignore */ }

          const buyerId = parentInteraction.user.id;
          const totalCost = (item.cost || 0);

          // Quick in-memory stock check
          if (item.stock !== -1 && item.stock < 1) {
            try { if (responder && typeof responder.reply === 'function') await responder.reply({ content: `Item out of stock.`, ephemeral: true }); } catch {}
            isRevealing = false;
            return;
          }

          // Prepare random messages/debuts up front so both transaction and fallback can use them
          const randomMessages = [
            `But **${totalCost}** fans didn't like it and left!`,
            `The crowd went wild, but **${totalCost}** fans walked away.`,
            `Unfortunately, **${totalCost}** fans booed and left.`,
            `A tough debut.. **${totalCost}** fans weren't impressed.`,
            `While others cheered, **${totalCost}** fans decided to leave.`,
            `The debut was rocky, **${totalCost}** fans disappeared.`,
            `Mixed reactions: **${totalCost}** fans left disappointed.`,
            `Not everyone was happy, **${totalCost}** fans left.`,
            `Ouch, **${totalCost}** fans walked out after the debut.`
          ];
          const randomDebuts = [
            `**[${item.rarity}]** ${escapeMarkdown(item.name)} has just made their debut!`,
            `**[${item.rarity}]** ${escapeMarkdown(item.name)} just had their first live!`,
            `**[${item.rarity}]** ${escapeMarkdown(item.name)} stepped onto the stage for the very first time!`,
            `**[${item.rarity}]** ${escapeMarkdown(item.name)} wowed the crowd with their debut performance!`,
            `**[${item.rarity}]** ${escapeMarkdown(item.name)} is shining under the spotlight tonight!`,
            `**[${item.rarity}]** ${escapeMarkdown(item.name)} made their grand entrance to thunderous applause!`,
            `**[${item.rarity}]** ${escapeMarkdown(item.name)} just kicked off their career with style!`,
            `**[${item.rarity}]** ${escapeMarkdown(item.name)} is making waves with their first appearance!`,
            `**[${item.rarity}]** ${escapeMarkdown(item.name)} has officially joined Hololive!`,
          ];
          const randomMessage = randomMessages[Math.floor(Math.random() * randomMessages.length)];
          const randomDebut = randomDebuts[Math.floor(Math.random() * randomDebuts.length)];
          const specialGifUrl = 'https://media.discordapp.net/attachments/1445601709480083527/1445673016552853544/genshin-capturing-radiance.gif?ex=6931336a&is=692fe1ea&hm=7bb78cb57b0a036bd5f0d67362b65c79ff7dec19b6b942963a047ee7e71968ba&=&width=212&height=226'; // choose a GIF for SEC
          const specialGifDuration = 6900;
          // Show the special GIF on the main shop message (parentInteraction) AFTER modal has been acknowledged by caller
          try {
            const secEmbed = new EmbedBuilder()
              .setTitle('**DEBUT IN PROGRESS**')
              .setColor(0xFFD700)
              .setImage(specialGifUrl);

            // Edit the main shop message (the original deferred reply) to show the reveal and remove components
            try {
              await parentInteraction.editReply({ embeds: [secEmbed], components: [] });
            } catch (e) {
              console.warn('Failed to edit main shop message for SEC reveal:', e);
            }

            // ensure the GIF is visible long enough
            await sleep(specialGifDuration);
          } catch (err) {
            console.warn('failed to show SEC reveal gif:', err);
          }

          // Try to start a session for transaction
          let session = null;
          try {
            session = await mongoose.startSession();
          } catch (e) {
            session = null;
          }

          if (session) {
            try {
              let resultUser = null;
              await session.withTransaction(async () => {
                let userDoc = await User.findOne({ id: buyerId }).session(session);
                if (!userDoc) {
                  userDoc = new User({ id: buyerId, points: 0, pulls: 0, cards: [] });
                  await userDoc.save({ session });
                }

                if ((userDoc.points || 0) < totalCost) throw new Error('INSUFFICIENT_POINTS');

                // Deduct points
                userDoc.points = (userDoc.points || 0) - totalCost;

                // Add single card
                userDoc.cards = userDoc.cards || [];
                const displayName = item.image.replace(/[_-]+/g, ' ').trim();
                let card = userDoc.cards.find(c => c.name === displayName && c.rarity === item.rarity);
                if (!card) {
                  card = { name: displayName, rarity: item.rarity, count: 1, timestamps: [new Date()] };
                  userDoc.cards.push(card);
                } else {
                  card.count = (card.count || 0) + 1;
                  card.timestamps = card.timestamps || [];
                  card.timestamps.push(new Date());
                }

                await userDoc.save({ session });

                // NOTE: in-memory stock update is best-effort only; consider persisting stock in DB for atomicity across processes
                if (item.stock !== -1) {
                  SHOP_ITEMS[item.id] = SHOP_ITEMS[item.id] || {};
                  SHOP_ITEMS[item.id].stock = (SHOP_ITEMS[item.id].stock ?? item.stock) - 1;
                }

                resultUser = userDoc;
              });

              // success embed to show in the main shop message
              const cardImage = `${item.image}.png`;
              const embed = new EmbedBuilder()
                .setTitle('Debut finished!')
                .setDescription(`${randomDebut} \n${randomMessage}`)
                .setColor(Colors.Green)
                .setImage(buildImageUrl(item.rarity, cardImage))
                .addFields(
                  { name: 'Remaining Fans', value: `${(resultUser.points ?? 0)}`, inline: true },
                );

              // Update the main shop message with the final embed (this keeps everything in-place)
              try {
                await parentInteraction.editReply({ embeds: [embed], components: [] });
              } catch (err) {
                console.error('Failed to edit main shop message with final embed:', err);
              }

              return;
            } catch (err) {
              if (err && err.message === 'INSUFFICIENT_POINTS') {
                try { if (responder && typeof responder.reply === 'function') await responder.reply({ content: `You do not have enough Fans. You need ${totalCost} Fans.`, ephemeral: true }); } catch {}
                return;
              }
              console.error('purchase transaction error:', err);
              try { if (responder && typeof responder.reply === 'function') await responder.reply({ content: 'An error occurred while processing your purchase. Please try again later.', ephemeral: true }); } catch {}
              return;
            } finally {
              if (session) session.endSession();
            }
          } else {
            // Fallback: atomic points deduction then best-effort card add
            try {
              const updatedUser = await User.findOneAndUpdate(
                { id: buyerId, points: { $gte: totalCost } },
                { $inc: { points: -totalCost } },
                { new: true }
              );
              if (!updatedUser) {
                try { if (responder && typeof responder.reply === 'function') await responder.reply({ content: `You do not have enough Fans. You need ${totalCost} Fans.`, ephemeral: true }); } catch {}
                return;
              }

              // Add card (best-effort)
              updatedUser.cards = updatedUser.cards || [];
              const displayName = item.name.replace(/[_-]+/g, ' ').trim();
              let card = updatedUser.cards.find(c => c.name === displayName && c.rarity === item.rarity);
              if (!card) {
                card = { name: displayName, rarity: item.rarity, count: 1, timestamps: [new Date()] };
                updatedUser.cards.push(card);
              } else {
                card.count = (card.count || 0) + 1;
                card.timestamps = card.timestamps || [];
                card.timestamps.push(new Date());
              }
              await updatedUser.save();

              // Decrement in-memory stock
              if (item.stock !== -1) {
                SHOP_ITEMS[item.id] = SHOP_ITEMS[item.id] || {};
                SHOP_ITEMS[item.id].stock = (SHOP_ITEMS[item.id].stock ?? item.stock) - 1;
              }

              const cardImage = `${item.image}.png`;
              const embed = new EmbedBuilder()
                .setTitle('Debut finished!')
                .setDescription(`${randomDebut} \n${randomMessage}`)
                .setColor(Colors.Green)
                .setImage(buildImageUrl(item.rarity, cardImage))
                .addFields({ name: 'Remaining Fans', value: `${updatedUser.points}`, inline: true });

              // Update the main shop message with the final embed
              try {
                await parentInteraction.editReply({ embeds: [embed], components: [] });
              } catch (err) {
                console.error('Failed to edit main shop message with final embed (fallback):', err);
              }

              return;
            } catch (err) {
              console.error('fallback purchase error:', err);
              try { if (responder && typeof responder.reply === 'function') await responder.reply({ content: 'An error occurred while processing your purchase. Please try again later.', ephemeral: true }); } catch {}
              return;
            }
          }
        } finally {
          isRevealing = false;
        }
      }

    } catch (err) {
      console.error('shop command error:', err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Internal error opening shop.', ephemeral: true });
        } else {
          await interaction.editReply({ content: 'Internal error opening shop.' });
        }
      } catch (e) { /* ignore */ }
    }
  },
};
