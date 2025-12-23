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
const User = require('../../models/User');

const sessions = new Map();

// ---------- Safe helpers ----------
async function safeDefer(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
  } catch (err) {
    console.warn('safeDefer failed (maybe expired):', err?.code ?? err);
  }
}

async function safeReplyAndFetch(interaction, payload) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.reply(payload);
    } else if (interaction.deferred && !interaction.replied) {
      await interaction.editReply(payload);
    } else {
      await interaction.followUp(payload);
    }

    try {
      return await interaction.fetchReply();
    } catch (fetchErr) {
      console.warn('fetchReply failed; interactive features will be skipped:', fetchErr?.code ?? fetchErr);
      return null;
    }
  } catch (err) {
    console.warn('safe initial reply failed (interaction likely expired):', err?.code ?? err);
    return null;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Propose a trade (both must accept)')
    .addUserOption(opt =>
      opt.setName('user')
         .setDescription('Who to trade with')
         .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('card')
         .setDescription('Card name prefix to offer')
         .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('rarity')
         .setDescription('Rarity of the offered card (required)')
         .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('count')
         .setDescription('How many cards to offer')
         .setRequired(true)
    ),

  async execute(interaction) {
    await safeDefer(interaction);

    const fromId = interaction.user.id;
    const toUser = interaction.options.getUser('user');
    const toId = toUser.id;
    const partial = interaction.options.getString('card').toLowerCase();
    const tradeCount = interaction.options.getInteger('count');
    const rarityReq = String(interaction.options.getString('rarity') ?? '').toLowerCase();
    const rarityDisplay = String(interaction.options.getString('rarity') ?? '').toUpperCase();

    if (toId === fromId) {
      return interaction.followUp?.({ content: "You can’t trade with yourself.", ephemeral: true }) ?? null;
    }
    if (tradeCount < 1) {
      return interaction.followUp?.({ content: "Count must be at least 1.", ephemeral: true }) ?? null;
    }

    // Load sender inventory
    const fromDoc = await User.findOne({ id: fromId }).exec();
    if (!fromDoc || !Array.isArray(fromDoc.cards) || fromDoc.cards.length === 0) {
      return interaction.followUp?.({ content: "You have no cards.", ephemeral: true }) ?? null;
    }

    // Find matching card (prefix + rarity)
    const fromIdx = fromDoc.cards.findIndex(c =>
      String(c.name).toLowerCase().startsWith(partial) &&
      String(c.rarity || '').toLowerCase() === rarityReq &&
      !c.locked
    );

    if (fromIdx === -1) {
      return interaction.followUp?.({
        content: `No card starts with "${partial}" and rarity "${interaction.options.getString('rarity')}".`,
        ephemeral: true
      }) ?? null;
    }

    const cardEntry = fromDoc.cards[fromIdx];
    // ADD THIS CHECK
    if (cardEntry.locked) {
      return interaction.followUp?.({ 
        content: `**[${cardEntry.rarity}] ${cardEntry.name}** is locked! Use \`/lock\` to unlock it first.`, 
        ephemeral: true 
      }) ?? null;
    }
    const cardName = cardEntry.name;
    const cardRarity = String(cardEntry.rarity ?? '').toUpperCase();
    const cardAvailable = cardEntry.count || 0;

    if (cardAvailable < tradeCount) {
      return interaction.followUp?.({ content: `You only have ${cardAvailable} × ${cardName}.`, ephemeral: true }) ?? null;
    }

    const embedBase = new EmbedBuilder()
      .setTitle('🔄 Trade Proposal')
      .setColor(Colors.Gold)
      .setFooter({ text: 'This trade expires in 5 minutes.' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('trade_add').setLabel('➕ Add Card').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('trade_accept').setLabel('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('trade_reject').setLabel('❌').setStyle(ButtonStyle.Danger)
    );

    const message = await safeReplyAndFetch(interaction, {
      content: `<@${toId}>, you have a trade request:`,
      embeds: [EmbedBuilder.from(embedBase).setDescription('Preparing trade...')],
      components: [row]
    });

    if (!message) {
      try { await interaction.followUp({ content: 'Could not start interactive trade (interaction expired). Please try again.', ephemeral: true }); } catch {}
      return;
    }

    function buildDescription(session) {
      const fromMark = session.accepted?.[session.fromId] ? '✅' : '❌';
      const toMark = session.accepted?.[session.toId] ? '✅' : '❌';

      const senderOffer = (session.offers[session.fromId] || [])
        .map(o => `• ${o.count} x **[${String(o.rarity ?? '').toUpperCase()}] ${o.name}**`)
        .join('\n') || 'None';

      const recipientOffer = (session.offers[session.toId] || [])
        .map(o => `• ${o.count} x **[${String(o.rarity ?? '').toUpperCase()}] ${o.name}**`)
        .join('\n') || 'None';

      return (
        `**From:** <@${session.fromId}> ${fromMark}\n` +
        `**To:**   <@${session.toId}> ${toMark}\n\n` +
        `**Sender offers:**\n${senderOffer}\n\n` +
        `**Recipient offers:**\n${recipientOffer}\n\n` +
        `Both parties must press ✅ to confirm.`
      );
    }

    // Initialize session
    const session = {
      messageId: message.id,
      fromId,
      toId,
      offers: {
        [fromId]: [{ name: cardName, count: tradeCount, rarity: cardRarity }],
        [toId]: []
      },
      accepted: { [fromId]: false, [toId]: false },
      embedBase,
      finalizing: false
    };

    sessions.set(message.id, session);

    // Immediately set the real description
    try {
      const initial = EmbedBuilder.from(session.embedBase).setDescription(buildDescription(session));
      session.embedBase = initial;
      await message.edit({ embeds: [initial] });
    } catch (e) {
      console.warn('failed to set initial session embed description', e);
    }

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 5 * 60 * 1000
    });

    collector.on('collect', async btn => {
      const session = sessions.get(message.id);
      if (!session) {
        try { await btn.reply({ content: 'This trade is no longer valid.', ephemeral: true }); } catch {}
        return;
      }

      const userId = btn.user.id;
      if (![session.fromId, session.toId].includes(userId)) {
        try { await btn.reply({ content: 'You are not part of this trade.', ephemeral: true }); } catch {}
        return;
      }

      // ---- Add card via modal ----
      if (btn.customId === 'trade_add') {
        // Important: do NOT defer or reply on the button before showing the modal
        const modalId = `trade_add_modal_${message.id}_${userId}`;
        const modal = new ModalBuilder().setCustomId(modalId).setTitle('Add a Card to Trade');

        const nameInput = new TextInputBuilder().setCustomId('trade_card').setLabel('Card name or prefix').setStyle(TextInputStyle.Short).setRequired(true);
        const countInput = new TextInputBuilder().setCustomId('trade_count').setLabel('How many?').setStyle(TextInputStyle.Short).setRequired(true);
        const rarityInput = new TextInputBuilder().setCustomId('trade_rarity').setLabel('Rarity').setStyle(TextInputStyle.Short).setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(nameInput), new ActionRowBuilder().addComponents(rarityInput), new ActionRowBuilder().addComponents(countInput));

        try {
          await btn.showModal(modal);
        } catch (err) {
          console.error('showModal failed', err);
          try { await btn.reply({ content: 'Failed to open modal.', ephemeral: true }); } catch {}
          return;
        }

        try {
          const submitted = await btn.awaitModalSubmit({
            filter: i => i.customId === modalId && i.user.id === userId,
            time: 60_000
          });

          const nameVal = submitted.fields.getTextInputValue('trade_card');
          const countVal = parseInt(submitted.fields.getTextInputValue('trade_count'), 10);
          const rarityVal = String(submitted.fields.getTextInputValue('trade_rarity') ?? '').toLowerCase();

          if (!nameVal || isNaN(countVal) || countVal < 1) {
            try { await submitted.reply({ content: '❌ Invalid input.', ephemeral: true }); } catch {}
            return;
          }

          // Fetch fresh user doc for validation
          const doc = await User.findOne({ id: userId }).exec();
          if (!doc || !Array.isArray(doc.cards) || doc.cards.length === 0) {
            try { await submitted.reply({ content: '❌ You have no cards.', ephemeral: true }); } catch {}
            return;
          }

          const idx = doc.cards.findIndex(c =>
            String(c.name).toLowerCase().startsWith(nameVal.toLowerCase()) &&
            String(c.rarity || '').toLowerCase() === rarityVal &&
            !c.locked
          );

          if (idx === -1) {
            try { await submitted.reply({ content: `❌ No card matching "${nameVal}" with rarity "${submitted.fields.getTextInputValue('trade_rarity')}".`, ephemeral: true }); } catch {}
            return;
          }

          // Fixed: prevent duplicate/over-offer by checking already-offered total and merging offers
          const c = doc.cards[idx];
          if (c.locked) {
            try { await submitted.reply({ content: `❌ **[${c.rarity}] ${c.name}** is locked! Use \`/lock\` to unlock it first.`, ephemeral: true }); } catch {}
            return;
          }
          const existingOffered = (session.offers[userId] || [])
            .filter(o => String(o.name).toLowerCase() === String(c.name).toLowerCase()
                      && String(o.rarity || '').toLowerCase() === String(c.rarity || '').toLowerCase())
            .reduce((sum, o) => sum + (o.count || 0), 0);

          if ((c.count || 0) < existingOffered + countVal) {
            try { await submitted.reply({ content: `❌ You only have ${c.count || 0} × ${c.name}. You already offered ${existingOffered}.`, ephemeral: true }); } catch {}
            return;
          }

          session.offers[userId] = session.offers[userId] || [];

          const sameIdx = session.offers[userId].findIndex(o =>
            String(o.name).toLowerCase() === String(c.name).toLowerCase() &&
            String(o.rarity || '').toLowerCase() === String(c.rarity || '').toLowerCase()
          );

          if (sameIdx !== -1) {
            session.offers[userId][sameIdx].count = (session.offers[userId][sameIdx].count || 0) + countVal;
          } else {
            session.offers[userId].push({ name: c.name, count: countVal, rarity: String(c.rarity ?? '').toUpperCase() });
          }

          // reset both accepts
          session.accepted[session.fromId] = false;
          session.accepted[session.toId] = false;

          // update embed
          const newEmbed = EmbedBuilder.from(session.embedBase).setDescription(buildDescription(session));
          session.embedBase = newEmbed;
          await message.edit({ embeds: [newEmbed] }).catch(e => console.warn('failed to edit message', e));
          // reset the collector timer so the trade expires 5 minutes after the last add
          try { collector.resetTimer(); } catch (e) { console.warn('failed to reset collector timer', e); }
          try { await submitted.reply({ content: '✅ Card added to the trade!', ephemeral: true }); } catch {}
        } catch (e) {
          console.error('awaitModalSubmit failed or timed out', e);
          try { await btn.followUp({ content: 'Modal timed out or failed.', ephemeral: true }); } catch {}
        }
        return;
      }

      // ---- Accept ----
      if (btn.customId === 'trade_accept') {
        // mark acceptance and attempt finalization if both accepted
        session.accepted[userId] = true;
        try { await btn.deferUpdate(); } catch (e) { /* ignore */ }

        // update embed to show acceptance marks
        try {
          const updated = EmbedBuilder.from(session.embedBase).setDescription(buildDescription(session));
          session.embedBase = updated;
          await message.edit({ embeds: [updated] }).catch(e => console.warn('failed to edit message', e));
        } catch (e) {
          console.warn('failed to update acceptance display', e);
        }

        // Finalize when both have accepted
        if (session.accepted[session.fromId] && session.accepted[session.toId]) {
          // guard against concurrent finalizations
          if (session.finalizing) return;
          session.finalizing = true;

          // disable components immediately to avoid more clicks
          try { await message.edit({ components: [] }); } catch (e) {}

          // Re-fetch docs and validate availability one last time
          let fromDocFinal = await User.findOne({ id: session.fromId }).exec();
          let toDocFinal = await User.findOne({ id: session.toId }).exec();

          fromDocFinal = fromDocFinal || new User({ id: session.fromId, cards: [] });
          toDocFinal = toDocFinal || new User({ id: session.toId, cards: [] });

          const insufficient = [];
          const checkOffers = (sourceDoc, offerArray) => {
            for (const offer of offerArray || []) {
              const s = (sourceDoc.cards || []).find(x =>
                x.name === offer.name &&
                String(x.rarity || '').toLowerCase() === String(offer.rarity || '').toLowerCase()
              );
              if (!s || (s.count || 0) < offer.count) {
                insufficient.push({ userId: sourceDoc.id, name: offer.name, have: s ? s.count || 0 : 0, need: offer.count });
              }
            }
          };

          checkOffers(fromDocFinal, session.offers[session.fromId]);
          checkOffers(toDocFinal, session.offers[session.toId]);

          if (insufficient.length) {
            const msg = `Trade aborted: insufficient cards for the following entries: ${insufficient.map(i => `<@${i.userId}>: ${i.have}/${i.need} ${i.name}`).join(', ')}`;
            try { await message.edit({ content: msg, embeds: [], components: [] }); } catch (e) {}
            sessions.delete(message.id);
            return;
          }

          // perform transfer
          const transfer = (sourceDoc, targetDoc, offerArray) => {
            for (const offer of offerArray || []) {
              // remove from source
              const sIdx = (sourceDoc.cards || []).findIndex(x =>
                x.name === offer.name &&
                String(x.rarity || '').toLowerCase() === String(offer.rarity || '').toLowerCase()
              );
              if (sIdx !== -1) {
                sourceDoc.cards[sIdx].count = (sourceDoc.cards[sIdx].count || 0) - offer.count;
                if (sourceDoc.cards[sIdx].count <= 0) sourceDoc.cards.splice(sIdx, 1);
              }

              // add to target
              targetDoc.cards = targetDoc.cards || [];
              const tIdx = targetDoc.cards.findIndex(x =>
                x.name === offer.name &&
                String(x.rarity || '').toLowerCase() === String(offer.rarity || '').toLowerCase()
              );
              if (tIdx !== -1) {
                const card = targetDoc.cards[tIdx];
                card.count = (card.count || 0) + offer.count;
                card.firstAcquiredAt ??= now;
                card.lastAcquiredAt = now;
              } else {
      targetDoc.cards.push({
        name: offer.name,
        rarity: String(offer.rarity ?? '').toUpperCase(),
        count: offer.count,
        firstAcquiredAt: now,
        lastAcquiredAt: now,
      });
              }
            }
            sourceDoc.markModified('cards');
            targetDoc.markModified('cards');
          };

          try {
            transfer(fromDocFinal, toDocFinal, session.offers[session.fromId]);
            transfer(toDocFinal, fromDocFinal, session.offers[session.toId]);

            // Save both docs (ensure created docs are saved)
            await Promise.all([fromDocFinal.save(), toDocFinal.save()]);

            try { await message.edit({ content: `Trade between <@${session.fromId}> and <@${session.toId}> has been completed!`, embeds: [], components: [] }); } catch (e) { console.warn('failed to finalize message edit', e); }
          } catch (err) {
            console.error('trade finalize error', err);
            try { await message.edit({ content: 'Trade failed due to server error. No changes were saved.', embeds: [], components: [] }); } catch (e) {}
          } finally {
            sessions.delete(message.id);
          }
        }
        return;
      }

      // ---- Reject ----
      if (btn.customId === 'trade_reject') {
        try { await message.edit({ content: '❌ Trade rejected.', embeds: [], components: [] }); } catch (e) {}
        sessions.delete(message.id);
        try { await btn.reply({ content: 'Trade rejected.', ephemeral: true }); } catch {}
        return;
      }
    });

    collector.on('end', async () => {
      if (sessions.has(message.id)) {
        try { await message.edit({ content: '⏰ Trade expired.', embeds: [], components: [] }); } catch (e) {}
        sessions.delete(message.id);
      }
    });
  }
};
