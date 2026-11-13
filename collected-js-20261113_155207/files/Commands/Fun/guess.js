const { SlashCommandBuilder } = require('discord.js');
const guessManager = require('../../jobs/guessManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('guess')
    .setDescription('Play a Holodori guessing game.')
    .addSubcommand(sc => sc.setName('jacket').setDescription('Guess the song from a cropped jacket.'))
    .addSubcommand(sc => sc.setName('song').setDescription('Guess the song from a short audio clip.'))
    .addSubcommand(sc => sc.setName('holomem').setDescription('Guess the holomem from cropped card art.'))
    .addSubcommand(sc => sc.setName('hint').setDescription('Get a hint for the active manual guess.'))
    .addSubcommand(sc => sc.setName('end').setDescription('Give up on the active manual guess.'))
    .addSubcommand(sc => sc.setName('time').setDescription('Check time remaining for the active guess.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (['jacket', 'song', 'holomem'].includes(sub)) {
      return guessManager.sendManual(interaction, sub);
    }
    if (sub === 'hint') return guessManager.slashHint(interaction);
    if (sub === 'end') return guessManager.slashEnd(interaction);
    if (sub === 'time') return guessManager.slashTime(interaction);
  },
};
