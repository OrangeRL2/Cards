// requireOshiUI.js
const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const OSHI_LIST = require('./config/oshis'); // [{ id, label, gen, bdayMonth, bdayDay, image }]

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

module.exports = { buildGenSelect, buildOshiSelect, uniqueGens, GEN_CUSTOM_ID, OSHI_CUSTOM_ID };
