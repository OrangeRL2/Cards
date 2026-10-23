const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const User = require('../../models/User');
const Oshi = require('../../models/Oshi');
const PullQuota = require('../../models/PullQuota');
const BurnLog = require('../../models/BurnLog');
const { xpForCard, xpToNextForLevel, isValidRarity, RARITY_XP } = require('../../utils/leveling');
const { getAllEnabledMilestones, milestonesForLevel } = require('../../utils/milestones');

const IMAGE_POOL_ROOT = path.join(__dirname, '..', '..', 'assets', 'images', 'oshi');

function resolvePoolPath(poolFolder) {
  if (!poolFolder) return IMAGE_POOL_ROOT;
  if (poolFolder.startsWith('../') || poolFolder.startsWith('./')) {
    const projectRoot = path.join(__dirname, '..', '..');
    return path.resolve(projectRoot, poolFolder);
  }
  return path.join(IMAGE_POOL_ROOT, poolFolder);
}

function pickRandomCardFromOshiPool(poolFolder) {
  const poolPath = resolvePoolPath(poolFolder);
  let allFiles = [];
  try {
    if (!fs.existsSync(poolPath)) return null;
    const items = fs.readdirSync(poolPath, { withFileTypes: true });
    const subdirs = items.filter(d => d.isDirectory());
    const filesInRoot = items.filter(f => f.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(f.name));

    if (filesInRoot.length > 0) {
      allFiles.push(...filesInRoot.map(f => ({
        file: f.name,
        rarity: path.basename(poolPath).toUpperCase(),
        fullPath: path.join(poolPath, f.name)
      })));
    }

    if (subdirs.length > 0) {
      for (const subdir of subdirs) {
        try {
          const subdirPath = path.join(poolPath, subdir.name);
          const files = fs.readdirSync(subdirPath)
            .filter(f => /\.(png|jpe?g|webp|gif)$/i.test(f))
            .map(f => ({
              file: f,
              rarity: subdir.name.toUpperCase(),
              fullPath: path.join(subdirPath, f)
            }));
          allFiles.push(...files);
        } catch {}
      }
    }
  } catch { return null; }

  if (allFiles.length === 0) return null;
  const randomFile = allFiles[Math.floor(Math.random() * allFiles.length)];
  return { pick: randomFile.file, rarityFolder: randomFile.rarity, fullPath: randomFile.fullPath };
}

function parseMultiFilter(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();
  const m = s.match(/^([<>]=?|=)?\s*(\d+)$/);
  if (!m) return null;
  const op = m[1] || '=';
  const n = parseInt(m[2], 10);
  return { op, n };
}

