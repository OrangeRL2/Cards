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

      // Map to select option objects
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
          if (!id || !id.startsWith('boss\n')) return;
          const [, eventId, action] = id.split('\n');

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
                  return await safeEditOrFollow(interaction, { content: 'This 24 hour stream is no longer active.' });
                }
                try {
                  // No User doc fetch here—bossManager.handleLike will fetch Oshi doc and compute bonuses
                  const res = await bossManager.handleLike({ userId: interaction.user.id, oshiId: ev.oshiId, client: interaction.client });
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

          // --- Page-select "back" button handler (kept for compatibility but not required) ---
          if (id && id.startsWith('boss_sub_page_back\n')) {
            // customId: boss_sub_page_back\n<eventId>\n<allowedUserId>
            const [, backEventId, allowedUserId] = id.split('\n');
            if (interaction.user.id !== allowedUserId) {
              return safeReply(interaction, { content: 'This control is not for you.', flags: 64 });
            }
            try {
              // Fetch only eligible cards via aggregation (OSR/SR, count>0, not locked)
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
                const realCount = pageArr.length >= 25 ? 24 : pageArr.length;
                const start = i * 25 + 1;
                const end = i * 25 + pageArr.length;
                const labelCountText = pageArr.length >= 25 ? `${realCount} cards` : `${realCount} cards`;
                return {
                  label: `Page ${i + 1} (${start}-${end})`,
                  value: String(i),
                  description: `${labelCountText}`
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

          if (action === 'sub') {
            // present a page-select menu first (ephemeral) so we can support >25 cards
            const userId = interaction.user.id;

            // Return only eligible cards (OSR/SR, count>0, not locked)
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

            // Split into pages of 25
            const pages = chunkArray(allOptions, 25);
            const totalPages = pages.length;

            // Build page-select options (Discord select max 25 options)
            const pageOptions = pages.map((pageArr, i) => {
              const realCount = pageArr.length >= 25 ? 24 : pageArr.length;
              const start = i * 25 + 1;
              const end = i * 25 + pageArr.length;
              const labelCountText = pageArr.length >= 25 ? `${realCount} cards` : `${realCount} cards`;
              return {
                label: `Page ${i + 1} (${start}-${end})`,
                value: String(i),
                description: `${labelCountText}`
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

          if (action === 'superchat') {
            try {
              // Parse full customId parts to detect announcement vs confirm/cancel
              const parts = id.split('\n'); // e.g., ['boss','<eventId>','superchat'] or ['boss','<eventId>','superchat','confirm','<userId>']

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
            // Recompute eligible server-side (aggregation to return only OSR/SR, count>0, not locked)
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

            // Build all options and page them
            const pages = chunkArray(allOptions, 25);
            const totalPages = pages.length;
            const safePageIndex = Math.max(0, Math.min(totalPages - 1, pageIndex));

            let pageOptions = pages[safePageIndex].slice(); // copy

            // Add "Back to pages" as the last option on the card-select so user can return
            // Ensure we don't exceed 25 options: if pageOptions already has 25, replace the last one with Back
            const BACK_VALUE = '__BACK_TO_PAGES__';
            const backOption = {
              label: 'Back to pages',
              value: BACK_VALUE,
              description: 'Return to the page list'
            };
            if (pageOptions.length >= 25) {
              // replace last option
              pageOptions[pageOptions.length - 1] = backOption;
            } else {
              pageOptions.push(backOption);
            }
            // Defensive: ensure we never pass >25 options to Discord
            if (pageOptions.length > 25) pageOptions = pageOptions.slice(0, 25);

            // Build the card-select for the chosen page
            const cardSelect = new StringSelectMenuBuilder()
              .setCustomId(`boss_sub_select\n${pageEventId}\n${allowedUserId}`)
              .setPlaceholder('Select a card to consume for Sub (OSR/SR)')
              .addOptions(pageOptions)
              .setMinValues(1)
              .setMaxValues(1);

            const cardRow = new ActionRowBuilder().addComponents(cardSelect);

            // Update the ephemeral message in-place to show the cards for the selected page
            return safeUpdate(interaction, {
              content: `Showing page ${safePageIndex + 1}/${totalPages}. Select a card to consume (or choose Back to pages):`,
              components: [cardRow]
            });
          } catch (err) {
            console.error('[INT] boss_sub_page_select handler error', err);
            return safeUpdate(interaction, { content: 'Failed to load that page.', components: [] });
          }
        }

        // Handle the actual card selection (consumption) or Back-to-pages via the same select
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

          // Handle Back-to-pages sentinel
          const BACK_VALUE = '__BACK_TO_PAGES__';
          if (selected === BACK_VALUE) {
            // Rebuild page-select and show it
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
                const realCount = pageArr.length >= 25 ? 24 : pageArr.length;
                const start = i * 25 + 1;
                const end = i * 25 + pageArr.length;
                const labelCountText = pageArr.length >= 25 ? `${realCount} cards` : `${realCount} cards`;
                return {
                  label: `Page ${i + 1} (${start}-${end})`,
                  value: String(i),
                  description: `${labelCountText}`
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

          // Otherwise it's a real card payload
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
                return safeEditOrFollow(interaction, { content: 'This 24 hour stream is no longer active.' });
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
          if (!id || !id.startsWith('boss_modal\n')) return;
          const [, eventId, modalAction] = id.split('\n');
          if (modalAction !== 'superchat') return;

          // Defer immediately
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