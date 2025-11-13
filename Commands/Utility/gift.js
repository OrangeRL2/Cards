// commands/Utility/gift.js
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
        .setDescription('Card name (you can type a prefix)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('rarity')
        .setDescription('Rarity of the card (required)')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('count')
        .setDescription('How many to send')
        .setRequired(true)
    ),
  requireOshi: true,
  async execute(interaction) {
    const fromId = interaction.user.id;
    const toUser = interaction.options.getUser('user');
    const partialName = interaction.options.getString('card').toLowerCase();
    const sendCount = interaction.options.getInteger('count');
    const rarityReq = String(interaction.options.getString('rarity')).toLowerCase();

    if (toUser.id === fromId) return interaction.reply({ content: "You can’t trade with yourself.", ephemeral: true });
    if (sendCount < 1) return interaction.reply({ content: "Count must be at least 1.", ephemeral: true });

    const fromDoc = await User.findOne({ id: fromId }).exec();
    if (!fromDoc || !Array.isArray(fromDoc.cards) || fromDoc.cards.length === 0) {
      return interaction.reply({ content: "You have no cards.", ephemeral: true });
    }

    // find by prefix AND rarity
    const idx = fromDoc.cards.findIndex(c =>
      String(c.name).toLowerCase().startsWith(partialName) &&
      String(c.rarity || '').toLowerCase() === rarityReq
    );

    if (idx === -1) {
      return interaction.reply({
        content: `No card in your inventory starts with "${partialName}" and rarity "${interaction.options.getString('rarity')}".`,
        ephemeral: true
      });
    }

    const cardEntry = fromDoc.cards[idx];
    const cardName = cardEntry.name;

    if ((cardEntry.count || 0) < sendCount) {
      return interaction.reply({ content: `You only have ${cardEntry.count || 0} × ${cardName}.`, ephemeral: true });
    }

    // deduct from sender
    cardEntry.count -= sendCount;
    if (cardEntry.count <= 0) {
      fromDoc.cards.splice(idx, 1);
    } else {
      cardEntry.timestamps = cardEntry.timestamps || [];
      cardEntry.timestamps.push(new Date());
      fromDoc.cards[idx] = cardEntry;
    }
    fromDoc.markModified('cards');
    await fromDoc.save();

    // credit recipient
    let toDoc = await User.findOne({ id: toUser.id }).exec();
    if (!toDoc) toDoc = new User({ id: toUser.id, cards: [] });

    const toIdx = toDoc.cards.findIndex(c => c.name === cardName && String(c.rarity || '').toLowerCase() === rarityReq);
    if (toIdx !== -1) {
      toDoc.cards[toIdx].count = (toDoc.cards[toIdx].count || 0) + sendCount;
      toDoc.cards[toIdx].timestamps = toDoc.cards[toIdx].timestamps || [];
      toDoc.cards[toIdx].timestamps.push(new Date());
    } else {
      toDoc.cards.push({
        name: cardName,
        rarity: cardEntry.rarity,
        count: sendCount,
        timestamps: [new Date()]
      });
    }
    toDoc.markModified('cards');
    await toDoc.save();

    return interaction.reply({
      content: `You sent ${sendCount} x **[${interaction.options.getString('rarity').toUpperCase()}] ${cardName}** to ${toUser}.`,
      ephemeral: false
    });
  }
};