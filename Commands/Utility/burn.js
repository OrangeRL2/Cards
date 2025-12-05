// Commands/Utility/burn.js
const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const User = require('../../models/User');
const Oshi = require('../../models/Oshi');
const PullQuota = require('../../models/PullQuota');
const BurnLog = require('../../models/BurnLog');
const LevelMilestone = require('../../models/LevelMilestone');
const { xpForCard, xpToNextForLevel, isValidRarity, RARITY_XP } = require('../../utils/leveling');
const { getAllEnabledMilestones, milestonesForLevel } = require('../../utils/milestones');

const IMAGE_POOL_ROOT = path.join(__dirname, '..', '..', 'images'); // adjust if needed

// In-memory sessions map for interactive burn flows
const sessions = new Map();

function buildControlRow(customIdPrefix, disableAll = false) {
  const add = new ButtonBuilder().setCustomId(`${customIdPrefix}_add`).setLabel('➕ Add').setStyle(ButtonStyle.Primary).setDisabled(disableAll);
  const remove = new ButtonBuilder().setCustomId(`${customIdPrefix}_remove`).setLabel('↩ Remove Last').setStyle(ButtonStyle.Secondary).setDisabled(disableAll);
  const confirm = new ButtonBuilder().setCustomId(`${customIdPrefix}_confirm`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success).setDisabled(disableAll);
  const cancel = new ButtonBuilder().setCustomId(`${customIdPrefix}_cancel`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger).setDisabled(disableAll);
  return new ActionRowBuilder().addComponents(add, remove, confirm, cancel);
}

