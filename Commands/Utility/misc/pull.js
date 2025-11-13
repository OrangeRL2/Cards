const { SlashCommandBuilder } = require('discord.js');
const { pullCore } = require('./pullCore');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pull')
    .setDescription('Spend a single pull to draw one pack of cards.')
    .addBooleanOption(o=>o.setName('event').setDescription('Allow using event pulls if timed pulls are insufficient').setRequired(false)),
  requireOshi: true,
  async execute(interaction) {
    // Build context that matches pullCore expectations
    const ctx = {
      id: interaction.user.id,
      options: { event: interaction.options.getBoolean('event') },
      replyInitial: async (payload) => {
        // emulate deferReply + editReply pattern by sending a normal message then returning it
        return await interaction.editReply ? await interaction.editReply(payload) : await interaction.reply(payload);
      },
      editReply: async (message, payload) => {
        // interaction.editReply returns the message when using fetchReply; adjust if needed
        if (message?.edit) return await message.edit(payload);
        if (interaction.editReply) return await interaction.editReply(payload);
      },
    };
    // ensure an initial deferred reply exists for interactions
    try { await interaction.deferReply(); } catch(e) { /* ignore if already deferred */ }
    await pullCore(ctx);
  },
};
