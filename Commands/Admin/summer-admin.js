const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const SummerUser = require('../../models/SummerUser');

const WINDOWS = ['morning', 'noon', 'evening'];

function progressKey(day, windowName) {
  return `day${String(day).padStart(2, '0')}_${windowName}`;
}

function unique(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('summer-admin')
    .setDescription('Summer event testing and balances.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand => subcommand
      .setName('grant-pulls')
      .setDescription('Grant SUN Pulls')
      .addUserOption(option => option
        .setName('user')
        .setDescription('Player')
        .setRequired(true))
      .addIntegerOption(option => option
        .setName('amount')
        .setDescription('Amount')
        .setMinValue(1)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('grant-shells')
      .setDescription('Grant shells')
      .addUserOption(option => option
        .setName('user')
        .setDescription('Player')
        .setRequired(true))
      .addIntegerOption(option => option
        .setName('amount')
        .setDescription('Amount')
        .setMinValue(1)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('test-day')
      .setDescription('Set an activity day override')
      .addUserOption(option => option
        .setName('user')
        .setDescription('Player')
        .setRequired(true))
      .addIntegerOption(option => option
        .setName('day')
        .setDescription('August day')
        .setMinValue(1)
        .setMaxValue(31)
        .setRequired(true))
      .addBooleanOption(option => option
        .setName('unlock-all')
        .setDescription('Unlock all three windows')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('clear-test-day')
      .setDescription('Clear activity day override')
      .addUserOption(option => option
        .setName('user')
        .setDescription('Player')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('reset-day')
      .setDescription('Wipe one activity day so it can be replayed')
      .addUserOption(option => option
        .setName('user')
        .setDescription('Player')
        .setRequired(true))
      .addIntegerOption(option => option
        .setName('day')
        .setDescription('August day to wipe')
        .setMinValue(1)
        .setMaxValue(31)
        .setRequired(true))
      .addBooleanOption(option => option
        .setName('remove-day-flags')
        .setDescription('Also remove story flags earned during that day')))
    .addSubcommand(subcommand => subcommand
      .setName('reset-activities')
      .setDescription('Reset all activity progress')
      .addUserOption(option => option
        .setName('user')
        .setDescription('Player')
        .setRequired(true))),

  requireOshi: false,

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const subcommand = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user', true);

    if (subcommand === 'reset-day') {
      const day = interaction.options.getInteger('day', true);
      const removeDayFlags = interaction.options.getBoolean('remove-day-flags') ?? true;
      const doc = await SummerUser.findOne({ userId: user.id }).lean().exec();

      if (!doc) {
        return interaction.editReply({
          content: `${user} does not have a Summer profile yet.`,
        });
      }

      const keys = WINDOWS.map(windowName => progressKey(day, windowName));
      const states = keys.map(key => doc.activityProgress?.[key]).filter(Boolean);
      const completedCount = states.filter(state => state?.completed).length;
      const dayFlags = unique(states.flatMap(state => state?.flags || []));

      const update = {
        $unset: Object.fromEntries(keys.map(key => [`activityProgress.${key}`, 1])),
      };

      if (removeDayFlags && dayFlags.length > 0) {
        update.$pull = { storyFlags: { $in: dayFlags } };
      }

      if (completedCount > 0) {
        update.$set = {
          'stats.activitiesCompleted': Math.max(
            0,
            Number(doc.stats?.activitiesCompleted || 0) - completedCount
          ),
        };
      }

      const updated = await SummerUser.findOneAndUpdate(
        { userId: user.id },
        update,
        { new: true }
      ).lean().exec();

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle(`Summer Day ${day} Reset`)
          .setColor(0x35c98b)
          .setDescription([
            `${user}`,
            `Cleared: **${keys.join(', ')}**`,
            `Completed windows removed from stats: **${completedCount}**`,
            `Day flags removed: **${removeDayFlags ? dayFlags.length : 0}**`,
            '',
            '**Rewards already received were not removed.**',
            `Shells: **${updated.summerShells || 0}**`,
            `SUN Pulls: **${updated.sunPulls || 0}**`,
          ].join('\n'))],
      });
    }

    let update = { $setOnInsert: { userId: user.id } };

    if (subcommand === 'grant-pulls') {
      update.$inc = { sunPulls: interaction.options.getInteger('amount', true) };
    }

    if (subcommand === 'grant-shells') {
      update.$inc = { summerShells: interaction.options.getInteger('amount', true) };
    }

    if (subcommand === 'test-day') {
      update.$set = {
        'testing.dayOverride': interaction.options.getInteger('day', true),
        'testing.unlockAllWindows': interaction.options.getBoolean('unlock-all', true),
      };
    }

    if (subcommand === 'clear-test-day') {
      update.$set = {
        'testing.dayOverride': null,
        'testing.unlockAllWindows': false,
      };
    }

    if (subcommand === 'reset-activities') {
      update.$set = { activityProgress: {} };
    }

    const doc = await SummerUser.findOneAndUpdate(
      { userId: user.id },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean().exec();

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle('Summer admin updated')
        .setDescription([
          `${user}`,
          `SUN Pulls: **${doc.sunPulls || 0}**`,
          `Shells: **${doc.summerShells || 0}**`,
          `Test day: **${doc.testing?.dayOverride || 'off'}**`,
          `All windows: **${doc.testing?.unlockAllWindows ? 'yes' : 'no'}**`,
        ].join('\n'))],
    });
  },
};