async function buildPreviewEmbed(session) {
  const { userId, oshiId, offers } = session;
  const totalXp = offers.reduce((s, o) => s + (o.xp || 0), 0);
  const oshiDoc = await Oshi.findOne({ userId }).lean().exec();
  const level = oshiDoc?.level || 1;
  const xp = oshiDoc?.xp || 0;
  const xpToNext = oshiDoc?.xpToNext || xpToNextForLevel(level);

  const allMilestones = await getAllEnabledMilestones();
  const nextLevel = level + 1;
  const nextMilestones = milestonesForLevel(allMilestones, oshiId, nextLevel, oshiDoc?.awards || []);

  const embed = new EmbedBuilder()
    .setTitle('Burn Preview')
    .setColor(0x00AAFF)
    .setDescription(offers.length ? offers.map((o, i) => `**${i + 1}.** [${o.rarity}] ${o.name} x${o.count} — ${o.xp} XP`).join('\n') : 'No cards added yet.')
    .addFields(
      { name: 'Total XP to gain', value: `${totalXp}`, inline: true },
      { name: 'Oshi level', value: `${level}`, inline: true },
      { name: 'Oshi XP', value: `${xp}/${xpToNext}`, inline: true },
    );

  if (nextMilestones.length) {
    embed.addFields({ name: `Next level rewards (level ${nextLevel})`, value: nextMilestones.map(m => {
      if (m.awardType === 'eventPulls') return `Event pulls: ${m.awardValue}`;
      if (m.awardType === 'card') {
        const pool = (m.awardValue && m.awardValue.poolFolder) || oshiId;
        const cnt = (m.awardValue && m.awardValue.count) || 1;
        const rar = (m.awardValue && m.awardValue.rarityFilter) ? ` rarity ${m.awardValue.rarityFilter}` : '';
        return `Card x${cnt} from pool ${pool}${rar}`;
      }
      return `${m.awardType}: ${JSON.stringify(m.awardValue)}`;
    }).join('\n'), inline: false });
  } else {
    embed.addFields({ name: `Next level rewards (level ${nextLevel})`, value: 'None', inline: false });
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('burn')
    .setDescription('Burn cards to give XP to your oshi using an interactive UI'),
  requireOshi: true,

  async execute(interaction) {
    const userId = interaction.user.id;

    // Ensure oshi exists
    const oshiDoc = await Oshi.findOne({ userId }).exec();
    if (!oshiDoc) {
      await interaction.reply({ content: 'You have not chosen an oshi yet.', ephemeral: true });
      return;
    }

    // Create session
    const uid = `${interaction.id}_${Date.now()}`;
    const customPrefix = `burn_${uid}`;
    const session = {
      messageId: null,
      userId,
      oshiId: oshiDoc.oshiId,
      offers: [],
      totalXp: 0,
      finalizing: false,
    };
    sessions.set(uid, session);

    // Build initial preview and controls
    const previewEmbed = await buildPreviewEmbed(session);
    const controls = buildControlRow(customPrefix);

    // Send non-ephemeral message so collectors and edits work reliably
    await interaction.reply({ content: `<@${userId}> Burn session started`, embeds: [previewEmbed], components: [controls], ephemeral: false });
    const sent = await interaction.fetchReply();
    session.messageId = sent.id;
    sessions.delete(uid);
    sessions.set(sent.id, session);

    const collector = sent.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 5 * 60 * 1000,
      filter: btn => btn.user.id === userId && String(btn.customId).startsWith(customPrefix),
    });

    async function refreshPreview() {
      try {
        const s = sessions.get(sent.id);
        if (!s) return;
        const embed = await buildPreviewEmbed(s);
        const row = buildControlRow(customPrefix);
        await sent.edit({ embeds: [embed], components: [row] });
      } catch (err) {
        if (err?.code === 10008) {
          sessions.delete(sent.id);
          try { await interaction.followUp({ content: 'Your burn session ended unexpectedly (message missing). Please start a new session.', ephemeral: true }); } catch {}
          try { collector.stop('message_missing'); } catch {}
          return;
        }
        console.warn('refreshPreview failed', err);
      }
    }

    collector.on('collect', async btn => {
      const s = sessions.get(sent.id);
      if (!s) {
        try { await btn.reply({ content: 'Session expired.', ephemeral: true }); } catch {}
        return;
      }

      const action = btn.customId.slice(customPrefix.length + 1);

      if (action === 'add') {
        const modalId = `burn_add_modal_${sent.id}_${userId}_${Date.now()}`;
        const modal = new ModalBuilder().setCustomId(modalId).setTitle('Add card to burn');

        const nameInput = new TextInputBuilder().setCustomId('burn_card').setLabel('Card name or prefix').setStyle(TextInputStyle.Short).setRequired(true);
        const rarityInput = new TextInputBuilder().setCustomId('burn_rarity').setLabel('Rarity (C, U, R, S, P, SEC)').setStyle(TextInputStyle.Short).setRequired(true);
        const countInput = new TextInputBuilder().setCustomId('burn_count').setLabel('How many?').setStyle(TextInputStyle.Short).setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(nameInput),
          new ActionRowBuilder().addComponents(rarityInput),
          new ActionRowBuilder().addComponents(countInput)
        );

        try {
          await btn.showModal(modal);
        } catch (err) {
          console.error('showModal failed', err);
          try { await btn.reply({ content: 'Failed to open add modal.', ephemeral: true }); } catch {}
          return;
        }

        try {
          const submitted = await btn.awaitModalSubmit({
            filter: m => m.customId === modalId && m.user.id === userId,
            time: 60_000
          });

          const nameVal = submitted.fields.getTextInputValue('burn_card').trim();
          const rarityRaw = submitted.fields.getTextInputValue('burn_rarity') ?? '';
          const rarityVal = String(rarityRaw).toUpperCase().trim();
          const countVal = parseInt(submitted.fields.getTextInputValue('burn_count'), 10);

          // Validate rarity
          if (!isValidRarity(rarityVal)) {
            try {
              await submitted.reply({
                content: 'Invalid rarity. Valid rarities: ' + Object.keys(RARITY_XP).join(', '),
                ephemeral: true
              });
            } catch {}
            return;
          }

          if (!nameVal || !rarityVal || isNaN(countVal) || countVal < 1) {
            try { await submitted.reply({ content: 'Invalid input.', ephemeral: true }); } catch {}
            return;
          }

          const userDoc = await User.findOne({ id: userId }).lean().exec();
          if (!userDoc || !Array.isArray(userDoc.cards) || userDoc.cards.length === 0) {
            try { await submitted.reply({ content: 'You have no cards.', ephemeral: true }); } catch {}
            return;
          }

          const idx = (userDoc.cards || []).findIndex(c =>
            String(c.name).toLowerCase().startsWith(nameVal.toLowerCase()) &&
            String(c.rarity || '').toUpperCase() === rarityVal &&
            !c.locked
          );

          if (idx === -1) {
            try { await submitted.reply({ content: `No card starts with "${nameVal}" with rarity "${rarityVal}".`, ephemeral: true }); } catch {}
            return;
          }

          const card = userDoc.cards[idx];
          const available = Number(card.count || 0);
          const existingOffered = s.offers.filter(o => o.name.toLowerCase() === card.name.toLowerCase() && o.rarity === rarityVal).reduce((a, b) => a + (b.count || 0), 0);
          if (available < existingOffered + countVal) {
            try { await submitted.reply({ content: `You only have ${available} × ${card.name}. You already added ${existingOffered}.`, ephemeral: true }); } catch {}
            return;
          }

          // Compute entry XP and attach to offer
          const entryXp = xpForCard(rarityVal, countVal);
          if (entryXp === null) {
            try { await submitted.reply({ content: 'Invalid rarity', ephemeral: true }); } catch {}
            return;
          }

          s.offers.push({ name: card.name, rarity: rarityVal, count: countVal, xp: entryXp });
          s.totalXp = s.offers.reduce((sum, o) => sum + (o.xp || 0), 0);
          s.finalizing = false;

          await submitted.reply({ content: `Added ${countVal} × ${card.name} (${rarityVal}) — ${entryXp} XP`, ephemeral: true });
          await refreshPreview();
        } catch (err) {
          console.warn('awaitModalSubmit failed or timed out', err);
          try { await btn.followUp({ content: 'Add cancelled or timed out.', ephemeral: true }); } catch {}
        }
        return;
      }

      if (action === 'remove') {
        if (s.offers.length === 0) {
          try { await btn.reply({ content: 'Nothing to remove.', ephemeral: true }); } catch {}
          return;
        }
        const removed = s.offers.pop();
        s.totalXp = s.offers.reduce((sum, o) => sum + (o.xp || 0), 0);
        try { await btn.reply({ content: `Removed last added: ${removed.name} x${removed.count}`, ephemeral: true }); } catch {}
        await refreshPreview();
        return;
      }

      if (action === 'cancel') {
        sessions.delete(sent.id);
        try {
          await sent.edit({ content: '❌ Burn cancelled.', embeds: [], components: [] });
        } catch (e) {}
        try { await btn.reply({ content: 'Burn cancelled.', ephemeral: true }); } catch {}
        collector.stop('cancelled');
        return;
      }

      if (action === 'confirm') {
        if (s.offers.length === 0) {
          try { await btn.reply({ content: 'No cards added to burn.', ephemeral: true }); } catch {}
          return;
        }

        if (s.finalizing) {
          try { await btn.reply({ content: 'Already finalizing. Please wait.', ephemeral: true }); } catch {}
          return;
        }
        s.finalizing = true;

        try {
          const disabledRow = buildControlRow(customPrefix, true);
          await sent.edit({ components: [disabledRow] });
        } catch (e) {}

        const sessionDb = await mongoose.startSession();
        sessionDb.startTransaction();
        try {
          const userDoc = await User.findOne({ id: userId }).session(sessionDb).exec();
          if (!userDoc) throw new Error('User doc missing');

          // Re-validate offers and compute totalXp using stored offer.xp
          let totalXp = 0;
          for (const offer of s.offers) {
            const idx = (userDoc.cards || []).findIndex(c =>
              String(c.name) === String(offer.name) &&
              String(c.rarity || '').toUpperCase() === String(offer.rarity).toUpperCase()
            );
            if (idx === -1) throw new Error(`Missing card ${offer.name} ${offer.rarity}`);
            const card = userDoc.cards[idx];
            const available = Number(card.count || 0);
            const totalRequested = s.offers.filter(o => o.name === offer.name && o.rarity === offer.rarity).reduce((a, b) => a + (b.count || 0), 0);
            if (available < totalRequested) throw new Error(`Insufficient ${offer.name}: have ${available}, need ${totalRequested}`);

            // Use stored offer.xp (fallback to recompute if missing)
            const offerXp = (typeof offer.xp === 'number') ? offer.xp : xpForCard(offer.rarity, offer.count);
            if (offerXp === null) throw new Error('Invalid rarity in offer');
            totalXp += offerXp;
          }

          // Load oshi
          let oshi = await Oshi.findOne({ userId }).session(sessionDb).exec();
          if (!oshi) throw new Error('Oshi missing');

          // Apply burns to userDoc
          for (const offer of s.offers) {
            const idx = (userDoc.cards || []).findIndex(c =>
              String(c.name) === String(offer.name) &&
              String(c.rarity || '').toUpperCase() === String(offer.rarity).toUpperCase()
            );
            if (idx === -1) continue;
            userDoc.cards[idx].count = (userDoc.cards[idx].count || 0) - offer.count;
            if (userDoc.cards[idx].count <= 0) {
              userDoc.cards.splice(idx, 1);
            } else {
              userDoc.cards[idx].timestamps = userDoc.cards[idx].timestamps || [];
              userDoc.cards[idx].timestamps.push(new Date());
            }
          }
          userDoc.markModified('cards');

          // Add XP and level up
          oshi.xp = (oshi.xp || 0) + totalXp;
          oshi.xpToNext = oshi.xpToNext || xpToNextForLevel(oshi.level || 1);

          const allMilestones = await getAllEnabledMilestones();
          const awardedMilestones = [];
          const awardedCards = [];
          let totalEventPulls = 0;
          let levelsGained = 0;

          while (oshi.xp >= (oshi.xpToNext || xpToNextForLevel(oshi.level))) {
            const need = oshi.xpToNext || xpToNextForLevel(oshi.level);
            oshi.xp -= need;
            oshi.level = (oshi.level || 1) + 1;
            oshi.xpToNext = xpToNextForLevel(oshi.level);
            oshi.lastLeveledAt = new Date();
            levelsGained += 1;

            const toGrant = milestonesForLevel(allMilestones, oshi.oshiId, oshi.level, oshi.awards || []);
            for (const m of toGrant) {
              awardedMilestones.push(m);

              // ensure history and counts exist
              oshi.awardsHistory = oshi.awardsHistory || [];
              oshi.awardCounts = oshi.awardCounts || {};

              // record every award occurrence
              oshi.awardsHistory.push({
                milestoneId: String(m._id),
                level: oshi.level,
                awardedAt: new Date(),
                awardType: m.awardType,
                awardValue: m.awardValue
              });

              // increment a counter for this milestone
              oshi.awardCounts[String(m._id)] = (oshi.awardCounts[String(m._id)] || 0) + 1;

              // keep oneTime behavior for oshi.awards
              if (m.oneTime) {
                oshi.awards = oshi.awards || [];
                if (!oshi.awards.includes(String(m._id))) {
                  oshi.awards.push(String(m._id));
                }
              }
            }
          }

          // Apply awards
          for (const m of awardedMilestones) {
            if (m.awardType === 'eventPulls') {
              const n = Number(m.awardValue || 0);
              if (n > 0) totalEventPulls += n;
            } else if (m.awardType === 'card') {
              const poolFolder = (m.awardValue && m.awardValue.poolFolder) || oshi.oshiId;
              const poolPath = path.join(IMAGE_POOL_ROOT, poolFolder);
              let files = [];
              try {
                files = fs.readdirSync(poolPath).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
              } catch (e) {
                console.warn('Pool read failed', poolPath, e);
                files = [];
              }
              if (files.length === 0) {
                console.warn('No files in pool for', poolFolder);
                continue;
              }
              const pick = files[Math.floor(Math.random() * files.length)];
              const raw = path.basename(pick, path.extname(pick));
              const displayName = raw.replace(/[_-]+/g, ' ').trim();
              const awardCount = Number((m.awardValue && m.awardValue.count) || 1);
              const awardRarity = (m.awardValue && m.awardValue.rarityFilter) ? String(m.awardValue.rarityFilter).toUpperCase() : 'C';

              // Add or increment in userDoc
              userDoc.cards = userDoc.cards || [];
              const existing = userDoc.cards.find(x => String(x.name) === displayName && String(x.rarity || '').toUpperCase() === awardRarity);
              if (existing) {
                existing.count = (existing.count || 0) + awardCount;
                existing.timestamps = existing.timestamps || [];
                existing.timestamps.push(new Date());
              } else {
                userDoc.cards.push({
                  name: displayName,
                  rarity: awardRarity,
                  count: awardCount,
                  sourceFile: pick,
                  timestamps: [new Date()]
                });
              }
              userDoc.markModified('cards');
              awardedCards.push({ name: displayName, rarity: awardRarity, count: awardCount, file: pick });
              console.log('Awarded card', { userId, poolFolder, pick, displayName, awardRarity, awardCount });
            }
          }

          // Apply event pulls
          if (totalEventPulls > 0) {
            await PullQuota.findOneAndUpdate(
              { userId },
              { $inc: { eventPulls: totalEventPulls } },
              { upsert: true, new: true, session: sessionDb }
            );
          }

          // Save user and oshi
          await userDoc.save({ session: sessionDb });
          await oshi.save({ session: sessionDb });

          // Burn log
          await BurnLog.create([{
            userId,
            oshiId: oshi.oshiId,
            burned: s.offers.map(o => ({ name: o.name, rarity: o.rarity, count: o.count, xp: xpForCard(o.rarity, o.count) })),
            totalXp,
            awardedMilestones: awardedMilestones.map(m => ({ id: String(m._id), awardType: m.awardType, awardValue: m.awardValue })),
            awardedCards,
            timestamp: new Date()
          }], { session: sessionDb });

          await sessionDb.commitTransaction();
          sessionDb.endSession();

          // Finalize UI
          sessions.delete(sent.id);
          const resultEmbed = new EmbedBuilder()
            .setTitle('Burn Completed')
            .setColor(0x00BB88)
            .setDescription(`You burned ${s.offers.length} entries for **${totalXp} XP**.`)
            .addFields(
              { name: 'Oshi', value: `${oshi.oshiId}`, inline: true },
              { name: 'New level', value: `${oshi.level} ${levelsGained ? `(+${levelsGained})` : ''}`, inline: true },
              { name: 'XP (remaining)', value: `${oshi.xp}/${oshi.xpToNext}`, inline: true },
            );

          if (totalEventPulls > 0) resultEmbed.addFields({ name: 'Event pulls awarded', value: `${totalEventPulls}`, inline: true });
          if (awardedCards.length) resultEmbed.addFields({ name: 'Cards awarded', value: awardedCards.map(a => `${a.name} (${a.rarity}) x${a.count}`).join('\n'), inline: false });
          if (awardedMilestones.length) resultEmbed.addFields({ name: 'Milestones', value: awardedMilestones.map(m => `${m.awardType} @ level ${m.level}`).join('\n'), inline: false });

          try { await sent.edit({ content: '✅ Burn completed', embeds: [resultEmbed], components: [] }); } catch (e) {}
          try { await btn.reply({ content: 'Burn completed.', ephemeral: true }); } catch {}
          collector.stop('completed');
        } catch (err) {
          console.error('finalize burn failed', err);
          try { await sessionDb.abortTransaction(); } catch {}
          sessionDb.endSession();
          try {
            const row = buildControlRow(customPrefix);
            await sent.edit({ components: [row] });
          } catch (e) {}
          s.finalizing = false;
          try { await btn.reply({ content: `Burn failed: ${err.message}`, ephemeral: true }); } catch {}
        }
        return;
      }
    });

    collector.on('end', async (_collected, reason) => {
      if (sessions.has(sent.id)) sessions.delete(sent.id);
      try {
        const disabledRow = buildControlRow(customPrefix, true);
        await sent.edit({ components: [disabledRow] });
      } catch (e) {}
    });
  }
};
