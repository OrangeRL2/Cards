// register-test.js
const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
const cmd = new SlashCommandBuilder().setName('testvisible').setDescription('visibility test').toJSON();
await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: [cmd] });
console.log('registered testvisible');
