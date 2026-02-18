// events/interactionCreate.js
const {
  Events,
  Collection,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

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

    // Utility: chunk an array into pages
    function chunkArray(arr, size) {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    }

    // Build eligible options for sub flow: hides locked cards and sorts multis first
    function buildEligibleOptionsFromUserDoc(userDoc) {
      const eligible = (userDoc.cards || []).map((c, idx) => ({ ...c, _idx: idx }))
        .filter(c => ['OSR', 'SR'].includes(c.rarity) && (c.count || 0) > 0 && !c.locked);

      // Sort: multis (count > 1) first, then by count desc, then by name (case-insensitive)
      eligible.sort((a, b) => {
        const aMulti = (a.count || 0) > 1 ? 1 : 0;
        const bMulti = (b.count || 0) > 1 ? 1 : 0;
        if (bMulti !== aMulti) return bMulti - aMulti; // multis first
        if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0); // larger stacks first
        return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
      });

      const allOptions = eligible.map(c => {
        const payload = encodeURIComponent(JSON.stringify({ idx: c._idx, name: c.name, rarity: c.rarity }));
        const countSuffix = (c.count && c.count > 1) ? ` x${c.count}` : '';
        return {
          label: `${c.name} (${c.rarity})${countSuffix}`,
          value: payload,
          description: `${c.rarity} card${countSuffix}`
        };
      });

      return { eligible, allOptions };
    }

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
        try {
          return await interaction.editReply(opts);
        } catch (err) {
          if (err?.code === 10062) {
            return await interaction.followUp({ ephemeral: true, ...opts }).catch(() => null);
          }
          throw err;
        }
      } catch (err) {
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
          if (!id || !id.startsWith('boss\n')) return;

          const parts = id.split('\n');
          const eventId = parts[1];
          const action = parts[2];

          // 1) Superchat confirm/cancel (boss\n<eventId>\nsuperchat\nconfirm|cancel\n<userId>)
          // Delegate completely to bossManager so it always targets the correct eventId
          if (action === 'superchat' && parts.length >= 4) {
            await bossManager.handleSuperchatInteraction(interaction);
            return;
          }

          // 2) Like button (boss\n<eventId>\nlike)
          if (action === 'like') {
            // Acknowledge immediately so token doesn't expire
            try { await interaction.deferReply({ ephemeral: true }).catch(() => null); } catch (e) { /* ignore */ }

            setImmediate(async () => {
              try {
                // Optional quick check (kept from your original flow)
                const ev = await BossEvent.findOne({ eventId }).lean();
                if (!ev || ev.status !== 'active') {
                  return await safeEditOrFollow(interaction, { content: 'This 24 hour stream is no longer active.' });
                }

                try {
                  // IMPORTANT: pass eventId so multiple active bosses work
                  const res = await bossManager.handleLike({
                    userId: interaction.user.id,
                    eventId,
                    client: interaction.client
                  });

                  const out = [`You gave ${res.points} likes (+${res.happinessDelta} happiness).`];
                  if (res.memberMsg) out.push(res.memberMsg);
                  await safeEditOrFollow(interaction, { content: out.join(' ') });
                } catch (err) {
                  console.error('[INT] handleLike error', err);
                  await safeEditOrFollow(interaction, { content: err?.message || 'Failed to process like.' });
                }
              } catch (err) {
                console.error('[INT] like background error', err);
                try { await safeEditOrFollow(interaction, { content: 'Failed to process like.' }); } catch {}
              }
            });
            return;
          }

          // --- Page-select "back" button handler (kept for compatibility) ---
          if (id.startsWith('boss_sub_page_back\n')) {
            // customId: boss_sub_page_back\n<eventId>\n<allowedUserId>
            const [, backEventId, allowedUserId] = id.split('\n');

            if (interaction.user.id !== allowedUserId) {
              return safeReply(interaction, { content: 'This control is not for you.', flags: 64 });
            }

            try {
              const agg = await User.aggregate([
                { $match: { id: allowedUserId } },
                {
                  $project: {
                    _id: 0,
                    cards: {
                      $filter: {
                        input: '$cards',
                        as: 'c',
                        cond: {
                          $and: [
                            { $in: ['$$c.rarity', ['OSR', 'SR']] },
                            { $gt: ['$$c.count', 0] },
                            { $ne: ['$$c.locked', true] }
                          ]
                        }
                      }
                    }
                  }
                }
              ]).exec();

              const userDoc = agg[0] || { cards: [] };
              const { allOptions } = buildEligibleOptionsFromUserDoc(userDoc);

              if (!allOptions.length) {
                return safeUpdate(interaction, { content: 'You have no unlocked OSR or SR cards to subscribe with.', components: [] });
              }

              const pages = chunkArray(allOptions, 25);
              const totalPages = pages.length;

              const pageOptions = pages.map((pageArr, i) => {
                const start = i * 25 + 1;
                const end = i * 25 + pageArr.length;
                return {
                  label: `Page ${i + 1} (${start}-${end})`,
                  value: String(i),
                  description: `${pageArr.length} cards`
                };
              }).slice(0, 25);

              const pageSelect = new StringSelectMenuBuilder()
                .setCustomId(`boss_sub_page_select\n${backEventId}\n${allowedUserId}`)
                .setPlaceholder('Choose which page of cards to view')
                .addOptions(pageOptions)
                .setMinValues(1)
                .setMaxValues(1);

              const pageRow = new ActionRowBuilder().addComponents(pageSelect);

              return safeUpdate(interaction, {
                content: `Choose a page to view: (${totalPages} page(s) available)`,
                components: [pageRow]
              });
            } catch (err) {
              console.error('[INT] boss_sub_page_back handler error', err);
              return safeUpdate(interaction, { content: 'Failed to return to pages.', components: [] });
            }
          }

          // 3) Sub button (boss\n<eventId>\nsub) -> show page menu
          if (action === 'sub') {
            const userId = interaction.user.id;

            const agg = await User.aggregate([
              { $match: { id: userId } },
              {
                $project: {
                  _id: 0,
                  cards: {
                    $filter: {
                      input: '$cards',
                      as: 'c',
                      cond: {
                        $and: [
                          { $in: ['$$c.rarity', ['OSR', 'SR']] },
                          { $gt: ['$$c.count', 0] },
                          { $ne: ['$$c.locked', true] }
                        ]
                      }
                    }
                  }
                }
              }
            ]).exec();

            const userDoc = agg[0] || { cards: [] };
            const { eligible, allOptions } = buildEligibleOptionsFromUserDoc(userDoc);

            if (!eligible.length) {
              return safeReply(interaction, { content: 'You have no unlocked OSR or SR cards to subscribe with.', flags: 64 });
            }

            const pages = chunkArray(allOptions, 25);
            const totalPages = pages.length;

            const pageOptions = pages.map((pageArr, i) => {
              const start = i * 25 + 1;
              const end = i * 25 + pageArr.length;
              return {
                label: `Page ${i + 1} (${start}-${end})`,
                value: String(i),
                description: `${pageArr.length} cards`
              };
            }).slice(0, 25);

            const pageSelect = new StringSelectMenuBuilder()
              .setCustomId(`boss_sub_page_select\n${eventId}\n${userId}`)
              .setPlaceholder('Choose which page of cards to view')
              .addOptions(pageOptions)
              .setMinValues(1)
              .setMaxValues(1);

            const pageRow = new ActionRowBuilder().addComponents(pageSelect);

            return safeReply(interaction, {
              content: `You have ${allOptions.length} eligible cards across ${totalPages} page(s). Choose a page to view:`,
              components: [pageRow],
              flags: 64
            });
          }

          // 4) Superchat main button (boss\n<eventId>\nsuperchat) -> open confirm
          if (action === 'superchat') {
            await bossManager.createSuperchatConfirm(interaction, eventId);
            return;
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

      // --- String select menu handling (including page-select and sub card selection) ---
      if (interaction.isStringSelectMenu && interaction.isStringSelectMenu()) {

        // Handle page-select first: user chose which page to view
        if (interaction.customId && interaction.customId.startsWith('boss_sub_page_select\n')) {
          const parts = interaction.customId.split('\n');
          if (parts.length < 3) return safeReply(interaction, { content: 'Invalid interaction.', flags: 64 });

          const [, pageEventId, allowedUserId] = parts;
          if (interaction.user.id !== allowedUserId) {
            return safeReply(interaction, { content: 'This selection is not for you.', flags: 64 });
          }

          const selectedPageStr = interaction.values?.[0];
          if (typeof selectedPageStr === 'undefined') return safeReply(interaction, { content: 'No page selected.', flags: 64 });
          const pageIndex = Math.max(0, Math.floor(Number(selectedPageStr || 0)));

          try {
            const agg = await User.aggregate([
              { $match: { id: allowedUserId } },
              {
                $project: {
                  _id: 0,
                  cards: {
                    $filter: {
                      input: '$cards',
                      as: 'c',
                      cond: {
                        $and: [
                          { $in: ['$$c.rarity', ['OSR', 'SR']] },
                          { $gt: ['$$c.count', 0] },
                          { $ne: ['$$c.locked', true] }
                        ]
                      }
                    }
                  }
                }
              }
            ]).exec();

            const userDoc = agg[0] || { cards: [] };
            const { eligible, allOptions } = buildEligibleOptionsFromUserDoc(userDoc);

            if (!eligible.length) {
              return safeUpdate(interaction, { content: 'You have no unlocked OSR or SR cards to subscribe with.', components: [] });
            }

            const pages = chunkArray(allOptions, 25);
            const totalPages = pages.length;
            const safePageIndex = Math.max(0, Math.min(totalPages - 1, pageIndex));

            let pageOptions = pages[safePageIndex].slice();

            const BACK_VALUE = '__BACK_TO_PAGES__';
            const backOption = {
              label: 'Back to pages',
              value: BACK_VALUE,
              description: 'Return to the page list'
            };

            if (pageOptions.length >= 25) pageOptions[pageOptions.length - 1] = backOption;
            else pageOptions.push(backOption);

            if (pageOptions.length > 25) pageOptions = pageOptions.slice(0, 25);

            const cardSelect = new StringSelectMenuBuilder()
              .setCustomId(`boss_sub_select\n${pageEventId}\n${allowedUserId}`)
              .setPlaceholder('Select a card to consume for Sub (OSR/SR)')
              .addOptions(pageOptions)
              .setMinValues(1)
              .setMaxValues(1);

            const cardRow = new ActionRowBuilder().addComponents(cardSelect);

            return safeUpdate(interaction, {
              content: `Showing page ${safePageIndex + 1}/${totalPages}. Select a card to consume (or choose Back to pages):`,
              components: [cardRow]
            });

          } catch (err) {
            console.error('[INT] boss_sub_page_select handler error', err);
            return safeUpdate(interaction, { content: 'Failed to load that page.', components: [] });
          }
        }

        // Handle the actual card selection (consumption) or Back-to-pages
        if (interaction.customId && interaction.customId.startsWith('boss_sub_select\n')) {
          const parts = interaction.customId.split('\n');
          if (parts.length < 3) {
            return safeReply(interaction, { content: 'Invalid selection interaction.', flags: 64 });
          }

          const [, eventId, allowedUserId] = parts;
          if (interaction.user.id !== allowedUserId) {
            return safeReply(interaction, { content: 'This selection is not for you.', flags: 64 });
          }

          const selected = interaction.values?.[0];
          if (!selected) return safeReply(interaction, { content: 'No card selected.', flags: 64 });

          const BACK_VALUE = '__BACK_TO_PAGES__';
          if (selected === BACK_VALUE) {
            try {
              const agg = await User.aggregate([
                { $match: { id: allowedUserId } },
                {
                  $project: {
                    _id: 0,
                    cards: {
                      $filter: {
                        input: '$cards',
                        as: 'c',
                        cond: {
                          $and: [
                            { $in: ['$$c.rarity', ['OSR', 'SR']] },
                            { $gt: ['$$c.count', 0] },
                            { $ne: ['$$c.locked', true] }
                          ]
                        }
                      }
                    }
                  }
                }
              ]).exec();

              const userDoc = agg[0] || { cards: [] };
              const { allOptions } = buildEligibleOptionsFromUserDoc(userDoc);

              if (!allOptions.length) {
                return safeUpdate(interaction, { content: 'You have no unlocked OSR or SR cards to subscribe with.', components: [] });
              }

              const pages = chunkArray(allOptions, 25);
              const totalPages = pages.length;

              const pageOptions = pages.map((pageArr, i) => {
                const start = i * 25 + 1;
                const end = i * 25 + pageArr.length;
                return {
                  label: `Page ${i + 1} (${start}-${end})`,
                  value: String(i),
                  description: `${pageArr.length} cards`
                };
              }).slice(0, 25);

              const pageSelect = new StringSelectMenuBuilder()
                .setCustomId(`boss_sub_page_select\n${eventId}\n${allowedUserId}`)
                .setPlaceholder('Choose which page of cards to view')
                .addOptions(pageOptions)
                .setMinValues(1)
                .setMaxValues(1);

              const pageRow = new ActionRowBuilder().addComponents(pageSelect);

              return safeUpdate(interaction, {
                content: `You have ${allOptions.length} eligible cards across ${totalPages} page(s). Choose a page to view:`,
                components: [pageRow]
              });

            } catch (err) {
              console.error('[INT] boss_sub_select back-to-pages error', err);
              return safeUpdate(interaction, { content: 'Failed to return to pages.', components: [] });
            }
          }

          let payload;
          try {
            payload = JSON.parse(decodeURIComponent(selected));
          } catch (e) {
            console.error('[INT] failed to parse select payload', e);
            return safeReply(interaction, { content: 'Invalid selection payload.', flags: 64 });
          }

          try { await interaction.deferReply({ ephemeral: true }).catch(() => null); } catch (e) { /* ignore */ }

          setImmediate(async () => {
            try {
              const ev = await BossEvent.findOne({ eventId }).lean();
              if (!ev || ev.status !== 'active') {
                return safeEditOrFollow(interaction, { content: 'This 24 hour stream is no longer active.' });
              }

              // IMPORTANT: pass eventId so correct boss is targeted when multiple are active
              const res = await bossManager.handleSubWithCard({
                userId: interaction.user.id,
                eventId,
                cardName: payload.name,
                cardRarity: payload.rarity,
                client: interaction.client
              });

              return safeEditOrFollow(interaction, {
                content: `You subscribed but [${payload.rarity}] ${payload.name} got jealous and left you (+${res.happinessDelta} happiness).`
              });
            } catch (err) {
              console.error('[INT] sub-with-card error', err);
              return safeEditOrFollow(interaction, { content: err?.message || 'Failed to subscribe with selected card.' });
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
                await safeUpdate(interaction, { content: `You already have an oshi and cannot change it here.`, components: [] });
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
          if (!id || !id.startsWith('boss_modal\n')) return;

          const [, eventId, modalAction] = id.split('\n');
          if (modalAction !== 'superchat') return;

          try { await interaction.deferReply({ ephemeral: true }).catch(() => null); } catch (e) { /* ignore */ }

          setImmediate(async () => {
            try {
              const ev = await BossEvent.findOne({ eventId }).lean();
              if (!ev || ev.status !== 'active') {
                return safeEditOrFollow(interaction, { content: 'This 24 hour stream is no longer active.' });
              }

              const userId = interaction.user.id;
              const raw = interaction.fields.getTextInputValue('spendFans');
              const spendFans = Math.floor(Number(raw || 0));

              if (!Number.isFinite(spendFans) || spendFans <= 0) {
                return safeEditOrFollow(interaction, { content: 'Please enter a valid positive integer for fans.' });
              }

              try {
                // IMPORTANT: pass eventId so the superchat applies to the correct active spawn
                const res = await bossManager.handleSuperchat({
                  userId,
                  eventId,
                  spendFans,
                  client: interaction.client
                });

                return safeEditOrFollow(interaction, {
                  content: `Superchat successful: +${res.points} likes (+${res.happinessDelta} happiness). Next minimum: ${res.nextSuperchatMin} fans.`
                });
              } catch (err) {
                return safeEditOrFollow(interaction, { content: err?.message || 'Superchat failed.' });
              }
            } catch (err) {
              console.error('[INT] modal background error', err);
              try { await safeEditOrFollow(interaction, { content: 'Failed to process modal submission.' }); } catch {}
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
        await safeReply(interaction, { content: 'There was an error while executing this command!', flags: 64 });
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