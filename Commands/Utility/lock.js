// Commands/Utility/lock.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock or unlock cards to prevent them from being traded, gifted, burned, or used in lives')
    .addStringOption(option =>
      option.setName('card')
        .setDescription('Card name (you can type a prefix)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('rarity')
        .setDescription('Rarity of the card (required)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('action')
        .setDescription('Lock or unlock')
        .setRequired(true)
        .addChoices(
          { name: '🔒 Lock', value: 'lock' },
          { name: '🔓 Unlock', value: 'unlock' }
        )),
  requireOshi: true,
  async execute(interaction) {
    const userId = interaction.user.id;
    const partialName = interaction.options.getString('card').toLowerCase();
    const rarityReq = interaction.options.getString('rarity').toLowerCase();
    const action = interaction.options.getString('action');

    const userDoc = await User.findOne({ id: userId }).exec();
    if (!userDoc || !Array.isArray(userDoc.cards) || userDoc.cards.length === 0) {
      return interaction.reply({ content: "You have no cards.", ephemeral: true });
    }

    // Find ALL matching cards (not just first)
    const matchingCards = userDoc.cards.filter(c =>
      String(c.name).toLowerCase().startsWith(partialName) &&
      String(c.rarity || '').toLowerCase() === rarityReq
    );

    if (matchingCards.length === 0) {
      return interaction.reply({
        content: `No card starts with "${partialName}" and rarity "${interaction.options.getString('rarity')}".`,
        ephemeral: true
      });
    }

    // Update lock status for all matching cards
    let updatedCount = 0;
    const newLockState = action === 'lock';
    
    for (const card of matchingCards) {
      if (card.locked !== newLockState) {
        card.locked = newLockState;
        updatedCount++;
      }
    }

    if (updatedCount === 0) {
      return interaction.reply({
        content: `All matching cards are already ${action}ed.`,
        ephemeral: true
      });
    }

    userDoc.markModified('cards');
    await userDoc.save();

    const embed = new EmbedBuilder()
      .setTitle(action === 'lock' ? '🔒 Cards Locked' : '🔓 Cards Unlocked')
      .setColor(action === 'lock' ? 0xFF5555 : 0x55FF55)
      .setDescription(`**${updatedCount}** card(s) matching **[${rarityReq}]** "${partialName}" have been ${action}ed.`)
      .addFields(
        { 
          name: 'Affected Cards', 
          value: matchingCards.map(c => `• **[${c.rarity}]** ${c.name} - ${c.locked ? '🔒' : '🔓'}`).join('\n') 
        },
        { 
          name: 'Protection', 
          value: action === 'lock' ? 
            'These cards cannot be traded, gifted, burned, or used in lives.' :
            'These cards can now be used normally.'
        }
      );

    return interaction.reply({ embeds: [embed], ephemeral: false });
  }
};
