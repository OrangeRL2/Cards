const { Events, Collection } = require('discord.js');

const { requireOshi } = require('../requireOshi');
const OshiUser = require('../models/Oshi');
const streamManager = require('../jobs/streamManager');
const OSHI_LIST = require('../config/oshis');
const { buildOshiSelect, GEN_CUSTOM_ID, OSHI_CUSTOM_ID } = require('../requireOshiUI');
const { grantOnSelectIfBirthday } = require('../utils/birthdayGrant');
const { addOshiOsrToUser } = require('../utils/oshiRewards');
const config = require('../config.json');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    async function safeReply(opts) {
      try {
        if (interaction.replied || interaction.deferred) return await interaction.followUp({ ephemeral: true, ...opts }).catch(() => null);
        return await interaction.reply(opts).catch(() => null);
      } catch (_) { return null; }
    }

    async function safeUpdate(opts) {
      try { return await interaction.update(opts).catch(() => null); } catch (_) { return null; }
    }

    try {
      // -------------------- Stream interactions --------------------
      // All stream buttons/select menus are owned by streamManager so the
      // interaction router does not need to know about scoring/inventory logic.
      if ((interaction.isButton?.() || interaction.isStringSelectMenu?.()) && interaction.customId?.startsWith('stream\n')) {
        await streamManager.handleInteraction(interaction);
        return;
      }

      // -------------------- Autocomplete --------------------
      if (interaction.isAutocomplete?.()) {
        try {
          const focused = interaction.options.getFocused(true);
          if (focused.name !== 'rarity') {
            await interaction.respond([]).catch(() => null);
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
          const fallback = Object.values(STAGE_ALLOWED_RARITIES).flat();
          const allowed = stage && STAGE_ALLOWED_RARITIES[stage] ? STAGE_ALLOWED_RARITIES[stage] : fallback;
          const input = String(focused.value || '').toLowerCase();
          let suggestions = allowed.filter(r => r.toLowerCase().includes(input)).slice(0, 25).map(r => ({ name: r, value: r }));
          if (!suggestions.length) suggestions = allowed.slice(0, 25).map(r => ({ name: r, value: r }));
          await interaction.respond(suggestions).catch(() => null);
        } catch (err) {
          console.error('[INT] autocomplete error', err);
          await interaction.respond([]).catch(() => null);
        }
        return;
      }

      // -------------------- Oshi select menus --------------------
      if (interaction.isStringSelectMenu?.()) {
        if (interaction.customId.startsWith(`${GEN_CUSTOM_ID}:`)) {
          const [, allowedUserId] = interaction.customId.split(':');
          if (interaction.user.id !== allowedUserId) return safeReply({ content: 'This menu is not for you.', flags: 64 });
          const encodedGen = interaction.values?.[0];
          if (!encodedGen) return safeReply({ content: 'No generation selected.', flags: 64 });
          const oshiRow = buildOshiSelect(allowedUserId, encodedGen);
          return safeUpdate({
            content: `Choose an oshi from ${decodeURIComponent(encodedGen)}`,
            components: [interaction.message.components[0], oshiRow],
          });
        }

        if (interaction.customId.startsWith(`${OSHI_CUSTOM_ID}:`)) {
          const parts = interaction.customId.split(':');
          if (parts.length < 3) return safeReply({ content: 'Invalid interaction.', flags: 64 });
          const allowedUserId = parts[1];
          const encodedGen = parts.slice(2).join(':');
          if (interaction.user.id !== allowedUserId) return safeReply({ content: 'This menu is not for you.', flags: 64 });

          const selectedId = interaction.values?.[0];
          const oshi = OSHI_LIST.find(o => o.id === selectedId);
          if (!oshi) return safeReply({ content: 'Invalid selection.', flags: 64 });

          try {
            const existing = await OshiUser.findOne({ userId: allowedUserId }).lean();
            if (existing?.oshiId) return safeUpdate({ content: 'You already have an oshi and cannot change it here.', components: [] });
          } catch (err) {
            console.error('[INT] oshi status check failed', err);
            return safeReply({ content: 'Unable to verify your oshi status. Try again later.', flags: 64 });
          }

          try {
            // Preserve an existing historical chosenAt if an Oshi document was
            // intentionally reset but retained for selection history.
            await OshiUser.findOneAndUpdate(
              { userId: allowedUserId },
              { $set: { userId: allowedUserId, oshiId: oshi.id }, $setOnInsert: { chosenAt: new Date() } },
              { upsert: true, setDefaultsOnInsert: true }
            );
          } catch (err) {
            console.error('[INT] failed to save oshi', err);
            return safeReply({ content: 'Failed to save your selection. Try again later.', flags: 64 });
          }

          let osrResult = null;
          try { osrResult = await addOshiOsrToUser(allowedUserId, oshi.label); } catch (err) { console.error('[INT] OSR grant error', err); }
          let grantResult = null;
          try {
            grantResult = await grantOnSelectIfBirthday(allowedUserId, oshi.id, {
              client: interaction.client,
              birthdayChannelId: config.birthdayChannelId,
            });
          } catch (err) { console.error('[INT] birthday grant error', err); }

          const birthdayText = grantResult?.granted ? ' Bonus: +12 event pulls granted for birthday!' : '';
          const osrText = osrResult?.gave ? ` You also received an OSR card for ${oshi.label}!` : '';
          let genDisplay;
          try { genDisplay = decodeURIComponent(encodedGen); } catch { genDisplay = encodedGen; }
          return safeUpdate({
            content: `You chose **${oshi.label}** (${genDisplay}) as your oshi!${birthdayText}${osrText}`,
            components: [],
          });
        }
        return;
      }

      // -------------------- Slash commands --------------------
      if (!interaction.isChatInputCommand?.()) return;

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
        if (now < expires) return safeReply({ content: `You are on cooldown for \`${command.data.name}\`. Try <t:${Math.round(expires / 1000)}:R>.`, flags: 64 });
      }
      if (cooldownMs > 0) {
        timestamps.set(interaction.user.id, now);
        setTimeout(() => timestamps.delete(interaction.user.id), cooldownMs);
      }

      if (command.requireOshi) {
        let oshiDoc;
        try { oshiDoc = await requireOshi(interaction); }
        catch (err) {
          console.error('[INT] requireOshi error', err);
          if (!interaction.replied && !interaction.deferred) await safeReply({ content: 'Internal error checking oshi. Try again later.', flags: 64 });
          return;
        }
        if (!oshiDoc) return;
        interaction.oshi = oshiDoc;
      }

      try { await command.execute(interaction); }
      catch (err) {
        console.error('[INT] command execute error', err);
        await safeReply({ content: 'There was an error while executing this command!', flags: 64 });
      }
    } catch (err) {
      console.error('[INT] unexpected interaction error', err);
      if (!interaction.replied && !interaction.deferred) await safeReply({ content: 'An unexpected error occurred. Try again later.', flags: 64 });
    }
  },
};
