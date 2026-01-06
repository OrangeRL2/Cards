// commands/change-img.js
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const mongoose = require('mongoose');
const OshiUser = require('../../models/Oshi');
const User = require('../../models/User');
const OSHI_LIST = require('../../config/oshis');

const EXCEPTIONS = {
  // values are arrays of exception names or prefixes that should be allowed
  // Example:
  'chloe': ['Ruka'],
};

const { Schema } = mongoose;
const OshiImageOverrideSchema = new Schema({
  userId: { type: String, required: true, unique: true },
  rarity: { type: String, trim: true, required: true },
  cardName: { type: String, trim: true, required: true },
  updatedAt: { type: Date, default: () => new Date() }
});
const OshiImageOverride = mongoose.models.OshiImageOverride || mongoose.model('OshiImageOverride', OshiImageOverrideSchema);

function normalizeForCompare(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('img')
    .setDescription('Set a custom card image for a user (must own the card).')
    .addStringOption(opt => opt.setName('rarity').setDescription('Rarity (e.g., C,U,R,S,P,SEC)').setRequired(true))
    .addStringOption(opt => opt.setName('card').setDescription('Card name (e.g., "Reine 001")').setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const targetUser = interaction.options.getUser('target') ?? interaction.user;
      const targetId = targetUser.id;

      // Permission: allow self, otherwise require ManageGuild/Admin
      if (targetId !== interaction.user.id) {
        const member = interaction.member;
        const hasPerm = member && (member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator));
        if (!hasPerm) {
          return interaction.editReply({ content: 'You do not have permission to change another user\'s oshi image.' });
        }
      }

      const rarityRaw = (interaction.options.getString('rarity') || '').trim();
      const cardRaw = (interaction.options.getString('card') || '').trim();
      if (!rarityRaw || !cardRaw) {
        return interaction.editReply({ content: 'Both rarity and card name are required.' });
      }

      const rarity = String(rarityRaw).toUpperCase();
      const cardName = String(cardRaw).trim();

      // Ensure target has an Oshi
      const oshiDoc = await OshiUser.findOne({ userId: targetId }).lean().exec();
      if (!oshiDoc) {
        return interaction.editReply({ content: `No oshi found for that user. They must pick an oshi first.` });
      }

      // Optional: require card name to start with the user's oshi id
      const oshiId = String(oshiDoc.oshiId || '').trim();
      if (!oshiId) {
        return interaction.editReply({ content: 'User has an invalid oshi id; cannot validate card name.' });
      }
      const normOshi = normalizeForCompare(oshiId);
const normCard = normalizeForCompare(cardName);

// Build normalized exceptions list for this oshi (if any)
const rawExceptions = EXCEPTIONS[oshiId] || [];
const normExceptions = rawExceptions.map(e => normalizeForCompare(e));

// Allowed if card starts with oshi id OR starts with any exception prefix
const allowedByOshi = normCard.startsWith(normOshi);
const allowedByException = normExceptions.some(exc => exc && normCard.startsWith(exc));

if (!allowedByOshi && !allowedByException) {
  const example = rawExceptions.length ? rawExceptions[0] : `${oshiId} 001`;
  return interaction.editReply({
    content: `Card name must start with the user's oshi id "${oshiId}" or match an allowed exception. Example: "${example}".`
  });
}


      // Verify the target user actually owns that card in their inventory
      const userDoc = await User.findOne({ id: targetId }).lean().exec();
      if (!userDoc) {
        return interaction.editReply({ content: `Target user inventory not found.` });
      }

      const ownsCard = (userDoc.cards || []).some(c => {
        const cName = String(c.name || '').trim();
        const cRarity = String(c.rarity || '').toUpperCase();
        return normalizeForCompare(cName) === normalizeForCompare(cardName) && cRarity === rarity && Number(c.count || 0) > 0;
      });

      if (!ownsCard) {
        return interaction.editReply({
          content: `Target user does not have that card in their inventory. They must own **${cardName}** (${rarity}) to set it as their image.`
        });
      }

      // Persist override
      const updated = await OshiImageOverride.findOneAndUpdate(
        { userId: targetId },
        { $set: { rarity, cardName, updatedAt: new Date() } },
        { upsert: true, new: true }
      ).exec();

      if (!updated) {
        return interaction.editReply({ content: 'Failed to save image override.' });
      }

      // Build image URL (trim + encode)
      const encoded = encodeURIComponent(String(updated.cardName).trim());
      const rarityPart = encodeURIComponent(String(updated.rarity).trim());
      const imageUrl = `http://152.69.195.48/images/${rarityPart}/${encoded}.png`;

      // Resolve display name
      let displayName = targetUser.tag;
      if (interaction.guild) {
        try {
          const member = await interaction.guild.members.fetch(targetId).catch(() => null);
          if (member) displayName = member.displayName;
        } catch (e) {}
      } else {
        displayName = targetUser.username;
      }

      const oshiMeta = OSHI_LIST.find(o => o.id === oshiDoc.oshiId);
      const oshiLabel = oshiMeta ? `${oshiMeta.label}` : oshiDoc.oshiId;

      const embed = new EmbedBuilder()
        .setTitle(`${displayName}'s Oshi Image Updated`)
        .setColor(0xFF69B4)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 64 }))
        .setImage(imageUrl)
        .addFields(
          { name: 'Oshi', value: `${oshiLabel}`, inline: true },
          { name: 'Image override', value: `**[${updated.rarity}]** ${updated.cardName}`, inline: true }
        );

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[CMD] /change-img error', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'An error occurred while executing /change-img.', ephemeral: true });
      } else {
        await interaction.followUp({ content: 'An error occurred while executing /change-img.', ephemeral: true });
      }
    }
  }
};
