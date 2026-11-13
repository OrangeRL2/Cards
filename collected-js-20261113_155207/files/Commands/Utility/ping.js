const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	cooldown: 5,
	data: new SlashCommandBuilder()
		.setName('yoichan')
		.setDescription('Its true'),
	async execute(interaction) {
		await interaction.reply('wa kyou mo kawaii');
	},
};