function parseRarities(rarityString) {
  if (!rarityString) return [];
  const rarities = rarityString.split(/[,;\s]+/).map(r => r.trim().toUpperCase()).filter(r => r);
  return rarities.filter(r => isValidRarity(r));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('burn')
    .setDescription('Burn many cards at once with filters (skips locked cards).')
    .addStringOption(opt => opt.setName('rarity').setDescription('Rarities to burn (C,U,R,S,P,SEC) - separate with commas').setRequired(true))
    .addStringOption(opt => opt.setName('multi').setDescription('Multi filter, e.g. ">3", ">=2", "3"').setRequired(false)),
  requireOshi: true,

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: false });
    const userId = interaction.user.id;

    const rarityRaw = (interaction.options.getString('rarity') || '').trim();
    const rarities = parseRarities(rarityRaw);
    const multiRaw = interaction.options.getString('multi') || null;
    const multiFilter = parseMultiFilter(multiRaw);

    if (rarities.length === 0) {
      await interaction.editReply({ content: `No valid rarities specified. Valid: ${Object.keys(RARITY_XP).join(', ')}` });
      return;
    }

    const userDoc = await User.findOne({ id: userId }).lean().exec();
    if (!userDoc) {
      await interaction.editReply({ content: 'User not found.' });
      return;
    }
    
    function computeBurnCount(stackCount, multiFilter) {
      if (!multiFilter) return stackCount;
      const { op, n } = multiFilter;
      if (op === '>' || op === '>=') return stackCount > n ? stackCount - n : 0;
      if (op === '<' || op === '<=') return (op === '<' ? stackCount < n : stackCount <= n) ? stackCount : 0;
      if (op === '=' || op === undefined) return stackCount >= n ? n : 0;
      return 0;
    }

    const cards = userDoc.cards || [];
    const offers = [];
    for (const c of cards) {
      if (c.locked) continue;
      const cR = String(c.rarity || '').toUpperCase();
      if (!rarities.includes(cR)) continue;
      const cnt = Number(c.count || 0);
      if (cnt <= 0) continue;

      const burnCount = computeBurnCount(cnt, multiFilter);
      if (!burnCount) continue;

      const xp = xpForCard(cR, burnCount);
      offers.push({ name: c.name, rarity: cR, originalCount: cnt, count: burnCount, xp });
    }

    const totalCards = offers.reduce((s, o) => s + (o.count || 0), 0);
    const totalXp = offers.reduce((s, o) => s + (o.xp || 0), 0);

    const preview = new EmbedBuilder()
      .setTitle('Mass Burn Preview')
      .setDescription(`This will burn **${totalCards}** cards for **${totalXp} XP**.`)
      .addFields(
        { name: 'Filters', value: `rarities: ${rarities.join(', ')}\nmulti: ${multiRaw || 'any'}`, inline: false },
        { name: 'Sample', value: offers.slice(0, 10).map(o => `• [${o.rarity}] ${o.name} x${o.count} — ${o.xp} XP`).join('\n') || 'No cards match the criteria', inline: false }
      )
      .setColor(0xFFAA00);

    if (offers.length === 0) {
      await interaction.editReply({ embeds: [preview], content: 'No cards match the specified criteria.' });
      return;
    }

    const confirmId = `massburn_confirm_${interaction.id}_${Date.now()}`;
    const cancelId = `massburn_cancel_${interaction.id}_${Date.now()}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(confirmId).setLabel('Confirm Burn').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ embeds: [preview], components: [row] });

    const sent = await interaction.fetchReply();
    const collector = sent.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60_000,
      filter: b => b.user.id === userId && (b.customId === confirmId || b.customId === cancelId)
    });

    collector.on('collect', async btn => {
      if (btn.customId === cancelId) {
        try { await btn.reply({ content: 'Mass burn cancelled.', ephemeral: true }); } catch {}
        collector.stop('cancelled');
        try { await sent.edit({ components: [] }); } catch {}
        return;
      }

      try { await btn.deferReply({ ephemeral: true }); } catch {}

      const sessionDb = await mongoose.startSession();
      sessionDb.startTransaction();
      try {
        const userDocTx = await User.findOne({ id: userId }).session(sessionDb).exec();
        if (!userDocTx) throw new Error('User missing');

        const offersTx = [];
        for (const o of offers) {
          const idx = (userDocTx.cards || []).findIndex(c => String(c.name) === String(o.name) && String(c.rarity || '').toUpperCase() === String(o.rarity).toUpperCase());
          if (idx === -1) continue;
          const card = userDocTx.cards[idx];
          const available = Number(card.count || 0);
          const requested = o.count;
          if (available < requested) throw new Error(`Insufficient ${o.name}: have ${available}, need ${requested}`);
          offersTx.push({ name: o.name, rarity: o.rarity, count: requested, xp: o.xp });
        }

        if (!offersTx.length) throw new Error('No valid offers to burn after re-check');

        for (const offer of offersTx) {
          const idx = (userDocTx.cards || []).findIndex(c => String(c.name) === String(offer.name) && String(c.rarity || '').toUpperCase() === String(offer.rarity).toUpperCase());
          if (idx === -1) continue;
          const card = userDocTx.cards[idx];
          card.count = (card.count || 0) - offer.count;
          if (card.count <= 0) {
            userDocTx.cards.splice(idx, 1);
          }
        }
        userDocTx.markModified('cards');

        const oshi = await Oshi.findOne({ userId }).session(sessionDb).exec();
        if (!oshi) throw new Error('Oshi missing');

        const totalXpTx = offersTx.reduce((s, o) => s + (o.xp || 0), 0);
        oshi.xp = (oshi.xp || 0) + totalXpTx;
        oshi.xpToNext = oshi.xpToNext ?? xpToNextForLevel(oshi.level || 1);

        const allMilestones = await getAllEnabledMilestones();
        const awardedMilestones = [];
        const awardedCards = [];
        let totalEventPulls = 0;
        let levelsGained = 0;

        while (oshi.xp >= (oshi.xpToNext ?? xpToNextForLevel(oshi.level))) {
          const need = oshi.xpToNext || xpToNextForLevel(oshi.level);
          oshi.xp -= need;
          oshi.level = (oshi.level ?? 0) + 1;
          oshi.xpToNext = xpToNextForLevel(oshi.level);
          oshi.lastLeveledAt = new Date();
          levelsGained += 1;

          const toGrant = milestonesForLevel(allMilestones, oshi.oshiId, oshi.level, oshi.awards || []);
          for (const m of toGrant) {
            awardedMilestones.push(m);
            oshi.awardsHistory = oshi.awardsHistory || [];
            oshi.awardCounts = oshi.awardCounts || {};
            oshi.awardsHistory.push({
              milestoneId: String(m._id),
              level: oshi.level,
              awardedAt: new Date(),
              awardType: m.awardType,
              awardValue: m.awardValue
            });
            oshi.awardCounts[String(m._id)] = (oshi.awardCounts[String(m._id)] || 0) + 1;
            if (m.oneTime) {
              oshi.awards = oshi.awards || [];
              if (!oshi.awards.includes(String(m._id))) oshi.awards.push(String(m._id));
            }
          }
        }

        for (const m of awardedMilestones) {
          if (m.awardType === 'eventPulls') {
            const n = Number(m.awardValue || 0);
            if (n > 0) totalEventPulls += n;
          } else if (m.awardType === 'card') {
            const poolFolder = (m.awardValue && m.awardValue.poolFolder) || oshi.oshiId;
            const pickResult = pickRandomCardFromOshiPool(poolFolder);
            if (!pickResult) continue;
            const pick = pickResult.pick;
            const chosenRarityFolder = pickResult.rarityFolder;
            const raw = path.basename(pick, path.extname(pick));
            const displayName = raw.replace(/[_-]+/g, ' ').trim();
            const awardCount = Number((m.awardValue && m.awardValue.count) || 1);
            const awardRarity = String(chosenRarityFolder).toUpperCase();
            const storedPath = path.join(poolFolder, chosenRarityFolder, pick);

            userDocTx.cards = userDocTx.cards || [];
            const existing = userDocTx.cards.find(x => String(x.name) === displayName && String(x.rarity || '').toUpperCase() === awardRarity);
            const now = new Date();
            if (existing) {
              existing.count = (existing.count || 0) + awardCount;
              existing.lastAcquiredAt = now;
            } else {
              userDocTx.cards.push({
                name: displayName,
                rarity: awardRarity,
                count: awardCount,
                sourceFile: storedPath,
                firstAcquiredAt: now,
                lastAcquiredAt: now
              });
            }
            userDocTx.markModified('cards');
            awardedCards.push({ name: displayName, rarity: awardRarity, count: awardCount, file: storedPath });
          }
        }

        if (totalEventPulls > 0) {
          await PullQuota.findOneAndUpdate(
            { userId },
            { $inc: { eventPulls: totalEventPulls } },
            { upsert: true, new: true, session: sessionDb }
          );
        }

        await userDocTx.save({ session: sessionDb });
        await oshi.save({ session: sessionDb });

        const awardedCardsDescription = awardedCards.map(a => `[${a.rarity}] ${a.name} x${a.count}`).join(', ');
        const truncatedAwardedCards = awardedCardsDescription.length > 1024 ? awardedCardsDescription.substring(0, 1020) + '...' : awardedCardsDescription;

        await BurnLog.create([{
          userId,
          oshiId: oshi.oshiId,
          burned: offersTx.map(o => ({ name: o.name, rarity: o.rarity, count: o.count, xp: o.xp })),
          totalXp: totalXpTx,
          awardedMilestones: awardedMilestones.map(m => ({ id: String(m._id), awardType: m.awardType, awardValue: m.awardValue })),
          awardedCards: truncatedAwardedCards,
          timestamp: new Date()
        }], { session: sessionDb });

        await sessionDb.commitTransaction();
        sessionDb.endSession();

        const resultEmbed = new EmbedBuilder()
          .setTitle('Mass Burn Completed (Anniversary Progress)')
          .setColor(0x00BB88)
          .setDescription(`Burned **${offersTx.length}** card entries (${totalCards} total cards) for **${totalXpTx} XP**.`)
          .addFields(
            { name: 'Oshi', value: `${oshi.oshiId}`, inline: true },
            { name: 'Anniversary Year', value: `${oshi.level} ${levelsGained ? `(+${levelsGained})` : ''}`, inline: true },
            { name: 'Days until next anniversary', value: `${oshi.xp}/${oshi.xpToNext}`, inline: true },
            { name: 'Rarities burned', value: rarities.join(', '), inline: true }
          );

        if (totalEventPulls > 0) resultEmbed.addFields({ name: 'Event pulls awarded', value: `${totalEventPulls}`, inline: true });
        if (awardedCards.length) {
          const cardsText = awardedCards.map(a => `**[${a.rarity}]** ${a.name} x${a.count}`).join('\n');
          resultEmbed.addFields({ name: 'Cards awarded', value: cardsText.length > 1024 ? cardsText.substring(0, 1020) + '...' : cardsText, inline: false });
        }
        if (awardedMilestones.length) {
          const milestonesText = awardedMilestones.map(m => `${m.awardType}`).join('\n');
          resultEmbed.addFields({ name: 'Milestones', value: milestonesText.length > 1024 ? milestonesText.substring(0, 1020) + '...' : milestonesText, inline: false });
        }

        try { await sent.edit({ embeds: [resultEmbed], components: [] }); } catch {}
        try { await btn.editReply({ content: 'Mass Burn Completed (Anniversary Progress)', ephemeral: true }); } catch {}
        collector.stop('completed');
      } catch (err) {
        console.error('mass-burn finalize failed', err);
        try { await sessionDb.abortTransaction(); } catch {}
        sessionDb.endSession();
        try { await btn.editReply({ content: `Mass burn failed: ${err.message}`, ephemeral: true }); } catch {}
        try { await sent.edit({ components: [] }); } catch {}
        collector.stop('failed');
      }
    });

    collector.on('end', async () => {
      try { await sent.edit({ components: [] }); } catch {}
    });
  }
};