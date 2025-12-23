// Commands/Utility/gift.js
const { SlashCommandBuilder } = require('discord.js');
const User = require('../../models/User');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gift')
    .setDescription('Give cards to another user (no acceptance needed)')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Who to send cards to')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Card name prefix to match (case-insensitive)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('rarity')
        .setDescription('Rarity of the card (use "any" or "all" to match any rarity)')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('count')
        .setDescription('How many cards to send (total across matches)')
        .setRequired(true)
    )
    .addBooleanOption(option =>
      option
        .setName('multi')
        .setDescription('If true, do not take the last copy from any matched stack')
        .setRequired(false)
    )
    .addBooleanOption(option =>
      option
        .setName('allowlocked')
        .setDescription('If true, include locked stacks in the matches (default: false)')
        .setRequired(false)
    ),

  requireOshi: true,

  async execute(interaction) {
    // Defer immediately to avoid "Unknown interaction" when processing takes time
    await interaction.deferReply({ ephemeral: false });

    try {
      const fromId = interaction.user.id;
      const toUser = interaction.options.getUser('user');
      const partialName = String(interaction.options.getString('card') || '').toLowerCase().trim();
      let sendCount = interaction.options.getInteger('count');
      const rarityOpt = (interaction.options.getString('rarity') || 'any').toLowerCase().trim();
      const multi = Boolean(interaction.options.getBoolean('multi'));
      const allowLocked = Boolean(interaction.options.getBoolean('allowlocked'));

      if (toUser.id === fromId) {
        return await interaction.editReply({ content: "You can’t trade with yourself." });
      }
      if (!partialName) {
        return await interaction.editReply({ content: "Card name prefix is required." });
      }
      if (!Number.isInteger(sendCount) || sendCount < 1) {
        return await interaction.editReply({ content: "Count must be at least 1." });
      }

      const fromDoc = await User.findOne({ id: fromId }).exec();
      if (!fromDoc || !Array.isArray(fromDoc.cards) || fromDoc.cards.length === 0) {
        return await interaction.editReply({ content: "You have no cards." });
      }

      const matchAnyRarity = rarityOpt === 'any' || rarityOpt === 'all' || rarityOpt === '';

      // Collect matching entries (prefix match, optional rarity)
      // Only include locked stacks when allowLocked === true
      const matches = fromDoc.cards
        .map((c, i) => ({ entry: c, idx: i }))
        .filter(({ entry }) => {
          if (entry.locked && !allowLocked) return false;

          const nameMatch = String(entry.name || '').toLowerCase().startsWith(partialName);
          if (!nameMatch) return false;
          if (!matchAnyRarity && String(entry.rarity || '').toLowerCase() !== rarityOpt) return false;

          const available = Number(entry.count || 0);
          if (multi) {
            return available > 1;
          }
          return available > 0;
        });

      if (!matches.length) {
        return await interaction.editReply({
          content: `No card in your inventory starts with "${partialName}"${matchAnyRarity ? '' : ` and rarity "${interaction.options.getString('rarity')}"`}.`
        });
      }

      // Sum available across matches (respecting multi rule: don't count the last copy)
      const totalAvailable = matches.reduce((sum, m) => {
        const available = Number(m.entry.count || 0);
        const availableForTake = multi ? Math.max(0, available - 1) : available;
        return sum + availableForTake;
      }, 0);

      if (totalAvailable <= 0) {
        const reason = multi ? 'You have no matching stacks with more than one copy (multi prevents taking the last copy).' : 'You have no available matching cards to send.';
        return await interaction.editReply({ content: reason });
      }

      // If requested more than available, send all available
      let partialSend = false;
      const requestedCount = sendCount;
      if (sendCount > totalAvailable) {
        partialSend = true;
        sendCount = totalAvailable;
      }

      // Build transfers: iterate matches and take from them until sendCount satisfied
      let remaining = sendCount;
      const transfers = []; // { name, rarity, amount, locked }
      // Sort matches to have deterministic behavior: by name then rarity
      matches.sort((a, b) => {
        const na = String(a.entry.name || '').localeCompare(String(b.entry.name || ''));
        if (na !== 0) return na;
        return String(a.entry.rarity || '').localeCompare(String(b.entry.rarity || ''));
      });

      for (const { entry } of matches) {
        if (remaining <= 0) break;
        const available = Number(entry.count || 0);
        const availableForTake = multi ? Math.max(0, available - 1) : available;
        if (availableForTake <= 0) continue;
        const take = Math.min(availableForTake, remaining);

        transfers.push({
          name: entry.name,
          rarity: entry.rarity,
          amount: take,
          locked: Boolean(entry.locked)
        });

        remaining -= take;
      }

      // Apply deductions to fromDoc.cards
      for (const t of transfers) {
        const curIdx = fromDoc.cards.findIndex(c => String(c.name) === String(t.name) && String(c.rarity || '') === String(t.rarity || ''));
        if (curIdx === -1) continue;
        const cardEntry = fromDoc.cards[curIdx];
        cardEntry.count = (Number(cardEntry.count) || 0) - t.amount;
        if (cardEntry.count <= 0) {
          fromDoc.cards.splice(curIdx, 1);
        } else {
          cardEntry.timestamps = cardEntry.timestamps || [];
          cardEntry.timestamps.push(new Date());
          fromDoc.cards[curIdx] = cardEntry;
        }
      }

      fromDoc.markModified('cards');
      await fromDoc.save();

      // Credit recipient: add each transferred card (aggregate by name+rarity)
      let toDoc = await User.findOne({ id: toUser.id }).exec();
      if (!toDoc) toDoc = new User({ id: toUser.id, cards: [] });

      for (const t of transfers) {
        const toIdx = toDoc.cards.findIndex(c => String(c.name) === String(t.name) && String(c.rarity || '') === String(t.rarity || ''));
        if (toIdx !== -1) {
          toDoc.cards[toIdx].count = (toDoc.cards[toIdx].count || 0) + t.amount;
          toDoc.cards[toIdx].timestamps = toDoc.cards[toIdx].timestamps || [];
          toDoc.cards[toIdx].timestamps.push(new Date());
          // Preserve locked state: if either existing or incoming is locked, keep locked = true
          toDoc.cards[toIdx].locked = Boolean(toDoc.cards[toIdx].locked) || Boolean(t.locked);
        } else {
          toDoc.cards.push({
            name: t.name,
            rarity: t.rarity,
            count: t.amount,
            timestamps: [new Date()],
            locked: Boolean(t.locked)
          });
        }
      }

      toDoc.markModified('cards');
      await toDoc.save();

      // Build reply summary
      const summaryParts = transfers.map(t => `${t.amount} x **[${String(t.rarity || '').toUpperCase()}] ${t.name}**${t.locked ? ' (locked)' : ''}`);
      const summaryText = summaryParts.join(', ');

      const prefix = partialSend
        ? `You requested ${requestedCount} but only ${sendCount} ${sendCount === 1 ? 'card' : 'cards'} were available${multi ? ' (multi prevented taking last copies)' : ''}.\n`
        : '';

      const lockedNote = allowLocked ? '' : '';

      // Final success response via editReply (we deferred at the start)
      return await interaction.editReply({
        content: `${prefix}You sent ${summaryText} to ${toUser.toString()}.${lockedNote}`
      });
    } catch (err) {
      console.error('[INT] command execute error', err);

      // Attempt to inform the user of the error. We deferred at the start, so editReply is appropriate.
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: 'An error occurred while processing your request.' });
        } else {
          await interaction.reply({ content: 'An error occurred while processing your request.', ephemeral: true });
        }
      } catch (replyErr) {
        // If editing the reply fails (e.g., Unknown interaction), log and stop.
        console.error('[INT] failed to send error reply', replyErr);
      }
    }
  }
};
