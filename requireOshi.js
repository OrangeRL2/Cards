// requireOshi.js
const { buildGenSelect, buildOshiSelect, uniqueGens } = require('./requireOshiUI');
const OshiUser = require('./models/Oshi');

async function requireOshi(interaction) {
  if (!interaction || !interaction.user) throw new Error('requireOshi: invalid interaction');
  const userId = interaction.user.id;

  const doc = await OshiUser.findOne({ userId }).lean().exec();
  if (doc) return doc;

  // No selection: prompt user with gen dropdown + default oshi dropdown (first gen)
  const gens = uniqueGens();
  const firstGen = gens[0] ?? 'Uncategorized';
  const encodedFirstGen = encodeURIComponent(firstGen);

  const genRow = buildGenSelect(userId);
  const oshiRow = buildOshiSelect(userId, encodedFirstGen);

  const content = 'You must pick an oshi before you can play. Choose a generation, then pick an oshi.';
  try {
    // prefer ephemeral reply so only the user sees it
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, components: [genRow, oshiRow], ephemeral: true });
    } else {
      await interaction.reply({ content, components: [genRow, oshiRow], ephemeral: true });
    }
  } catch (err) {
    // Do NOT DM. Try safe non-DM fallbacks and log.
    console.error('[requireOshi] ephemeral reply failed', err);

    try {
      // If the interaction has an original message, try editing it
      if (interaction.message && interaction.message.edit) {
        await interaction.message.edit({ content, components: [genRow, oshiRow] });
        return null;
      }

      // If we have a channel object, try sending in-channel (visible to everyone)
      if (interaction.channel && interaction.channel.send) {
        await interaction.channel.send({ content: `${interaction.user}, ${content}`, components: [genRow, oshiRow] });
        return null;
      }
    } catch (fallbackErr) {
      console.error('[requireOshi] fallback in-channel send failed', fallbackErr);
    }

    // If all else fails, return null — do not DM the user
    return null;
  }

  return null;
}

module.exports = { requireOshi };
