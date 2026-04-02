// commands/Utility/eggchange.js
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
const PullQuota = require('../../models/PullQuota');
const EGGSCHANGE_ITEMS = require('../../config/eggchange-items');
const { pickWeighted, pickWeightedWithRoll } = require('../../utils/rates');

const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';

const ITEMS_PER_PAGE = 5;
const IDLE_LIMIT = 500_000; // UI idle timeout

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Escape Discord markdown safely
function escapeMarkdown(str = '') {
  return String(str).replace(/(\[\\`*_{}\[\]+\-.!\n>~\])/g, '\\$1');
}

function buildImageUrl(rarity, imageFilename) {
  return `${IMAGE_BASE.replace(/\/$/, '')}/${encodeURIComponent(rarity)}/${encodeURIComponent(imageFilename)}`;
}

// Optional reveal gifs
const REVEAL_GIFS = [
  'https://cdn.discordapp.com/attachments/1438508130165067818/1488683188527300859/kurousagi.gif?ex=69cdabc2&is=69cc5a42&hm=c4a55e3c555523974099d1ece90f7c1bc8b92679cfa9ad43954e7bc41ee889f7&',
];
const REVEAL_DURATION = 1600;

function paginate(items) {
  const pages = [];
  for (let i = 0; i < items.length; i += ITEMS_PER_PAGE) {
    pages.push(items.slice(i, i + ITEMS_PER_PAGE));
  }
  return pages;
}

// ===== Inventory helpers =====
function getCardCount(userDoc, rarity, name) {
  const c = (userDoc.cards || []).find(
    (x) => String(x.rarity) === String(rarity) && String(x.name) === String(name),
  );
  return Number(c?.count || 0);
}

function addCard(userDoc, rarity, name, amount = 1) {
  userDoc.cards = userDoc.cards || [];
  const now = new Date();
  let c = userDoc.cards.find(
    (x) => String(x.rarity) === String(rarity) && String(x.name) === String(name),
  );
  if (!c) {
    c = {
      name,
      rarity,
      count: amount,
      firstAcquiredAt: now,
      lastAcquiredAt: now,
      locked: false,
    };
    userDoc.cards.push(c);
  } else {
    c.count = Number(c.count || 0) + Number(amount || 0);
    if (!c.firstAcquiredAt) c.firstAcquiredAt = now;
    c.lastAcquiredAt = now;
  }
}

function deductCards(userDoc, costCards) {
  for (const req of costCards) {
    const idx = (userDoc.cards || []).findIndex(
      (x) => String(x.rarity) === String(req.rarity) && String(x.name) === String(req.image),
    );
    if (idx === -1) continue;
    userDoc.cards[idx].count = Number(userDoc.cards[idx].count || 0) - Number(req.count || 0);
    if (userDoc.cards[idx].count <= 0) userDoc.cards.splice(idx, 1);
  }
}

function canAfford(userDoc, costCards) {
  const reqs = Array.isArray(costCards) ? costCards : [];
  for (const req of reqs) {
    const have = getCardCount(userDoc, req.rarity, req.image);
    if (have < Number(req.count ?? 0)) return false;
  }
  return true;
}

// ===== Weighted roll helpers =====
function pickWeightedEntry(entries = [], { label = 'pool' } = {}) {
  const valid = entries
    .map((entry, idx) => ({
      idx,
      weight: Number(entry?.weight ?? 0),
      entry,
    }))
    .filter((x) => x.weight > 0);

  if (valid.length === 0) return null;

  const options = valid.map((x) => ({
    key: String(x.idx),
    weight: x.weight,
  }));

  // Use debug-capable picker (roll + total)
  const { key, roll, total } = pickWeightedWithRoll(options, { integer: true });
  const pickedIdx = Number(key);
  const found = valid.find((x) => x.idx === pickedIdx);

  // "Drawn weight" = weight of the selected entry
  const pickedWeight = found?.weight ?? null;

  // Helpful identifier (card pulls use image; rewardgacha uses rewardType)
  const pickedDesc =
    found?.entry?.image ??
    found?.entry?.rewardType ??
    found?.entry?.name ??
    `idx:${pickedIdx}`;

  console.log('[eggschange][weighted-pick]', {
    label,
    roll,
    total,
    pickedIdx,
    pickedWeight,
    pickedDesc,
  });

  return found?.entry ?? null;
}

function rollFromPool(pool) {
  const picked = pickWeightedEntry(pool);
  if (!picked) throw new Error('EMPTY_POOL');
  return { rarity: picked.rarity, image: picked.image };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eggschange')
    .setDescription('Eggschange eggs (card currency) for gacha, event pulls, fans, or reward gachas.'),

  async execute(interaction) {
    await interaction.deferReply();

    const items = Object.entries(EGGSCHANGE_ITEMS).map(([id, it]) => ({ id, ...it }));
    if (items.length === 0) {
      return interaction.editReply({ content: 'No eggschange items are configured right now.' });
    }

    const uid = `${interaction.id}_${Date.now()}`;

    function itemLine(it, index) {
      const costText =
        (it.costCards || [])
          .map((c) => `${c.count}x [${c.rarity}] ${c.image}`)
          .join(', ') || 'None';

      if (it.type === 'rewardgacha') {
        return `**${index}.** 🎲 ${escapeMarkdown(it.name)}\nCost: ${costText}\nRewards: random card / 25 fans / 5 event pull / Stream Ticket`;
      }
      if (it.type === 'gacha') {
        return `**${index}.** 🎲 ${escapeMarkdown(it.name)}\nCost: ${costText}\nRolls: ${it.pulls ?? 1}`;
      }
      if (it.type === 'eventpulls') {
        return `**${index}.** 🎟️ ${escapeMarkdown(it.name)}\nCost: ${costText}\nGives: +${it.amount ?? 0} event pulls`;
      }
      if (it.type === 'fans') {
        return `**${index}.** 👥 ${escapeMarkdown(it.name)}\nCost: ${costText}\nGives: +${it.amount ?? 0} fans`;
      }
      return `**${index}.** ${escapeMarkdown(it.name)}\nCost: ${costText}`;
    }

    function buildUi(activeItems) {
      const pages = paginate(activeItems);
      const totalPages = Math.max(1, pages.length);

      const listEmbeds = pages.map((chunk, pageIdx) => {
        const description = chunk
          .map((it, idx) => itemLine(it, pageIdx * ITEMS_PER_PAGE + idx + 1))
          .join('\n\n');

        return new EmbedBuilder()
          .setTitle('🥚 Eggschange')
          .setDescription(description || 'No items.')
          .setColor(Colors.Blurple)
          .setFooter({ text: `Page ${pageIdx + 1}/${totalPages}` });
      });

      const listRows = pages.map((chunk, pageIdx) => {
        const prev = new ButtonBuilder()
          .setCustomId(`egg_list_prev_${pageIdx}_${uid}`)
          .setLabel('◀ Prev')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(totalPages <= 1);

        const view = new ButtonBuilder()
          .setCustomId(`egg_list_view_${pageIdx}_${uid}`)
          .setLabel('🖼️ Preview')
          .setStyle(ButtonStyle.Success);

        const next = new ButtonBuilder()
          .setCustomId(`egg_list_next_${pageIdx}_${uid}`)
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(totalPages <= 1);

        const ex = new ButtonBuilder()
          .setCustomId(`egg_list_exchange_${pageIdx}_${uid}`)
          .setLabel('Eggschange Selected')
          .setStyle(ButtonStyle.Danger);

        return new ActionRowBuilder().addComponents(prev, view, next, ex);
      });

      const imageEmbeds = activeItems.map((it, i) => {
        const costText =
          (it.costCards || [])
            .map((c) => `${c.count}x [${c.rarity}] ${c.image}`)
            .join('\n') || 'None';

        let desc = `Cost:\n${costText}`;
        if (it.type === 'rewardgacha') {
          desc += `\n\nPossible rewards:\n• 1 random card from this color pool\n• 25 fans\n• 5 event pull\n• 1x [EAS] Stream Ticket`;
        }

        const embed = new EmbedBuilder()
          .setTitle(`${escapeMarkdown(it.name)}`)
          .setDescription(desc)
          .setColor(Colors.Green)
          .setFooter({ text: `Item ${i + 1} of ${activeItems.length}` });

        if (it.banner?.rarity && it.banner?.image) {
          embed.setImage(buildImageUrl(it.banner.rarity, `${it.banner.image}.png`));
        }
        return embed;
      });

      const imageRows = activeItems.map((it, i) => {
        const prev = new ButtonBuilder()
          .setCustomId(`egg_img_prev_${i}_${uid}`)
          .setLabel('◀ Prev')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(activeItems.length <= 1);

        const back = new ButtonBuilder()
          .setCustomId(`egg_img_back_${i}_${uid}`)
          .setLabel('⤵️ Back')
          .setStyle(ButtonStyle.Secondary);

        const next = new ButtonBuilder()
          .setCustomId(`egg_img_next_${i}_${uid}`)
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(activeItems.length <= 1);

        const ex = new ButtonBuilder()
          .setCustomId(`egg_img_exchange_${i}_${uid}`)
          .setLabel('Eggschange')
          .setStyle(ButtonStyle.Danger);

        return new ActionRowBuilder().addComponents(prev, back, next, ex);
      });

      return { pages, listEmbeds, listRows, imageEmbeds, imageRows };
    }

    let { pages, listEmbeds, listRows, imageEmbeds, imageRows } = buildUi(items);

    const message = await interaction.editReply({
      embeds: [listEmbeds[0]],
      components: [listRows[0]],
    }).then(() => interaction.fetchReply());

    let listPage = 0;
    let imageIdx = 0;

    // Result state (so we can support Prev/Next + Again + Back)
    let resultState = null; // { type: 'gacha'|'single', item, pageItems, descriptionAll, costText, pageIndex, canAgain }

    let idleTimer = null;
    function resetIdle(collector) {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => collector.stop('idle'), IDLE_LIMIT);
    }

    let isProcessing = false;

    // IDs for result buttons (use item.id so "again" repeats the same purchase)
    const resultMenuId = `egg_back_menu_${uid}`;
    const resultPrevId = `eggroll_prev_${uid}`;
    const resultNextId = `eggroll_next_${uid}`;

    function makeResultRows() {
      if (!resultState) return [];

      const menuBtn = new ButtonBuilder()
        .setCustomId(resultMenuId)
        .setLabel('↩ Back to Menu')
        .setStyle(ButtonStyle.Secondary);

      const againId = `egg_again_${resultState.item.id}_${uid}`;
      const againBtn = new ButtonBuilder()
        .setCustomId(againId)
        .setLabel('🔁 Eggschange Again')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!resultState.canAgain);

      if (resultState.type === 'gacha') {
        const prevBtn = new ButtonBuilder()
          .setCustomId(resultPrevId)
          .setLabel('◀ Prev')
          .setStyle(ButtonStyle.Primary)
          .setDisabled((resultState.pageItems?.length ?? 0) <= 1);

        const nextBtn = new ButtonBuilder()
          .setCustomId(resultNextId)
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Primary)
          .setDisabled((resultState.pageItems?.length ?? 0) <= 1);

        return [new ActionRowBuilder().addComponents(prevBtn, nextBtn, againBtn, menuBtn)];
      }

      return [new ActionRowBuilder().addComponents(againBtn, menuBtn)];
    }

    function makeGachaEmbedAt(idx) {
      const it = resultState.pageItems[idx];
      return new EmbedBuilder()
        .setTitle(
          `Card: ${idx + 1} / ${resultState.pageItems.length} **[${it.rarity}]** - ${escapeMarkdown(it.displayName)} - #${it.countAfter}`,
        )
        .setDescription(resultState.descriptionAll)
        .setColor(0x00BB88)
        .addFields({ name: 'Cost Paid', value: resultState.costText, inline: false })
        .setImage(it.imageUrl)
        .setURL(it.imageUrl)
        .setFooter({ text: `Eggschange by: ${interaction.user.username}` });
    }

    async function showMenu() {
      // Rebuild in case items changed (optional, cheap)
      ({ pages, listEmbeds, listRows, imageEmbeds, imageRows } = buildUi(items));
      listPage = Math.max(0, Math.min(listPage, listEmbeds.length - 1));
      resultState = null;
      await interaction.editReply({
        embeds: [listEmbeds[listPage] || listEmbeds[0]],
        components: [listRows[listPage] || listRows[0]],
      });
    }

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: IDLE_LIMIT,
      filter: (comp) =>
        comp.user.id === interaction.user.id &&
        String(comp.customId).endsWith(`_${uid}`),
    });

    resetIdle(collector);

    collector.on('collect', async (comp) => {
      resetIdle(collector);

      if (isProcessing) {
        try {
          if (!comp.replied && !comp.deferred) {
            await comp.reply({ content: 'Please wait…', ephemeral: true });
          }
        } catch {}
        return;
      }

      const cid = comp.customId;

      try {
        // ===== Result view controls =====
        if (cid === resultMenuId) {
          await comp.deferUpdate().catch(() => {});
          await showMenu();
          return;
        }

        // Again button encodes item id: egg_again_<itemId>_<uid>
        if (cid.startsWith('egg_again_')) {
          await comp.deferUpdate().catch(() => {});
          if (!resultState?.item) return;
          await handleExchange(resultState.item);
          return;
        }

        // Gacha paging buttons (only valid if currently in gacha result)
        if (cid === resultPrevId || cid === resultNextId) {
          if (!resultState || resultState.type !== 'gacha') {
            // Ignore if not in gacha result view
            await comp.deferUpdate().catch(() => {});
            return;
          }
          const len = resultState.pageItems.length;
          if (len <= 1) {
            await comp.deferUpdate().catch(() => {});
            return;
          }

          if (cid === resultPrevId) {
            resultState.pageIndex = (resultState.pageIndex - 1 + len) % len;
          } else {
            resultState.pageIndex = (resultState.pageIndex + 1) % len;
          }

          await comp.update({
            embeds: [makeGachaEmbedAt(resultState.pageIndex)],
            components: makeResultRows(),
          });
          return;
        }

        // ===== Menu UI controls (list) =====
        if (cid.startsWith('egg_list_prev_')) {
          listPage = (listPage - 1 + Math.max(1, pages.length)) % Math.max(1, pages.length);
          await comp.update({
            embeds: [listEmbeds[listPage]],
            components: [listRows[listPage]],
          });
          return;
        }

        if (cid.startsWith('egg_list_next_')) {
          listPage = (listPage + 1) % Math.max(1, pages.length);
          await comp.update({
            embeds: [listEmbeds[listPage]],
            components: [listRows[listPage]],
          });
          return;
        }

        if (cid.startsWith('egg_list_view_')) {
          imageIdx = listPage * ITEMS_PER_PAGE;
          imageIdx = Math.max(0, Math.min(imageIdx, imageEmbeds.length - 1));
          await comp.update({
            embeds: [imageEmbeds[imageIdx] || new EmbedBuilder().setTitle('No items')],
            components: [imageRows[imageIdx] || listRows[listPage]],
          });
          return;
        }

        // ===== Menu UI controls (image preview) =====
        if (cid.startsWith('egg_img_prev_')) {
          if (imageEmbeds.length <= 0) return;
          imageIdx = (imageIdx - 1 + imageEmbeds.length) % imageEmbeds.length;
          await comp.update({
            embeds: [imageEmbeds[imageIdx]],
            components: [imageRows[imageIdx]],
          });
          return;
        }

        if (cid.startsWith('egg_img_next_')) {
          if (imageEmbeds.length <= 0) return;
          imageIdx = (imageIdx + 1) % imageEmbeds.length;
          await comp.update({
            embeds: [imageEmbeds[imageIdx]],
            components: [imageRows[imageIdx]],
          });
          return;
        }

        if (cid.startsWith('egg_img_back_')) {
          listPage = Math.floor(imageIdx / ITEMS_PER_PAGE);
          await comp.update({
            embeds: [listEmbeds[listPage]],
            components: [listRows[listPage]],
          });
          return;
        }

        // ===== Exchange from image (direct) =====
        if (cid.startsWith('egg_img_exchange_')) {
          const parts = cid.split('_');
          const idx = Number(parts[3]);
          const item = items[idx];
          if (!item) {
            try {
              await comp.reply({ content: 'Item not found.', ephemeral: true });
            } catch {}
            return;
          }
          await comp.deferUpdate().catch(() => {});
          await handleExchange(item);
          return;
        }

        // ===== Exchange from list -> modal selection =====
        if (cid.startsWith('egg_list_exchange_')) {
          const totalItems = items.length;
          const modalId = `egg_exchange_modal_${listPage}_${uid}`;
          const modal = new ModalBuilder().setCustomId(modalId).setTitle('Eggschange');

          const itemInput = new TextInputBuilder()
            .setCustomId('item_global_index')
            .setLabel(`Enter the item number shown (1–${totalItems})`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(itemInput));
          await comp.showModal(modal);

          try {
            const modalInt = await comp.awaitModalSubmit({
              filter: (m) => m.customId === modalId && m.user.id === interaction.user.id,
              time: 60_000,
            });

            try {
              if (!modalInt.deferred && !modalInt.replied) {
                await modalInt.deferReply({ ephemeral: true });
              }
              await modalInt.deleteReply().catch(() => {});
            } catch {}

            let entered = parseInt(modalInt.fields.getTextInputValue('item_global_index'), 10);
            if (Number.isNaN(entered) || entered < 1) entered = 1;
            const idx = entered - 1;
            const item = items[idx];

            if (!item) {
              try {
                await modalInt.followUp({ content: 'Invalid item selection.', ephemeral: true });
              } catch {}
              return;
            }

            await handleExchange(item);
          } catch {
            try {
              await comp.reply({ content: 'Eggschange cancelled or timed out.', ephemeral: true });
            } catch {}
          }
          return;
        }
      } catch (err) {
        console.error('eggschange collector error:', err);
        try {
          if (!comp.replied && !comp.deferred) {
            await comp.reply({ content: 'Internal error.', ephemeral: true });
          }
        } catch {}
      }
    });

    collector.on('end', async () => {
      try {
        if (idleTimer) clearTimeout(idleTimer);
        const disabled = message.components.map((r) => {
          const row = ActionRowBuilder.from(r);
          row.components.forEach((b) => b.setDisabled(true));
          return row;
        });
        await message.edit({ components: disabled });
      } catch {}
    });

    async function handleExchange(item) {
      isProcessing = true;

      try {
        // Show reveal gif
        try {
          const gif = REVEAL_GIFS[Math.floor(Math.random() * REVEAL_GIFS.length)];
          const emb = new EmbedBuilder()
            .setTitle('🥚 EGGSCHANGE IN PROGRESS…')
            .setColor(0xFFD700)
            .setImage(gif);
          await interaction.editReply({ embeds: [emb], components: [] });
          await sleep(REVEAL_DURATION);
        } catch {}

        const buyerId = interaction.user.id;
        const session = await mongoose.startSession();

        let resultUser = null;
        let results = null;

        try {
          await session.withTransaction(async () => {
            let userDoc = await User.findOne({ id: buyerId }).session(session);
            if (!userDoc) {
              userDoc = new User({ id: buyerId, points: 0, pulls: 0, cards: [] });
              await userDoc.save({ session });
            }

            let quotaDoc = await PullQuota.findOne({ userId: buyerId }).session(session);
            if (!quotaDoc) {
              quotaDoc = new PullQuota({ userId: buyerId });
              await quotaDoc.save({ session });
            }

            // Validate cost
            const costCards = Array.isArray(item.costCards) ? item.costCards : [];
            const missing = [];
            for (const req of costCards) {
              const have = getCardCount(userDoc, req.rarity, req.image);
              if (have < req.count) missing.push({ req, have });
            }

            if (missing.length > 0) {
              const msg = missing
                .map((m) => `${m.req.count - m.have}x [${m.req.rarity}] ${m.req.image} (You have ${m.have})`)
                .join('\n');
              throw new Error(`MISSING_COST::${msg}`);
            }

            // Deduct cost
            deductCards(userDoc, costCards);

            // Grant
            if (item.type === 'gacha') {
              const pulls = Math.max(1, Number(item.pulls ?? 1));
              const pool = Array.isArray(item.pool) ? item.pool : [];
              if (pool.length === 0) throw new Error('EMPTY_POOL');

              const rolled = [];
              for (let i = 0; i < pulls; i++) {
                const r = rollFromPool(pool);
                addCard(userDoc, r.rarity, r.image, 1);
                const countAfter = getCardCount(userDoc, r.rarity, r.image);
                rolled.push({ rarity: r.rarity, image: r.image, countAfter });
              }
              results = { kind: 'gacha', pulls, rolled };
            } else if (item.type === 'rewardgacha') {
              const rewardPool = Array.isArray(item.rewardPool) ? item.rewardPool : [];
              const cardPool = Array.isArray(item.cardPool) ? item.cardPool : [];
              if (rewardPool.length === 0) throw new Error('EMPTY_REWARD_POOL');

              const reward = pickWeightedEntry(rewardPool);
              if (!reward) throw new Error('INVALID_REWARD_PICK');

              if (reward.rewardType === 'card') {
                if (cardPool.length === 0) throw new Error('EMPTY_CARD_POOL');
                const pickedCard = pickWeightedEntry(cardPool);
                if (!pickedCard) throw new Error('INVALID_CARD_PICK');

                addCard(userDoc, pickedCard.rarity, pickedCard.image, 1);
                const countAfter = getCardCount(userDoc, pickedCard.rarity, pickedCard.image);

                results = {
                  kind: 'rewardgacha',
                  rewardType: 'card',
                  rarity: pickedCard.rarity,
                  image: pickedCard.image,
                  countAfter,
                };
              } else if (reward.rewardType === 'fans') {
                const amt = Number(reward.amount ?? 25);
                userDoc.points = Number(userDoc.points ?? 0) + amt;

                results = {
                  kind: 'rewardgacha',
                  rewardType: 'fans',
                  amount: amt,
                  newTotal: userDoc.points,
                };
              } else if (reward.rewardType === 'eventpulls') {
                const amt = Number(reward.amount ?? 1);
                quotaDoc.eventPulls = Number(quotaDoc.eventPulls ?? 0) + amt;
                await quotaDoc.save({ session });

                results = {
                  kind: 'rewardgacha',
                  rewardType: 'eventpulls',
                  amount: amt,
                  newTotal: quotaDoc.eventPulls,
                };
              } else if (reward.rewardType === 'streamticketcard') {
                const amt = Number(reward.amount ?? 1);
                const rarity = reward.rarity ?? 'EAS';
                const image = reward.image ?? 'Stream Ticket';

                addCard(userDoc, rarity, image, amt);
                const countAfter = getCardCount(userDoc, rarity, image);

                results = {
                  kind: 'rewardgacha',
                  rewardType: 'streamticketcard',
                  rarity,
                  image,
                  countAfter,
                  amount: amt,
                };
              } else {
                throw new Error('UNKNOWN_REWARD_TYPE');
              }
            } else if (item.type === 'eventpulls') {
              const amt = Number(item.amount ?? 0);
              quotaDoc.eventPulls = Number(quotaDoc.eventPulls ?? 0) + amt;
              await quotaDoc.save({ session });

              results = {
                kind: 'eventpulls',
                amount: amt,
                newTotal: quotaDoc.eventPulls,
              };
            } else if (item.type === 'fans') {
              const amt = Number(item.amount ?? 0);
              userDoc.points = Number(userDoc.points ?? 0) + amt;

              results = {
                kind: 'fans',
                amount: amt,
                newTotal: userDoc.points,
              };
            } else {
              throw new Error('UNKNOWN_TYPE');
            }

            await userDoc.save({ session });
            resultUser = userDoc;
          });
        } finally {
          await session.endSession();
        }

        const costText =
          (item.costCards || []).map((c) => `${c.count}x [${c.rarity}] ${c.image}`).join('\n') || 'None';

        // Determine if we can run again (post-transaction inventory)
        const canAgainNow = resultUser ? canAfford(resultUser, item.costCards) : false;

        // ===== Results rendering =====
        if (results?.kind === 'gacha') {
          const rolled = results.rolled || [];

          const pageItems = rolled.map((r) => {
            const displayName = String(r.image);
            const rarity = String(r.rarity);
            const imageUrl = buildImageUrl(rarity, `${displayName}.png`);
            return {
              rarity,
              displayName,
              imageUrl,
              countAfter: Number(r.countAfter || 1),
            };
          });

          const linesAll = pageItems.map((it) => {
            const prefix = `[${it.rarity}] - `;
            const title = escapeMarkdown(it.displayName);
            return `${prefix}[${title}](${it.imageUrl}) - #${it.countAfter}`;
          });

          let descriptionAll = linesAll.join('\n');
          const MAX_DESC = 4096;
          if (descriptionAll.length > MAX_DESC) {
            const truncated = descriptionAll.slice(0, MAX_DESC - 80);
            const lastNl = truncated.lastIndexOf('\n');
            const visible = lastNl > 0 ? truncated.slice(0, lastNl) : truncated;
            const visibleCount = visible.split('\n').filter(Boolean).length;
            const omitted = linesAll.length - visibleCount;
            descriptionAll = `${visible}\n...and ${omitted} more`;
          }

          resultState = {
            type: 'gacha',
            item,
            pageItems,
            descriptionAll,
            costText,
            pageIndex: 0,
            canAgain: canAgainNow,
          };

          await interaction.editReply({
            embeds: [makeGachaEmbedAt(0)],
            components: makeResultRows(),
          });

          return;
        }

        // rewardgacha card-like results (normal card OR stream ticket)
        if (
          results?.kind === 'rewardgacha' &&
          (results.rewardType === 'card' || results.rewardType === 'streamticketcard')
        ) {
          const imageUrl = buildImageUrl(results.rarity, `${results.image}.png`);
          const titlePrefix =
            results.rewardType === 'streamticketcard'
              ? '🎉 Eggchange Reward: Stream Ticket!'
              : `🎉 Eggchange Reward: [${results.rarity}] ${escapeMarkdown(results.image)}`;

          const final = new EmbedBuilder()
            .setTitle(`${titlePrefix} - #${results.countAfter}`)
            .setDescription(
              results.rewardType === 'streamticketcard'
                ? `You rolled the **super rare Stream Ticket** reward!`
                : `You rolled a **card reward**!`,
            )
            .setColor(0x00BB88)
            .addFields({ name: 'Item', value: escapeMarkdown(item.name), inline: false })
            .addFields({ name: 'Cost Paid', value: costText, inline: false })
            .setImage(imageUrl)
            .setURL(imageUrl)
            .setFooter({ text: `Eggschange by: ${interaction.user.username}` });

          resultState = {
            type: 'single',
            item,
            canAgain: canAgainNow,
          };

          await interaction.editReply({ embeds: [final], components: makeResultRows() });
          return;
        }

        // rewardgacha non-card results
        if (results?.kind === 'rewardgacha') {
          const final = new EmbedBuilder()
            .setTitle('✅ Eggschange Complete!')
            .setColor(Colors.Green)
            .addFields({ name: 'Item', value: escapeMarkdown(item.name), inline: false })
            .addFields({ name: 'Cost Paid', value: costText, inline: false });

          if (results.rewardType === 'fans') {
            final.addFields({ name: '👥 Fans Gained', value: `+${results.amount}`, inline: true });
            final.addFields({ name: 'Total Fans', value: `${results.newTotal ?? 0}`, inline: true });
          } else if (results.rewardType === 'eventpulls') {
            final.addFields({ name: '🎟️ Event Pulls Gained', value: `+${results.amount}`, inline: true });
            final.addFields({ name: 'Total Event Pulls', value: `${results.newTotal ?? 0}`, inline: true });
          }

          if (item.banner?.rarity && item.banner?.image) {
            final.setImage(buildImageUrl(item.banner.rarity, `${item.banner.image}.png`));
          }

          resultState = {
            type: 'single',
            item,
            canAgain: canAgainNow,
          };

          await interaction.editReply({ embeds: [final], components: makeResultRows() });
          return;
        }

        // Non-gacha (single embed)
        const final = new EmbedBuilder()
          .setTitle('✅ Eggschange Complete!')
          .setColor(Colors.Green)
          .addFields({ name: 'Item', value: escapeMarkdown(item.name), inline: false })
          .addFields({ name: 'Cost Paid', value: costText, inline: false });

        if (results?.kind === 'eventpulls') {
          final.addFields({ name: '🎟️ Event Pulls Gained', value: `+${results.amount}`, inline: true });
          final.addFields({ name: 'Total Event Pulls', value: `${results.newTotal ?? 0}`, inline: true });
        } else if (results?.kind === 'fans') {
          final.addFields({ name: '👥 Fans Gained', value: `+${results.amount}`, inline: true });
          final.addFields({
            name: 'Total Fans',
            value: `${results.newTotal ?? (resultUser?.points ?? 0)}`,
            inline: true,
          });
        }

        if (item.banner?.rarity && item.banner?.image) {
          final.setImage(buildImageUrl(item.banner.rarity, `${item.banner.image}.png`));
        }

        resultState = {
          type: 'single',
          item,
          canAgain: canAgainNow,
        };

        await interaction.editReply({ embeds: [final], components: makeResultRows() });
      } catch (err) {
        console.error('eggschange exchange error:', err);

        const msg = String(err?.message || '');
        if (msg.startsWith('MISSING_COST::')) {
          const missingText = msg.replace('MISSING_COST::', '');
          const fail = new EmbedBuilder()
            .setTitle('❌ Eggschange Failed')
            .setDescription('You do not have enough eggs for this eggschange.')
            .addFields({ name: 'Missing', value: missingText.slice(0, 1000), inline: false })
            .setColor(Colors.Red);

          // keep the user in menu after failure? show result-style with Back
          resultState = {
            type: 'single',
            item,
            canAgain: false,
          };

          await interaction.editReply({ embeds: [fail], components: makeResultRows() });
          return;
        }

        const fail = new EmbedBuilder()
          .setTitle('❌ Eggschange Failed')
          .setDescription('An internal error occurred. Please try again later.')
          .setColor(Colors.Red);

        resultState = {
          type: 'single',
          item,
          canAgain: false,
        };

        await interaction.editReply({ embeds: [fail], components: makeResultRows() });
      } finally {
        isProcessing = false;
      }
    }
  },
};