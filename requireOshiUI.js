// utils/requireOshiUI.js
const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const OSHI_LIST = require('./config/oshis'); // adjust path as needed

const GEN_CUSTOM_ID = 'oshi_gen';        // base id; will append :userId
const OSHI_CUSTOM_ID = 'oshi_choose';    // base id; will append :userId:gen

// Return unique gens in stable order
function uniqueGens() {
  const seen = new Set();
  const out = [];
  for (const o of OSHI_LIST) {
    const g = o.gen || 'Uncategorized';
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

// Build a select menu for gens. customId = `oshi_gen:${userId}`
function buildGenSelect(userId) {
  const gens = uniqueGens();
  const options = gens.map(g => ({
    label: g,
    value: encodeURIComponent(g),
    description: undefined,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${GEN_CUSTOM_ID}:${userId}`)
    .setPlaceholder('Select a generation / category')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return new ActionRowBuilder().addComponents(menu);
}

// Build an oshi select for a given gen. customId = `oshi_choose:${userId}:${encodedGen}`
function buildOshiSelect(userId, gen) {
  const decodedGen = decodeURIComponent(gen);
  const items = OSHI_LIST.filter(o => (o.gen || 'Uncategorized') === decodedGen);

  // cap to 25 by slicing; if more than 25 you'll need paging (not in this file)
  const slice = items.slice(0, 25);

  const options = slice.map(o => ({
    label: o.label,
    value: o.id,
    description: o.bdayMonth && o.bdayDay ? `Bday: ${String(o.bdayMonth).padStart(2,'0')}-${String(o.bdayDay).padStart(2,'0')}` : undefined,
  }));

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${OSHI_CUSTOM_ID}:${userId}:${encodeURIComponent(gen)}`)
    .setPlaceholder(`Choose an oshi from ${decodedGen}`)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return new ActionRowBuilder().addComponents(menu);
}

/*
 Helpers for robust interaction handling
 - canInteractWithOshi(interaction)
     Validates that the interaction customId was targeted at the same user who clicked (prevents others).
     Returns true if OK, false otherwise.

 - ensureNoExistingOshi(interaction, UserModel)
     Async. Looks up the user document by interaction.user.id (or interaction.user.id).
     If the user already has an oshi (userDoc.oshi or similar) it replies ephemerally with a short message
     and returns false. Otherwise returns true.

 Usage:
   // in your interactionCreate handler for select menus:
   const { canInteractWithOshi, ensureNoExistingOshi } = require('../utils/requireOshiUI');
   if (!canInteractWithOshi(interaction)) {
     return interaction.reply({ content: 'This menu is not for you.', ephemeral: true });
   }
   if (!(await ensureNoExistingOshi(interaction, User))) return; // User is told why

   // proceed to handle selection...
*/

// Validate that the customId was created for the same user
function canInteractWithOshi(interaction) {
  try {
    const cid = interaction.customId || '';
    // expected formats:
    //  - oshi_gen:<userId>
    //  - oshi_choose:<userId>:<gen>
    const parts = cid.split(':');
    if (!parts.length) return false;
    const base = parts[0];
    if (![GEN_CUSTOM_ID, OSHI_CUSTOM_ID].includes(base)) return false;
    const targetUserId = parts[1];
    return Boolean(targetUserId && targetUserId === String(interaction.user?.id));
  } catch (err) {
    console.warn('[oshiUI] canInteract error', err);
    return false;
  }
}

// Ensure the user doesn't already have an oshi. Replies ephemerally if they do.
// UserModel is your Mongoose model (e.g., require('../models/User')) or an object with a findOne method.
async function ensureNoExistingOshi(interaction, UserModel) {
  try {
    const discordId = String(interaction.user?.id);
    if (!discordId) {
      await interaction.reply({ content: 'Could not identify you.', ephemeral: true });
      return false;
    }

    // Lookup user doc quickly. Adjust path/field if your schema stores oshi differently.
    const userDoc = await UserModel.findOne({ id: discordId }).lean().exec();
    if (userDoc && userDoc.oshi) {
      // Don't expose internal details; short, firm reply
      await interaction.reply({ content: 'You already have an oshi and cannot change it here.', ephemeral: true });
      return false;
    }

    return true;
  } catch (err) {
    console.error('[oshiUI] ensureNoExistingOshi error', err);
    // Fail closed: if we can't determine state, tell the user to try later
    try {
      await interaction.reply({ content: 'Unable to check your oshi status right now. Please try again later.', ephemeral: true });
    } catch (_) { /* ignore reply errors */ }
    return false;
  }
}

module.exports = {
  buildGenSelect,
  buildOshiSelect,
  uniqueGens,
  GEN_CUSTOM_ID,
  OSHI_CUSTOM_ID,
  canInteractWithOshi,
  ensureNoExistingOshi,
};
