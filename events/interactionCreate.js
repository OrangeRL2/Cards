// events/interactionCreate.js
const { Events, Collection, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { requireOshi } = require('../requireOshi');
const OshiUser = require('../models/Oshi');
const User = require('../models/User');
const BossEvent = require('../models/BossEvent');
const bossManager = require('../jobs/bossManager');
const OSHI_LIST = require('../config/oshis');
const { buildGenSelect, buildOshiSelect, GEN_CUSTOM_ID, OSHI_CUSTOM_ID } = require('../requireOshiUI');
const { grantOnSelectIfBirthday } = require('../utils/birthdayGrant');
const { addOshiOsrToUser } = require('../utils/oshiRewards');
const config = require('../config.json');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Helper: safe reply/update wrappers to avoid throwing on expired/unknown interactions (Discord 10062)
    async function safeReply(interaction, opts) {
      try {
        if (!interaction) return null;
        if (interaction.replied || interaction.deferred) {
          return await interaction.followUp({ ephemeral: true, ...opts }).catch(err => {
            if (err?.code === 10062) return null;
            throw err;
          });
        } else {
          return await interaction.reply(opts).catch(err => {
            if (err?.code === 10062) return null;
            throw err;
          });
        }
      } catch (err) {
        if (err?.code === 10062) return null;
        throw err;
      }
    }

    async function safeEditReply(interaction, opts) {
      try {
        if (!interaction) return null;
        return await interaction.editReply(opts).catch(err => {
          if (err?.code === 10062) return null;
          throw err;
        });
      } catch (err) {
        if (err?.code === 10062) return null;
        throw err;
      }
    }

    async function safeUpdate(interaction, opts) {
      try {
        if (!interaction) return null;
        return await interaction.update(opts).catch(err => {
          if (err?.code === 10062) return null;
          throw err;
        });
      } catch (err) {
        if (err?.code === 10062) return null;
        throw err;
      }
    }

    // New helper: try to edit the deferred reply, fallback to followUp if interaction token expired
    async function safeEditOrFollow(interaction, opts) {
      try {
        if (!interaction) return null;
        // Prefer editReply if we deferred earlier
        try {
          return await interaction.editReply(opts);
        } catch (err) {
          if (err?.code === 10062) {
            // token expired for original interaction; try followUp
            return await interaction.followUp({ ephemeral: true, ...opts }).catch(() => null);
          }
          // other errors: rethrow to be handled by caller
          throw err;
        }
      } catch (err) {
        // If anything else goes wrong, attempt a safe followUp as last resort
        try {
          if (interaction && (interaction.replied || interaction.deferred)) {
            return await interaction.followUp({ ephemeral: true, ...opts }).catch(() => null);
          }
        } catch (e) { /* ignore */ }
        return null;
      }
    }

    try {
      // --- Autocomplete handler ---
      if (typeof interaction.isAutocomplete === 'function' && interaction.isAutocomplete()) {
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
          const fallbackAllowed = Object.values(STAGE_ALLOWED_RARITIES).flat();
          const allowed = stage && STAGE_ALLOWED_RARITIES[stage] ? STAGE_ALLOWED_RARITIES[stage] : fallbackAllowed;
          const input = String(focused.value || '').toLowerCase();

          let suggestions = allowed
            .filter(r => r.toLowerCase().includes(input))
            .slice(0, 25)
            .map(r => ({ name: r, value: r }));

          if (suggestions.length === 0) {
            suggestions = allowed.slice(0, 25).map(r => ({ name: r, value: r }));
          }

          await interaction.respond(suggestions).catch(() => null);
        } catch (err) {
          console.error('[INT] autocomplete handler error', err);
          try { await interaction.respond([]).catch(() => null); } catch {}
        }
        return;
      }

      // --- Button handling for boss interactions ---
      if (interaction.isButton && interaction.isButton()) {
        try {
          const id = interaction.customId;
          if (!id || !id.startsWith('boss|')) return;

          const [, eventId, action] = id.split('|');

          // Defer early for actions that will perform DB work (like, superchat confirm/cancel path)
          // For simple UI flows that only present a select, we will not defer here.
          // But for safety, defer for like and confirm flows.
          if (action === 'like') {
            // Acknowledge immediately so token doesn't expire
            try { await interaction.deferReply({ ephemeral: true }).catch(() => null); } catch (e) { /* ignore */ }

            // Run heavy work asynchronously
            setImmediate(async () => {
              try {
                const ev = await BossEvent.findOne({ eventId }).lean();
                if (!ev || ev.status !== 'active') {
                  return await safeEditOrFollow(interaction, { content: 'This boss event is no longer active.' });
                }

                const userId = interaction.user.id;
                const userDoc = await User.findOne({ id: userId }).lean();
                const oshiLevel = userDoc?.levels?.[ev.oshiId] || 1;

                try {
                  const res = await bossManager.handleLike({ userId, oshiId: ev.oshiId, oshiLevel, client: interaction.client });

                  // Member boost: handled inside bossManager; res may include memberMsg
                  const parts = [`You gave ${res.points} likes (+${res.happinessDelta} happiness).`];
                  if (res.memberMsg) parts.push(res.memberMsg);

                  await safeEditOrFollow(interaction, { content: parts.join(' ') });
                } catch (err) {
                  console.error('[INT] handleLike error', err);
                  await safeEditOrFollow(interaction, { content: err.message || 'Failed to process like.' });
                }
              } catch (err) {
                console.error('[INT] like background error', err);
                try { await safeEditOrFollow(interaction, { content: 'Failed to process like.' }); } catch {}
              }
            });

            return;
          }

          if (action === 'sub') {
            // present select menu of eligible OSR/SR cards
            const userId = interaction.user.id;
            const userDoc = await User.findOne({ id: userId }).lean();
            if (!userDoc) return safeReply(interaction, { content: 'User not found.', flags: 64 });

            const eligible = (userDoc.cards || []).map((c, idx) => ({ ...c, _idx: idx }))
              .filter(c => ['OSR', 'SR'].includes(c.rarity) && (c.count || 0) > 0);

            if (!eligible.length) {
              return safeReply(interaction, { content: 'You have no OSR or SR cards to subscribe with.', flags: 64 });
            }

            const options = eligible.slice(0, 25).map(c => {
              const payload = encodeURIComponent(JSON.stringify({ idx: c._idx, name: c.name, rarity: c.rarity }));
              return {
                label: `${c.name} (${c.rarity})${c.count && c.count > 1 ? ` x${c.count}` : ''}`,
                value: payload,
                description: `${c.rarity} card`
              };
            });

            const select = new StringSelectMenuBuilder()
              .setCustomId(`boss_sub_select|${eventId}|${userId}`)
              .setPlaceholder('Select a card to consume for Sub (OSR/SR)')
              .addOptions(options)
              .setMinValues(1)
              .setMaxValues(1);

            const row = new ActionRowBuilder().addComponents(select);

            return safeReply(interaction, {
              content: 'Choose which card to consume for Sub (this will be used immediately).',
              components: [row],
              flags: 64
            });
          }

          if (action === 'superchat') {
            try {
              // Parse full customId parts to detect announcement vs confirm/cancel
              const parts = id.split('|'); // e.g., ['boss','<eventId>','superchat'] or ['boss','<eventId>','superchat','confirm','<userId>']
              // If this is the simple announcement button (no extra suffix), open ephemeral confirm
              if (parts.length === 3) {
                // call bossManager helper to create ephemeral confirm prompt
                await bossManager.createSuperchatConfirm(interaction, eventId);
                return;
              }

              // Otherwise it's a confirm/cancel button press; delegate to the handler
              // For confirm path, we may perform heavy DB work; defer first
              const actionType = parts[3];
              // inside handleSuperchatInteraction(interaction) when action === 'confirm'
    if (action === 'confirm') {
    // Ensure only the intended user can confirm (you already check this earlier)
    try {
      // Acknowledge the component quickly so Discord doesn't show "thinking..."
      await interaction.deferUpdate().catch(() => null);
    
      // Try to remove/disable the buttons on the original ephemeral confirm message immediately.
      // interaction.message should be the ephemeral message that contained the Confirm/Cancel buttons.
      try {
        if (interaction.message && interaction.message.edit) {
          // Remove components and optionally update content to show processing
          await interaction.message.edit({ content: 'Processing superchat...', components: [] }).catch(() => null);
        }
      } catch (editErr) {
        // non-fatal: log and continue
        console.warn('[handleSuperchatInteraction] failed to edit confirm message to remove buttons', editErr);
      }
    
      // Run the heavy work asynchronously so we don't block the event loop
      setImmediate(async () => {
        try {
          const userId = interaction.user.id;
          const ev = await BossEvent.findOne({ eventId }).lean();
          if (!ev) {
            // original message already had buttons removed; inform user via followUp
            await interaction.followUp({ ephemeral: true, content: 'Event no longer available.' }).catch(() => null);
            return;
          }
        
          // Recompute currentCount and cost inside handleSuperchat or rely on handleSuperchat to validate
          const result = await handleSuperchat({ userId, oshiId: ev.oshiId, spendFans: undefined, client: interaction.client });
        
          // Send ephemeral follow-up with success details
          const successText = `Superchat sent: **${result.spendFans}** fans had their wallets emptied.\nHappiness awarded: **${result.happinessDelta}**.\nNext cost: **${result.nextSuperchatMin}**.`;
          await interaction.followUp({ ephemeral: true, content: successText }).catch(() => null);
        } catch (err) {
          console.error('[handleSuperchatInteraction] confirm processing failed', err);
          // Inform the user; the original confirm message already had its buttons removed
          await interaction.followUp({ ephemeral: true, content: `Superchat failed: ${err?.message || 'internal error'}` }).catch(() => null);
        }
      });
    
      return true;
    } catch (err) {
      console.error('[handleSuperchatInteraction] confirm branch unexpected error', err);
      try { await interaction.followUp({ ephemeral: true, content: 'Failed to process superchat confirmation.' }).catch(() => null); } catch {}
      return true;
    }
} 



              // For cancel or other actions, delegate directly (they are quick)
              await bossManager.handleSuperchatInteraction(interaction);
              return;
            } catch (err) {
              console.error('[INT] superchat button handler error', err);
              if (!interaction.deferred && !interaction.replied) {
                return safeReply(interaction, { content: 'Failed to process superchat interaction.', flags: 64 });
              }
              try { await safeEditReply(interaction, { content: 'Failed to process superchat interaction.' }); } catch {}
              return;
            }
          }

          return safeReply(interaction, { content: 'Unknown action.', flags: 64 });
        } catch (err) {
          console.error('[INT] button handler error', err);
          try {
            if (interaction.deferred || interaction.replied) {
              await safeEditReply(interaction, { content: 'Failed to process button interaction.' });
            } else {
              await safeReply(interaction, { content: 'Failed to process button interaction.', flags: 64 });
            }
          } catch {}
        }
        return;
      }

      // --- String select menu handling (including sub card selection) ---
      if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {
        if (interaction.customId && interaction.customId.startsWith('boss_sub_select|')) {
          const parts = interaction.customId.split('|');
          if (parts.length < 3) {
            return safeReply(interaction, { content: 'Invalid selection interaction.', flags: 64 });
          }
          const [, eventId, allowedUserId] = parts;
          if (interaction.user.id !== allowedUserId) {
            return safeReply(interaction, { content: 'This selection is not for you.', flags: 64 });
          }

          const selected = interaction.values?.[0];
          if (!selected) return safeReply(interaction, { content: 'No card selected.', flags: 64 });

          let payload;
          try {
            payload = JSON.parse(decodeURIComponent(selected));
          } catch (e) {
            console.error('[INT] failed to parse select payload', e);
            return safeReply(interaction, { content: 'Invalid selection payload.', flags: 64 });
          }

          // Defer because we will perform DB operations
          try { await interaction.deferReply({ ephemeral: true }).catch(() => null); } catch (e) { /* ignore */ }

          setImmediate(async () => {
            try {
              const ev = await BossEvent.findOne({ eventId }).lean();
              if (!ev || ev.status !== 'active') {
                return safeEditOrFollow(interaction, { content: 'This boss event is no longer active.' });
              }

              const res = await bossManager.handleSubWithCard({
                userId: interaction.user.id,
                oshiId: ev.oshiId,
                cardName: payload.name,
                cardRarity: payload.rarity,
                client: interaction.client
              });

              return safeEditOrFollow(interaction, { content: `You subscribed but [${payload.rarity}] ${payload.name} got jealous and left you (+${res.happinessDelta} happiness).` });
            } catch (err) {
              console.error('[INT] sub-with-card error', err);
              return safeEditOrFollow(interaction, { content: err.message || 'Failed to subscribe with selected card.' });
            }
          });

          return;
        }

        // existing GEN_CUSTOM_ID / OSHI_CUSTOM_ID handling (unchanged)
        if (interaction.customId.startsWith(`${GEN_CUSTOM_ID}:`)) {
          const [, allowedUserId] = interaction.customId.split(':');
          if (interaction.user.id !== allowedUserId) {
            return safeReply(interaction, { content: 'This menu is not for you.', flags: 64 });
          }

          const encodedGen = interaction.values?.[0];
          if (!encodedGen) return safeReply(interaction, { content: 'No generation selected.', flags: 64 });

          const oshiRow = buildOshiSelect(allowedUserId, encodedGen);
          return safeUpdate(interaction, {
            content: `Choose an oshi from ${decodeURIComponent(encodedGen)}`,
            components: [interaction.message.components[0], oshiRow],
          });
        }

        if (interaction.customId.startsWith(`${OSHI_CUSTOM_ID}:`)) {
          const parts = interaction.customId.split(':');
          if (parts.length < 3) return safeReply(interaction, { content: 'Invalid interaction.', flags: 64 });

          const allowedUserId = parts[1];
          const encodedGen = parts.slice(2).join(':');
          if (interaction.user.id !== allowedUserId) {
            return safeReply(interaction, { content: 'This menu is not for you.', flags: 64 });
          }

          const selectedId = interaction.values?.[0];
          if (!selectedId) return safeReply(interaction, { content: 'No oshi selected.', flags: 64 });

          const oshi = OSHI_LIST.find(o => o.id === selectedId);
          if (!oshi) return safeReply(interaction, { content: 'Invalid selection.', flags: 64 });

          try {
            const existing = await OshiUser.findOne({ userId: allowedUserId }).lean().exec();
            if (existing && existing.oshiId) {
              try {
                await safeUpdate(interaction, {
                  content: `You already have an oshi and cannot change it here.`,
                  components: [],
                });
              } catch (updateErr) {
                await safeReply(interaction, { content: 'You already have an oshi and cannot change it here.', flags: 64 });
              }
              return;
            }
          } catch (dbCheckErr) {
            console.error('[INT] failed to check existing oshi', dbCheckErr);
            return safeReply(interaction, { content: 'Unable to verify your oshi status. Try again later.', flags: 64 });
          }

          try {
            await OshiUser.findOneAndUpdate(
              { userId: allowedUserId },
              { userId: allowedUserId, oshiId: oshi.id, chosenAt: new Date() },
              { upsert: true, setDefaultsOnInsert: true }
            );
          } catch (dbErr) {
            console.error('[INT] failed to save oshi', dbErr);
            return safeReply(interaction, { content: 'Failed to save your selection. Try again later.', flags: 64 });
          }

          let osrResult = null;
          try { osrResult = await addOshiOsrToUser(allowedUserId, oshi.label); } catch (err) { console.error('[INT] osr grant error', err); }
          let grantResult = null;
          try { grantResult = await grantOnSelectIfBirthday(allowedUserId, oshi.id, { client: interaction.client, birthdayChannelId: config.birthdayChannelId }); } catch (err) { console.error('[INT] birthday grant error', err); }

          const birthdayText = grantResult && grantResult.granted ? ' Bonus: +12 event pulls granted for birthday!' : '';
          const osrText = osrResult && osrResult.gave ? ` You also received an OSR card for ${oshi.label}!` : '';

          let genDisplay;
          try { genDisplay = decodeURIComponent(encodedGen); } catch { genDisplay = encodedGen; }

          return safeUpdate(interaction, {
            content: `You chose **${oshi.label}** (${genDisplay}) as your oshi!${birthdayText}${osrText}`,
            components: [],
          });
        }

        return;
      }

      // --- Modal submit handling (superchat) ---
      if (interaction.isModalSubmit && interaction.isModalSubmit()) {
        try {
          const id = interaction.customId;
          if (!id || !id.startsWith('boss_modal|')) return;
          const [, eventId, modalAction] = id.split('|');
          if (modalAction !== 'superchat') return;

          // Defer immediately
          try { await interaction.deferReply({ ephemeral: true }).catch(() => null); } catch (e) { /* ignore */ }

          setImmediate(async () => {
            try {
              const ev = await BossEvent.findOne({ eventId }).lean();
              if (!ev || ev.status !== 'active') {
                return safeEditOrFollow(interaction, { content: 'This boss event is no longer active.' });
              }

              const userId = interaction.user.id;
              const raw = interaction.fields.getTextInputValue('spendFans');
              const spendFans = Math.floor(Number(raw || 0));
              if (!Number.isFinite(spendFans) || spendFans <= 0) {
                return safeEditOrFollow(interaction, { content: 'Please enter a valid positive integer for fans.' });
              }

              try {
                const res = await bossManager.handleSuperchat({ userId, oshiId: ev.oshiId, spendFans, client: interaction.client });
                return safeEditOrFollow(interaction, {
                  content: `Superchat successful: +${res.points} likes (+${res.happinessDelta} happiness). Next minimum: ${res.nextSuperchatMin} fans.`
                });
              } catch (err) {
                return safeEditOrFollow(interaction, { content: err.message || 'Superchat failed.' });
              }
            } catch (err) {
              console.error('[INT] modal background error', err);
              try {
                await safeEditOrFollow(interaction, { content: 'Failed to process modal submission.' });
              } catch {}
            }
          });

          return;
        } catch (err) {
          console.error('[INT] modal handler error', err);
          try {
            if (interaction.deferred || interaction.replied) {
              await safeEditReply(interaction, { content: 'Failed to process modal submission.' });
            } else {
              await safeReply(interaction, { content: 'Failed to process modal submission.', flags: 64 });
            }
          } catch {}
        }
        return;
      }

      // --- Chat input commands (existing flow) ---
      if (!interaction.isChatInputCommand || !interaction.isChatInputCommand()) return;

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
          return safeReply(interaction, { content: `You are on cooldown for \`${command.data.name}\`. Try <t:${expTs}:R>.`, flags: 64 });
        }
      }

      if (cooldownMs > 0) {
        timestamps.set(interaction.user.id, now);
        setTimeout(() => timestamps.delete(interaction.user.id), cooldownMs);
      }

      if (command.requireOshi) {
        let oshiDoc;
        try {
          oshiDoc = await requireOshi(interaction);
        } catch (err) {
          console.error('[INT] requireOshi threw', err);
          if (!interaction.replied && !interaction.deferred) {
            await safeReply(interaction, { content: 'Internal error checking oshi. Try again later.', flags: 64 });
          }
          return;
        }
        if (!oshiDoc) return;
        interaction.oshi = oshiDoc;
      }

      try {
        await command.execute(interaction);
      } catch (err) {
        console.error('[INT] command execute error', err);
        if (interaction.replied || interaction.deferred) {
          await safeReply(interaction, { content: 'There was an error while executing this command!', flags: 64 });
        } else {
          await safeReply(interaction, { content: 'There was an error while executing this command!', flags: 64 });
        }
      }
    } catch (topErr) {
      console.error('[INT] unexpected error in interaction handler', topErr);
      try {
        if (interaction && !interaction.replied && !interaction.deferred) {
          await safeReply(interaction, { content: 'An unexpected error occurred. Try again later.', flags: 64 });
        }
      } catch (replyErr) {
        console.error('[INT] failed to send error reply', replyErr);
      }
    }
  },
};
