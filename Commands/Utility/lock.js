// Commands/Utility/lock.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/User');
const { resolveCardColor, getAttributeEmoji } = require('../../config/holomemColor');

// Attribute emoji helper (emoji-only)
function attrEmoji(name, rarity) {
  const cc = resolveCardColor(name, rarity);
  const emoji = cc ? getAttributeEmoji(cc) : '';
  return emoji ? ` ${emoji}` : '';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock or unlock cards to prevent them from being traded, gifted, burned, or used in lives')
    .addStringOption(option =>
      option.setName('card')
        .setDescription('Card name (prefix) OR "all"/"any"/* to target all cards')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('rarity')
        .setDescription('Rarity of the card (required). Use "all"/"any"/* to target every rarity')
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

    const cardReqRaw = interaction.options.getString('card');
    const cardReq = String(cardReqRaw).trim().toLowerCase();

    const rarityReqRaw = interaction.options.getString('rarity');
    const rarityReq = String(rarityReqRaw).trim().toLowerCase();

    const action = interaction.options.getString('action');
    const newLockState = action === 'lock';

    const userDoc = await User.findOne({ id: userId }).exec();
    if (!userDoc || !Array.isArray(userDoc.cards) || userDoc.cards.length === 0) {
      return interaction.reply({ content: "You have no cards.", flags: 64 });
    }

    // allow targeting all rarities by using "all", "any", or "*"
    const targetAllRarities = ['all', 'any', '*'].includes(rarityReq);

    // ✅ NEW: allow targeting all cards by using "all", "any", or "*"
    const targetAllCards = ['all', 'any', '*'].includes(cardReq);

    // Find ALL matching cards (not just first)
    const matchingCards = userDoc.cards.filter(c => {
      // Card name match: either "all cards" OR prefix match
      const nameMatches = targetAllCards
        ? true
        : String(c.name).toLowerCase().startsWith(cardReq);

      if (!nameMatches) return false;

      // Rarity match: either all rarities OR exact rarity
      if (targetAllRarities) return true;
      return String(c.rarity || '').toLowerCase() === rarityReq;
    });

    if (matchingCards.length === 0) {
      const rarityDisplay = targetAllRarities ? 'any rarity' : `"${rarityReqRaw}"`;
      const cardDisplay = targetAllCards ? 'any card' : `"${cardReqRaw}"`;
      return interaction.reply({
        content: `No cards match card ${cardDisplay} and rarity ${rarityDisplay}.`,
        flags: 64
      });
    }

    // Update lock status for all matching cards
    let updatedCount = 0;
    for (const card of matchingCards) {
      if (card.locked !== newLockState) {
        card.locked = newLockState;
        updatedCount++;
      }
    }

    if (updatedCount === 0) {
      return interaction.reply({
        content: `All matching cards are already ${action}ed.`,
        flags: 64
      });
    }

    userDoc.markModified('cards');
    await userDoc.save();

    // Build lines for affected cards
    const cardLines = matchingCards.map(c => `• **[${c.rarity}]** ${c.name}${attrEmoji(c.name, c.rarity)} - ${c.locked ? '🔒' : '🔓'}`);

    // Split into chunks where each chunk's joined string <= 1024 chars
    const MAX_FIELD_LEN = 1024;
    const MAX_FIELDS = 24; // reserve one field for Protection (25 total allowed)
    const fields = [];
    let currentLines = [];
    let currentLen = 0;

    for (const line of cardLines) {
      const lineLen = line.length + 1; // +1 for newline when joined
      if (currentLen + lineLen > MAX_FIELD_LEN) {
        fields.push({
          name: `Affected Cards${fields.length > 0 ? ` (${fields.length + 1})` : ''}`,
          value: currentLines.join('\n')
        });
        currentLines = [line];
        currentLen = line.length + 1;
        if (fields.length >= MAX_FIELDS) break;
      } else {
        currentLines.push(line);
        currentLen += lineLen;
      }
    }

    if (currentLines.length > 0 && fields.length < MAX_FIELDS) {
      fields.push({
        name: `Affected Cards${fields.length > 0 ? ` (${fields.length + 1})` : ''}`,
        value: currentLines.join('\n')
      });
    }

    // If we hit the field limit but still have more cards, append a short summary field
    const totalLinesCount = cardLines.length;
    const shownCount = fields.reduce((acc, f) => acc + f.value.split('\n').length, 0);
    if (shownCount < totalLinesCount) {
      fields.push({
        name: 'Affected Cards (continued)',
        value: `...and **${totalLinesCount - shownCount}** more cards not shown to avoid embed limits.`
      });
    }

    // Add Protection field (always small)
    fields.push({
      name: 'Protection',
      value: action === 'lock'
        ? 'These cards cannot be traded, gifted, burned, or used in lives.'
        : 'These cards can now be used normally.'
    });

    const cardLabel = targetAllCards ? 'All Cards' : cardReqRaw;
    const rarityLabel = targetAllRarities ? 'All Rarities' : rarityReqRaw;

    const embed = new EmbedBuilder()
      .setTitle(action === 'lock' ? '🔒 Cards Locked' : '🔓 Cards Unlocked')
      .setColor(action === 'lock' ? 0xFF5555 : 0x55FF55)
      .setDescription(`**${updatedCount}** card(s) matching **[${rarityLabel}]** "${cardLabel}" have been ${action}ed.`)
      .addFields(fields);

    return interaction.reply({ embeds: [embed] });
  }
};