// events/interactionCreate.js
const { Events, Collection } = require('discord.js');
const { requireOshi } = require('../requireOshi');
const OshiUser = require('../models/Oshi');
const OSHI_LIST = require('../config/oshis');
const { buildGenSelect, buildOshiSelect, GEN_CUSTOM_ID, OSHI_CUSTOM_ID } = require('../requireOshiUI');
const { grantOnSelectIfBirthday } = require('../utils/birthdayGrant');
const { addOshiOsrToUser } = require('../utils/oshiRewards');
const config = require('../config.json');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    try {
      // --- Autocomplete handler for command options (e.g., rarity) ---
      // in events/interactionCreate.js — put this near the top of execute(interaction)
// Autocomplete handler — replace any existing autocomplete branch with this
// Autocomplete handler (replace existing branch)
if (typeof interaction.isAutocomplete === 'function' && interaction.isAutocomplete()) {
  try {
    const focused = interaction.options.getFocused(true); // { name, value }
    console.log('[AUTOCOMPLETE] focused', focused.value, 'stage', interaction.options.getInteger('stage'));

    if (focused.name !== 'rarity') {
      await interaction.respond([]);
      return;
    }

    const STAGE_ALLOWED_RARITIES = {
      1: ['C', 'OC', 'U'],
      2: ['S', 'R', 'RR'],
      3: ['SR', 'OSR'],
      4: ['UR', 'OUR', 'SY'],
      5: ['SEC'],
    };

    const stage = interaction.options.getInteger('stage');

    // If you want to force the user to pick stage first, set fallbackAllowed = []
    // If you want to show all rarities when stage is missing, set fallbackAllowed = Object.values(STAGE_ALLOWED_RARITIES).flat()
    const fallbackAllowed = Object.values(STAGE_ALLOWED_RARITIES).flat();

    const allowed = stage && STAGE_ALLOWED_RARITIES[stage] ? STAGE_ALLOWED_RARITIES[stage] : fallbackAllowed;

    const input = String(focused.value || '').toLowerCase();

    // Primary filter: contains the typed input
    let suggestions = allowed
      .filter(r => r.toLowerCase().includes(input))
      .slice(0, 25)
      .map(r => ({ name: r, value: r }));

    // If nothing matched the typed input, fall back to showing the allowed list (so the user sees options)
    if (suggestions.length === 0) {
      suggestions = allowed.slice(0, 25).map(r => ({ name: r, value: r }));
    }

    await interaction.respond(suggestions);
  } catch (err) {
    console.error('[INT] autocomplete handler error', err);
    try { await interaction.respond([]); } catch {}
  }
  return;
}


      if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith(`${GEN_CUSTOM_ID}:`)) {
          const [, allowedUserId] = interaction.customId.split(':');
          if (interaction.user.id !== allowedUserId) {
            return interaction.reply({ content: 'This menu is not for you.', ephemeral: true });
          }

          const encodedGen = interaction.values?.[0];
          if (!encodedGen) return interaction.reply({ content: 'No generation selected.', ephemeral: true });

          const oshiRow = buildOshiSelect(allowedUserId, encodedGen);
          return interaction.update({
            content: `Choose an oshi from ${decodeURIComponent(encodedGen)}`,
            components: [interaction.message.components[0], oshiRow],
          });
        }

        if (interaction.customId.startsWith(`${OSHI_CUSTOM_ID}:`)) {
          const parts = interaction.customId.split(':');
          if (parts.length < 3) return interaction.reply({ content: 'Invalid interaction.', ephemeral: true });

          const allowedUserId = parts[1];
          const encodedGen = parts.slice(2).join(':');
          if (interaction.user.id !== allowedUserId) {
            return interaction.reply({ content: 'This menu is not for you.', ephemeral: true });
          }

          const selectedId = interaction.values?.[0];
          if (!selectedId) return interaction.reply({ content: 'No oshi selected.', ephemeral: true });

          const oshi = OSHI_LIST.find(o => o.id === selectedId);
          if (!oshi) return interaction.reply({ content: 'Invalid selection.', ephemeral: true });

          // NEW: check if user already has an oshi and refuse changes
          try {
            const existing = await OshiUser.findOne({ userId: allowedUserId }).lean().exec();
            if (existing && existing.oshiId) {
              // remove components visually and send ephemeral reply
              try {
                await interaction.update({
                  content: `You already have an oshi and cannot change it here.`,
                  components: [],
                });
              } catch (updateErr) {
                // fallback to ephemeral reply if update fails
                await interaction.reply({ content: 'You already have an oshi and cannot change it here.', ephemeral: true });
              }
              return;
            }
          } catch (dbCheckErr) {
            console.error('[INT] failed to check existing oshi', dbCheckErr);
            return interaction.reply({ content: 'Unable to verify your oshi status. Try again later.', ephemeral: true });
          }

          // save to DB (upsert) — safe because we've confirmed none exists
          try {
            await OshiUser.findOneAndUpdate(
              { userId: allowedUserId },
              { userId: allowedUserId, oshiId: oshi.id, chosenAt: new Date() },
              { upsert: true, setDefaultsOnInsert: true }
            );
          } catch (dbErr) {
            console.error('[INT] failed to save oshi', dbErr);
            return interaction.reply({ content: 'Failed to save your selection. Try again later.', ephemeral: true });
          }

          // best-effort: give an OSR card for this oshi (no date restriction)
          let osrResult = null;
          try {
            osrResult = await addOshiOsrToUser(allowedUserId, oshi.label);
          } catch (err) {
            console.error('[INT] osr grant error', err);
          }

          // birthday grant (best-effort)
          let grantResult = null;
          try {
            grantResult = await grantOnSelectIfBirthday(allowedUserId, oshi.id, { client: interaction.client, birthdayChannelId: config.birthdayChannelId });
          } catch (err) {
            console.error('[INT] birthday grant error', err);
          }

          const birthdayText = grantResult && grantResult.granted ? ' Bonus: +12 event pulls granted for birthday!' : '';
          const osrText = osrResult && osrResult.gave ? ` You also received an OSR card for ${oshi.label}!` : '';

          // confirmation: remove components so it can't be reused
          let genDisplay;
          try { genDisplay = decodeURIComponent(encodedGen); } catch { genDisplay = encodedGen; }

          return interaction.update({
            content: `You chose **${oshi.label}** (${genDisplay}) as your oshi!${birthdayText}${osrText}`,
            components: [],
          });
        }

        return;
      }

      if (!interaction.isChatInputCommand()) return;

      console.log('[INT] command invoke', interaction.commandName, 'user', interaction.user.id);

      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) {
        console.error(`[INT] No command matching ${interaction.commandName}`);
        return;
      }

      if (!interaction.client.cooldowns) interaction.client.cooldowns = new Collection();
      const cooldowns = interaction.client.cooldowns;
      if (!cooldowns.has(command.data.name)) cooldowns.set(command.data.name, new Collection());

      const now = Date.now();
      const timestamps = cooldowns.get(command.data.name);
      const cooldownSeconds = Number(command.cooldown) || 0;
      const cooldownMs = cooldownSeconds * 1000;

      if (cooldownMs > 0 && timestamps.has(interaction.user.id)) {
        const expires = timestamps.get(interaction.user.id) + cooldownMs;
        if (now < expires) {
          const expTs = Math.round(expires / 1000);
          console.log('[INT] cooldown blocked for', interaction.user.id);
          return interaction.reply({ content: `You are on cooldown for \`${command.data.name}\`. Try <t:${expTs}:R>.`, ephemeral: true });
        }
      }

      if (cooldownMs > 0) {
        timestamps.set(interaction.user.id, now);
        setTimeout(() => timestamps.delete(interaction.user.id), cooldownMs);
      }

      console.log('[INT] requireOshi?', !!command.requireOshi);
      if (command.requireOshi) {
        let oshiDoc;
        try {
          oshiDoc = await requireOshi(interaction);
        } catch (err) {
          console.error('[INT] requireOshi threw', err);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'Internal error checking oshi. Try again later.', ephemeral: true });
          }
          return;
        }

        console.log('[INT] requireOshi result', !!oshiDoc);
        if (!oshiDoc) return;

        interaction.oshi = oshiDoc;
      }

      try {
        await command.execute(interaction);
      } catch (err) {
        console.error('[INT] command execute error', err);
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
          await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
      }
    } catch (topErr) {
      console.error('[INT] unexpected error in interaction handler', topErr);
      try {
        if (interaction && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'An unexpected error occurred. Try again later.', ephemeral: true });
        }
      } catch (replyErr) {
        console.error('[INT] failed to send error reply', replyErr);
      }
    }
  },
};
