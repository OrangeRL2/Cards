// commands/Utility/fusion.js
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
  Colors,
} = require('discord.js');
const mongoose = require('mongoose');
const User = require('../../models/User');
const FUSION_ITEMS = require('../../config/fusion-items');

const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';
const ITEMS_PER_PAGE = 5;
const IDLE_LIMIT = 120_000; // 2 minutes

// GIF settings
const ENTRANCE_GIFS = [
  'https://media.discordapp.net/attachments/1438508130165067818/1445661642158374972/tazuna-hayakawa-tazunahayakawa.gif?ex=693128d2&is=692fd752&hm=3dbd79e0a19920088c556e30521108255ac86bb12fe00a9ec9529c0ae51c614d&=',
];
const FUSE_GIFS = [
  'https://media.discordapp.net/attachments/1445601709480083527/1445673016552853544/genshin-capturing-radiance.gif?ex=6931336a&is=692fe1ea&hm=7bb78cb57b0a036bd5f0d67362b65c79ff7dec19b6b942963a047ee7e71968ba&=&width=212&height=226',
];
const ENTRANCE_GIF_DURATION = 2200; // ms
const FUSE_GIF_DURATION = 4200; // ms

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeMarkdown(str = '') {
  return String(str).replace(/([\\_*[\]()~`>#\-=|{}.!])/g, '\\$1');
}
function buildImageUrl(rarity, imageFilename) {
  return `${IMAGE_BASE.replace(/\/$/, '')}/${encodeURIComponent(rarity)}/${encodeURIComponent(imageFilename)}`;
}
function paginate(items) {
  const pages = [];
  for (let i = 0; i < items.length; i += ITEMS_PER_PAGE) pages.push(items.slice(i, i + ITEMS_PER_PAGE));
  return pages;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('fusion')
    .setDescription('Fuse cards together to create new ones!'),

  async execute(interaction) {
    await interaction.deferReply();

    // Show entrance GIF as an "entering" animation
    try {
      const entranceGif = ENTRANCE_GIFS[Math.floor(Math.random() * ENTRANCE_GIFS.length)];
      const loadingEmbed = new EmbedBuilder()
        .setTitle('*ENTERING FUSION LAB...*')
        .setColor(0x00BBFF)
        .setImage(entranceGif);
      await interaction.editReply({ embeds: [loadingEmbed] });
      await sleep(ENTRANCE_GIF_DURATION);
    } catch (err) {
      console.warn('Failed to show entrance gif:', err);
    }

    try {
      // Convert fusion items to array
      let allItems = Object.entries(FUSION_ITEMS).map(([id, it]) => ({ id, ...it }));

      if (allItems.length === 0) {
        return interaction.editReply({ content: 'No fusion recipes available.', ephemeral: true });
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
            const reqs = (it.requires || []).map(r => `${r.count}x [${r.rarity}] ${r.image}`).join(', ');
            return `**${globalIndex}. [${it.rarity}] ${escapeMarkdown(it.name)}**\nRequires: ${reqs || 'None'}`;
          }).join('\n\n');

          return new EmbedBuilder()
            .setTitle('Fusion Shop')
            .setDescription(description || 'No fusion recipes.')
            .setColor(Colors.Blurple)
            .setFooter({ text: `Page ${pageIdx + 1}/${totalPages}` });
        });

        const listRows = pages.map((chunk, pageIdx) => {
          const prev = new ButtonBuilder().setCustomId(`fusion_list_prev_${pageIdx}_${uid}`).setLabel('◀ Prev').setStyle(ButtonStyle.Primary);
          const view = new ButtonBuilder().setCustomId(`fusion_list_view_${pageIdx}_${uid}`).setLabel('🔍 Preview').setStyle(ButtonStyle.Success);
          const next = new ButtonBuilder().setCustomId(`fusion_list_next_${pageIdx}_${uid}`).setLabel('Next ▶').setStyle(ButtonStyle.Primary);
          const fuse = new ButtonBuilder().setCustomId(`fusion_list_fuse_${pageIdx}_${uid}`).setLabel('Fuse Selected').setStyle(ButtonStyle.Danger);
          return new ActionRowBuilder().addComponents(prev, view, next, fuse);
        });

        const imageEmbeds = items.map((it, i) =>
          new EmbedBuilder()
            .setTitle(`**[${it.rarity}]** ${escapeMarkdown(it.name)}`)
            .setDescription((it.requires || []).map(r => `${r.count}x [${r.rarity}] ${r.image}`).join('\n') || 'No requirements')
            .setImage(buildImageUrl(it.rarity, `${it.image}.png`))
            .setColor(Colors.Green)
            .setFooter({ text: `Recipe ${i + 1} of ${items.length}` })
        );

        const imageRows = items.map((it, i) => {
          const prev = new ButtonBuilder().setCustomId(`fusion_img_prev_${i}_${uid}`).setLabel('◀ Prev').setStyle(ButtonStyle.Primary);
          const fuse = new ButtonBuilder().setCustomId(`fusion_img_fuse_${i}_${uid}`).setLabel('Fuse').setStyle(ButtonStyle.Danger);
          const next = new ButtonBuilder().setCustomId(`fusion_img_next_${i}_${uid}`).setLabel('Next ▶').setStyle(ButtonStyle.Primary);
          const back = new ButtonBuilder().setCustomId(`fusion_img_back_${i}_${uid}`).setLabel('⤵️ Back').setStyle(ButtonStyle.Secondary);
          return new ActionRowBuilder().addComponents(prev, back, next, fuse);
        });

        return { pages, listEmbeds, listRows, imageEmbeds, imageRows };
      }

      // initial UI build
      let { pages, listEmbeds, listRows, imageEmbeds, imageRows } = buildUi(allItems);
      let totalPages = Math.max(1, pages.length);

      // Send initial list page
      await interaction.editReply({ embeds: [listEmbeds[0]], components: [listRows[0]] });
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

      collector.on('collect', async comp => {
        resetIdle();
        try {
          const cid = comp.customId;

          // LIST NAV
          if (cid.startsWith(`fusion_list_prev_`)) {
            listPage = (listPage - 1 + Math.max(1, pages.length)) % Math.max(1, pages.length);
            await comp.update({ embeds: [listEmbeds[listPage]], components: [listRows[listPage]] });
            return;
          }
          if (cid.startsWith(`fusion_list_next_`)) {
            listPage = (listPage + 1) % Math.max(1, pages.length);
            await comp.update({ embeds: [listEmbeds[listPage]], components: [listRows[listPage]] });
            return;
          }
          if (cid.startsWith(`fusion_list_view_`)) {
            imageIdx = listPage * ITEMS_PER_PAGE;
            imageIdx = Math.max(0, Math.min(imageIdx, imageEmbeds.length - 1));
            await comp.update({
              embeds: [imageEmbeds[imageIdx] || new EmbedBuilder().setTitle('No items').setDescription('No fusion recipes.')],
              components: [imageRows[imageIdx] || listRows[listPage]],
            });
            return;
          }

          // When user clicks "Fuse Selected" from list, show modal to enter item number (same UX as buy)
          if (cid.startsWith(`fusion_list_fuse_`)) {
            const totalItems = allItems.length || 1;
            const modalId = `fusion_buy_modal_${listPage}_${uid}`;
            const modal = new ModalBuilder().setCustomId(modalId).setTitle('Fuse from Fusion Shop');
            const itemInput = new TextInputBuilder()
              .setCustomId('item_global_index')
              .setLabel(`Enter the item number shown (1–${totalItems})`)
              .setStyle(TextInputStyle.Short)
              .setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(itemInput));

            try {
              await comp.showModal(modal);
            } catch (err) {
              try { if (!comp.replied && !comp.deferred) await comp.reply({ content: 'Unable to show modal.', ephemeral: true }); } catch {}
              return;
            }

            try {
              const modalInt = await comp.awaitModalSubmit({
                filter: m => m.customId === modalId && m.user.id === interaction.user.id,
                time: 60_000,
              });

              resetIdle();

              // acknowledge modal so it disappears
              try {
                if (!modalInt.deferred && !modalInt.replied) await modalInt.deferReply({ ephemeral: true });
                await modalInt.deleteReply().catch(() => {});
              } catch (ackErr) {
                try { await modalInt.reply({ content: 'Processing fusion...', ephemeral: true }); await modalInt.deleteReply().catch(() => {}); } catch {}
              }

              // parse global index directly
              let entered = parseInt(modalInt.fields.getTextInputValue('item_global_index'), 10);
              if (isNaN(entered) || entered < 1) entered = 1;
              const globalIndex = entered - 1;
              if (globalIndex < 0 || globalIndex >= allItems.length) {
                try { await modalInt.followUp({ content: 'Invalid item selection.', ephemeral: true }); } catch {}
                return;
              }
              const item = allItems[globalIndex];
              await handleFusion(interaction, modalInt, item);
            } catch (err) {
              try { await comp.reply({ content: 'Fusion cancelled or timed out.', ephemeral: true }); } catch {}
            }

            return;
          }

          // IMAGE NAV
          if (cid.startsWith(`fusion_img_prev_`)) {
            if (imageEmbeds.length === 0) {
              await comp.update({ embeds: [new EmbedBuilder().setTitle('No items').setDescription('No fusion recipes.')], components: [listRows[listPage]] });
              return;
            }
            imageIdx = (imageIdx - 1 + imageEmbeds.length) % imageEmbeds.length;
            await comp.update({ embeds: [imageEmbeds[imageIdx]], components: [imageRows[imageIdx]] });
            return;
          }
          if (cid.startsWith(`fusion_img_next_`)) {
            if (imageEmbeds.length === 0) {
              await comp.update({ embeds: [new EmbedBuilder().setTitle('No items').setDescription('No fusion recipes.')], components: [listRows[listPage]] });
              return;
            }
            imageIdx = (imageIdx + 1) % imageEmbeds.length;
            await comp.update({ embeds: [imageEmbeds[imageIdx]], components: [imageRows[imageIdx]] });
            return;
          }
          if (cid.startsWith(`fusion_img_back_`)) {
            listPage = Math.floor(imageIdx / ITEMS_PER_PAGE);
            await comp.update({ embeds: [listEmbeds[listPage]], components: [listRows[listPage]] });
            return;
          }
          if (cid.startsWith(`fusion_img_fuse_`)) {
            const parts = cid.split('_'); // fusion_img_fuse_{i}_{uid}
            const idx = Number(parts[3]);
            const item = allItems[idx];
            if (!item) {
              try { await comp.reply({ content: 'Recipe not found.', ephemeral: true }); } catch {}
              return;
            }
            // direct fuse from image view (component interaction)
            try { await comp.deferUpdate(); } catch (e) { /* ignore */ }
            await handleFusion(interaction, comp, item);
            return;
          }
        } catch (err) {
          console.error('fusion collector error:', err);
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
          console.error('fusion cleanup error:', err);
        }
      });

      // Fusion handler
      async function handleFusion(parentInteraction, responder, recipe) {
        // Show fuse GIF before performing the fusion (entrance to the fusion animation)
        try {
          const fuseGif = FUSE_GIFS[Math.floor(Math.random() * FUSE_GIFS.length)];
          const fuseEmbed = new EmbedBuilder()
            .setTitle('**FUSION IN PROGRESS**')
            .setColor(0xFFD700)
            .setImage(fuseGif);

          // Update the main shop message (the original deferred reply) to show the reveal and remove components
          try {
            await parentInteraction.editReply({ embeds: [fuseEmbed], components: [] });
          } catch (e) {
            console.warn('Failed to edit main fusion message for fuse reveal:', e);
          }

          // ensure the GIF is visible long enough
          await sleep(FUSE_GIF_DURATION);
        } catch (err) {
          console.warn('failed to show fuse gif:', err);
        }

        try {
          // Load user
          const buyerId = parentInteraction.user.id;
          let userDoc = await User.findOne({ id: buyerId });
          if (!userDoc) {
            userDoc = new User({ id: buyerId, points: 0, pulls: 0, cards: [] });
            await userDoc.save();
          }

          // Validate recipe structure
          if (!recipe || !Array.isArray(recipe.requires)) {
            try { if (responder && typeof responder.reply === 'function') await responder.reply({ content: 'Invalid fusion recipe.', ephemeral: true }); } catch {}
            return;
          }

          // Collect missing requirements
          const missing = [];
          for (const req of recipe.requires) {
            if (!req || typeof req.rarity !== 'string' || typeof req.image !== 'string' || typeof req.count !== 'number') {
              try { if (responder && typeof responder.reply === 'function') await responder.reply({ content: `Invalid requirement in recipe.`, ephemeral: true }); } catch {}
              return;
            }
            const card = (userDoc.cards || []).find(c => String(c.rarity) === String(req.rarity) && String(c.name) === String(req.image));
            const have = (card && card.count) ? card.count : 0;
            if (have < req.count) {
              missing.push({ req, have });
            }
          }

          // If missing any, reply with a clear error embed listing missing cards and what the user has
          if (missing.length > 0) {
            const missingText = missing.map(m => {
              const need = m.req.count - m.have;
              return `${need}x [${m.req.rarity}] ${m.req.image} (You have ${m.have})`;
            }).join('\n');

            const failEmbed = new EmbedBuilder()
              .setTitle('Fusion failed')
              .setDescription('You do not meet the requirements for this fusion.')
              .addFields(
                { name: 'Missing cards', value: missingText || 'None', inline: false },
                { name: 'Recipe', value: `[${recipe.rarity}] ${recipe.image}`, inline: false }
              )
              .setColor(Colors.Red);

            try {
              if (responder && typeof responder.reply === 'function') {
                await responder.reply({ embeds: [failEmbed], ephemeral: true });
              } else {
                await parentInteraction.followUp({ embeds: [failEmbed], ephemeral: true });
              }
            } catch (err) {
              try { await parentInteraction.followUp({ content: 'Fusion failed: missing required cards.', ephemeral: false }); } catch {}
            }
            return;
          }

          // Deduct required cards (persist changes)
          for (const req of recipe.requires) {
            const card = (userDoc.cards || []).find(c => String(c.rarity) === String(req.rarity) && String(c.name) === String(req.image));
            card.count = (card.count || 0) - req.count;
            // Optionally remove cards with zero count
            if (card.count <= 0) {
              // remove from array
              userDoc.cards = userDoc.cards.filter(c => !(String(c.rarity) === String(req.rarity) && String(c.name) === String(req.image)));
            }
          }

          // Add or increment fused card
          userDoc.cards = userDoc.cards || [];
          const displayName = recipe.image;
          const now = new Date();
          let fusedCard = userDoc.cards.find(c => c.name === displayName && c.rarity === recipe.rarity);
          if (!fusedCard) {
            fusedCard = {
              name: displayName,
              rarity: recipe.rarity,
              count: 1,
              firstAcquiredAt: now,
              lastAcquiredAt: now,
              locked: false,
            };
            userDoc.cards.push(fusedCard);
          } else {
            fusedCard.count = (fusedCard.count || 0) + 1;
            if (!fusedCard.firstAcquiredAt) fusedCard.firstAcquiredAt = now;
            fusedCard.lastAcquiredAt = now;
          }

          await userDoc.save();

          // Build requirements text for embed
          const reqText = recipe.requires.map(req => `${req.count}x [${req.rarity}] ${req.image}`).join('\n');

          const embed = new EmbedBuilder()
            .setTitle('Fusion Complete!')
            .setDescription(`You fused cards into **${recipe.name}**!`)
            .addFields(
              { name: 'Required Cards', value: reqText || 'None', inline: false },
              { name: 'Result', value: `[${recipe.rarity}] ${recipe.image}`, inline: false }
            )
            .setColor(Colors.Green)
            .setImage(buildImageUrl(recipe.rarity, `${recipe.image}.png`));

          // Update the main message with the final embed (keeps everything in-place)
          try {
            await parentInteraction.editReply({ embeds: [embed], components: [] });
          } catch (err) {
            // fallback: reply to responder
            try { if (responder && typeof responder.reply === 'function') await responder.reply({ embeds: [embed], ephemeral: true }); } catch {}
          }
        } catch (err) {
          console.error('fusion handler error:', err);
          try { if (responder && typeof responder.reply === 'function') await responder.reply({ content: 'An error occurred while processing the fusion. Please try again later.', ephemeral: true }); } catch {}
        }
      }
    } catch (err) {
      console.error('fusion command error:', err);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Internal error opening fusion shop.', ephemeral: true });
        } else {
          await interaction.editReply({ content: 'Internal error opening fusion shop.' });
        }
      } catch (e) { /* ignore */ }
    }
  },
};
