// Commands/Utility/trade-listing.js
const { 
  SlashCommandBuilder, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder
} = require('discord.js');
const TradeListing = require('../../models/TradeListing');
const User = require('../../models/User');
const config = require('../../config.json');
const path = require('node:path');
const pools = require('../../utils/loadImages'); // same as miss
const activeSessions = new Map();
const mongoose = require('mongoose');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wanted')
    .setDescription('Create or manage trade listings')
    .addSubcommand(subcommand =>
      subcommand.setName('create')
        .setDescription('Create a new trade listing')
    )
    .addSubcommand(subcommand =>
      subcommand.setName('list')
        .setDescription('View all of your active listings')
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'create') {
      await startListingCreation(interaction);
    } else if (subcommand === 'list') {
      await listActiveListings(interaction);
    } 
  }
};

async function startListingCreation(interaction) {
  await interaction.deferReply({ }); // Use flags instead of ephemeral

  const userDoc = await User.findOne({ id: interaction.user.id });
  if (!userDoc || !userDoc.cards || userDoc.cards.length === 0) {
    return interaction.editReply({ content: "You need cards to create a trade listing!" });
  }

  // Create session
  const session = {
    userId: interaction.user.id,
    username: interaction.user.username,
    offering: [],
    wanted: [],
    step: 'offering',
    message: null,
    // pendingWantedType and pendingWantedRarity will be set when user chooses wanted type first
  };

  const embed = createListingEmbed(session);
  const components = createListingComponents(session);

  const message = await interaction.editReply({ embeds: [embed], components });
  session.message = message;
  
  activeSessions.set(interaction.user.id, session); // Store by user ID

  setupCollector(message, session);
}

function createListingEmbed(session) {
  const embed = new EmbedBuilder()
    .setTitle('Create Wanted Listing')
    .setColor(0x00AAFF)
    .setDescription(`Current step: **${session.step === 'offering' ? 'Select cards to offer' : 'Select wanted cards'}**`);

  if (session.offering.length > 0) {
    embed.addFields({
      name: '🔄 Offering',
      value: session.offering.map((card, index) => 
        `**${index + 1}.** [${card.rarity}] ${card.name} x${card.count}`
      ).join('\n') || 'None'
    });
  }

  if (session.wanted.length > 0) {
    embed.addFields({
      name: '🎯 Wanted',
      value: session.wanted.map((item, index) => {
        switch (item.type) {
          case 'specific': return `**${index + 1}.** [${item.rarity}] ${item.name}`;
          case 'any_name': return `**${index + 1}.** Any ${item.rarity} card`;
        }
      }).join('\n') || 'None'
    });
  }

  return embed;
}

function createListingComponents(session) {
  const rows = [];

  // Main action buttons
  const mainRow = new ActionRowBuilder();
  
  if (session.step === 'offering') {
    mainRow.addComponents(
      new ButtonBuilder()
        .setCustomId('add_offering')
        .setLabel('Add Card to Offer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('remove_last_offering')
        .setLabel('Remove Last Offered')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(session.offering.length === 0)
    );
  } else {
    mainRow.addComponents(
      new ButtonBuilder()
        .setCustomId('add_wanted')
        .setLabel('Add Wanted Card')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('remove_last_wanted')
        .setLabel('Remove Last Wanted')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(session.wanted.length === 0)
    );
  }

  rows.push(mainRow);

  // Navigation row
  const navRow = new ActionRowBuilder();
  navRow.addComponents(
    new ButtonBuilder()
      .setCustomId('switch_step')
      .setLabel(session.step === 'offering' ? 'Switch to Wanted' : 'Switch to Offering')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('publish_listing')
      .setLabel('Publish Listing')
      .setStyle(ButtonStyle.Success)
      .setDisabled(session.offering.length === 0 || session.wanted.length === 0),
    new ButtonBuilder()
      .setCustomId('cancel_listing')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger)
  );

  rows.push(navRow);

  return rows;
}

function setupCollector(message, session) {
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 15 * 60 * 1000
  });

  collector.on('collect', async (interaction) => {
    if (interaction.user.id !== session.userId) {
      return interaction.reply({ content: 'This is not your listing session.' });
    }

    try {
      switch (interaction.customId) {
        case 'add_offering':
          // showModal must be called directly in response to the interaction
          await showCardSearchModal(interaction, session, 'offering');
          break;
        case 'add_wanted':
          // Show the wanted type selection first (this function will then open the modal)
          await showWantedTypeSelection(interaction, session);
          break;
        case 'remove_last_offering':
          session.offering.pop();
          await interaction.deferUpdate();
          await updateSessionMessage(session);
          break;
        case 'remove_last_wanted':
          session.wanted.pop();
          await interaction.deferUpdate();
          await updateSessionMessage(session);
          break;
        case 'switch_step':
          // toggle step
          session.step = session.step === 'offering' ? 'wanted' : 'offering';

          // Build updated embed/components
          const embed = createListingEmbed(session);
          const components = createListingComponents(session);

          // Acknowledge and update the message in one call
          await interaction.update({ embeds: [embed], components });

          // refresh cached message reference (optional)
          session.message = await interaction.channel.messages.fetch(interaction.message.id).catch(() => session.message);
          break;
        case 'preview_listing':
          await showPreview(interaction, session);
          break;
        case 'publish_listing':
          await publishListing(interaction, session);
          collector.stop();
          break;
        case 'cancel_listing':
          await session.message.edit({ content: 'Listing creation cancelled.', embeds: [], components: [] });
          collector.stop();
          break;
      }
    } catch (error) {
      console.error('Listing collector error:', error);
      try { await interaction.followUp({ content: 'An error occurred.'}); } catch (_) {}
    }
  });

  collector.on('end', () => {
    activeSessions.delete(session.userId);
  });
}

// Replace your existing showWantedTypeSelection with this corrected version
async function showWantedTypeSelection(interaction, session) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('wanted_type_first')
    .setPlaceholder('Choose wanted match type')
    .setMaxValues(1)
    .addOptions([
      { label: 'Specific card (exact rarity)', value: 'specific', description: 'Require exact rarity and name' },
      { label: 'Any card of a rarity', value: 'any_name', description: 'Match any card of a chosen rarity' }
    ]);

  const row = new ActionRowBuilder().addComponents(menu);

  // reply with the select menu (ephemeral)
  await interaction.reply({ content: 'How should this wanted item be matched?', components: [row], ephemeral: false });

  const choice = await interaction.channel.awaitMessageComponent({
    filter: (i) => i.customId === 'wanted_type_first' && i.user.id === session.userId,
    time: 60000
  }).catch(() => null);

  if (!choice) {
    try { await interaction.followUp({ content: 'Timed out selecting wanted type.', ephemeral: true }); } catch (_) {}
    return;
  }

  // Do NOT defer or reply to `choice` if we plan to show a modal using it.
  const selected = choice.values[0];
  session.pendingWantedType = selected;

  if (selected === 'any_name') {
  // Ask for rarity selection (ephemeral)
  const rarities = Object.keys(pools).slice(0, 25);
  const rarityMenu = new StringSelectMenuBuilder()
    .setCustomId('any_name_rarity_first')
    .setPlaceholder('Select rarity for "Any <rarity> card"')
    .setMaxValues(1);

  rarities.forEach(r => rarityMenu.addOptions({ label: r, value: r }));
  const rarityRow = new ActionRowBuilder().addComponents(rarityMenu);

  // interaction was already replied to above, so followUp is correct
  await choice.update({
    content: 'Select the rarity for the "Any <rarity> card" option:',
    components: [rarityRow]
  });

  const rarityChoice = await interaction.channel.awaitMessageComponent({
    filter: (i) => i.customId === 'any_name_rarity_first' && i.user.id === session.userId,
    time: 60000
  }).catch(() => null);

  if (!rarityChoice) {
    try { await interaction.followUp({ content: 'Timed out selecting rarity.', ephemeral: true }); } catch (_) {}
    delete session.pendingWantedType;
    return;
  }

  // Add the wanted item immediately (no search needed)
  const chosenRarity = rarityChoice.values[0];
  session.wanted.push({ type: 'any_name', rarity: chosenRarity });

  // Clear pending fields (defensive)
  delete session.pendingWantedType;
  delete session.pendingWantedRarity;

  // Update the main session message and confirm to the user
  await updateSessionMessage(session);
  
  await rarityChoice.deferUpdate();
  await choice.deleteReply(); // remove the select menu message
  
  //await rarityChoice.update({ content: `✅ Wanted: any ${chosenRarity} card added.`, ephemeral: true });

  return;
}


  // For specific or any_rarity: show the modal using the original choice interaction
  return await showCardSearchModal(choice, session, 'wanted');
}


async function showCardSearchModal(interaction, session, type) {
  const modal = new ModalBuilder()
    .setCustomId(`card_search_${type}_${Date.now()}`)
    .setTitle('Search Card');

  const searchInput = new TextInputBuilder()
    .setCustomId('search')
    .setLabel('Card name (partial search)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(searchInput));

  // showModal must be called on the interaction that triggered this flow (we pass that in)
  await interaction.showModal(modal);

  const modalSubmit = await interaction.awaitModalSubmit({
    filter: (i) => i.customId.startsWith('card_search_') && i.user.id === session.userId,
    time: 60000
  });

  const searchTermRaw = modalSubmit.fields.getTextInputValue('search');
  const searchTerm = String(searchTermRaw).toLowerCase().trim();

  if (type === 'wanted') {
    // Build universe from pools
    const universe = [];
    const RARITY_ORDER = Object.keys(pools);
    for (const rarity of RARITY_ORDER) {
      const files = Array.isArray(pools[rarity]) ? pools[rarity] : [];
      for (const f of files) {
        const name = path.basename(f, path.extname(f));
        universe.push({ rarity, name, file: f });
      }
    }

    // Filter by search term
    const availableCards = universe.filter(c => c.name.toLowerCase().includes(searchTerm));

    if (availableCards.length === 0) {
      return modalSubmit.reply({ content: `No cards found matching "${searchTermRaw}".`, ephemeral: true });
    }

    // Ensure a wanted type was chosen earlier (this function expects session.pendingWantedType to be set)
    const pendingType = session.pendingWantedType;
    if (!pendingType) {
      return modalSubmit.reply({ content: 'Wanted type not selected. Please choose the wanted type first and try again.', ephemeral: true });
    }

    // Single result: add according to pending type (specific or any_name)
    if (availableCards.length === 1) {
      const card = availableCards[0];

      if (pendingType === 'specific') {
        session.wanted.push({ type: 'specific', name: card.name, rarity: card.rarity });
      } else if (pendingType === 'any_name') {
        // any_name uses the previously selected rarity
        session.wanted.push({ type: 'any_name', rarity: session.pendingWantedRarity });
      }

      // Clear pending fields and update UI
      delete session.pendingWantedType;
      delete session.pendingWantedRarity;
      await updateSessionMessage(session);
      
      //return modalSubmit.reply({ content: '✅ Wanted card added!', ephemeral: true });
    }

    // Multiple results -> show select menu (will use pending type when user selects)
    // For specific: user will pick exact card; for any_name we only need rarity (already chosen)
    return await showCardSelectMenu(modalSubmit, session, type, availableCards);
  } else {
    // offering: search user's own cards
    const userDoc = await User.findOne({ id: session.userId });
    const availableCards = (userDoc?.cards || []).filter(card =>
      !card.locked &&
      card.name.toLowerCase().includes(searchTerm)
    );

    if (availableCards.length === 0) {
      return modalSubmit.reply({
        content: `No available cards found matching "${searchTermRaw}".`,
        ephemeral: true
      });
    }

    if (availableCards.length === 1) {
      await askForQuantity(modalSubmit, session, type, availableCards[0]);
      return;
    }

    await showCardSelectMenu(modalSubmit, session, type, availableCards);
  }
}

async function showCardSelectMenu(interaction, session, type, availableCards) {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`card_select_${type}`)
    .setPlaceholder('Select a card...')
    .setMaxValues(1);

  // Limit to 25 options and sort by name
  availableCards.slice(0, 25).sort((a, b) => a.name.localeCompare(b.name)).forEach((card) => {
    const value = type === 'wanted'
      ? `univ::${card.name}::${card.rarity}` // universe card
      : `user::${card.name}::${card.rarity}`; // user card

    selectMenu.addOptions({
      label: card.name.length > 25 ? card.name.substring(0, 22) + '...' : card.name,
      description: type === 'wanted' ? `${card.rarity}` : `${card.rarity} - You have ${card.count}`,
      value
    });
  });

  const row = new ActionRowBuilder().addComponents(selectMenu);

  // ephemeral reply for selection UI so only user sees it
  await interaction.reply({
    content: `Found ${availableCards.length} cards. Select one:`,
    components: [row],
    ephemeral: false
  });

  const selectInteraction = await interaction.channel.awaitMessageComponent({
    filter: (i) => i.customId === `card_select_${type}` && i.user.id === session.userId,
    time: 60000
  });

  const [scope, cardName, rarity] = selectInteraction.values[0].split('::');

  if (scope === 'univ') {
    // Universe/wanted card selected
    const cardObj = { name: cardName, rarity };
    const pendingType = session.pendingWantedType;

    if (!pendingType) {
      await selectInteraction.reply({ content: 'Wanted type not set. Please start again and choose a wanted type first.', ephemeral: true });
      return;
    }

    if (pendingType === 'specific') {
      session.wanted.push({ type: 'specific', name: cardObj.name, rarity: cardObj.rarity });
    } else if (pendingType === 'any_name') {
      session.wanted.push({ type: 'any_name', rarity: session.pendingWantedRarity });
    }

    // Clear pending fields and update UI
    delete session.pendingWantedType;
    delete session.pendingWantedRarity;

    await updateSessionMessage(session);
    await selectInteraction.deferUpdate();
    await interaction.deleteReply(); // remove the select menu message
    //await selectInteraction.followUp({ content: '✅ Wanted card added!', ephemeral: true });
  } else {
    // User card selected (offering flow)
    const userDoc = await User.findOne({ id: session.userId });
    const selectedCard = (userDoc?.cards || []).find(c => c.name === cardName && c.rarity === rarity);
    await askForQuantity(selectInteraction, session, type, selectedCard);
  }
}

// Helper: safe await for components
async function awaitComponentSafe(channel, filter, options = {}) {
  try {
    return await channel.awaitMessageComponent({ filter, ...options });
  } catch (e) {
    return null;
  }
}

// Prompt the initiator to choose exact cards for each wanted item
async function promptInitiatorChoices(interaction, listing, initiatorDoc) {
  const components = [];
  const mapping = [];

  for (let i = 0; i < listing.wanted.length; i++) {
    const want = listing.wanted[i];

    let eligible = [];
    if (want.type === 'specific') {
      eligible = (initiatorDoc.cards || []).filter(c =>
        String(c.name) === String(want.name) &&
        String(c.rarity || '').toUpperCase() === String(want.rarity).toUpperCase() &&
        !c.locked && c.count > 0
      );
    } else if (want.type === 'any_name') {
      eligible = (initiatorDoc.cards || []).filter(c =>
        String(c.rarity || '').toUpperCase() === String(want.rarity).toUpperCase() && !c.locked && c.count > 0
      );
    } else {
      await interaction.followUp({ content: `Unsupported wanted type: ${want.type}`, ephemeral: true });
      return null;
    }

    if (eligible.length === 0) {
      await interaction.followUp({ content: `You have no eligible cards for wanted item #${i + 1}.`, ephemeral: true });
      return null;
    }

    const customId = `choose_want_${listing._id}_${i}_${Date.now()}`;
    const select = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(`Choose card for wanted #${i + 1}`)
      .setMaxValues(1);

    eligible.slice(0, 25).forEach(c => {
      const value = `${c.name}::${c.rarity}`;
      select.addOptions({
        label: c.name.length > 25 ? c.name.slice(0, 22) + '...' : c.name,
        description: `${c.rarity} • You have ${c.count}`,
        value
      });
    });

    components.push(new ActionRowBuilder().addComponents(select));
    mapping.push({ index: i, want, customId });
  }

  await interaction.followUp({
    content: 'Select which card you will give for each wanted item.',
    components,
    ephemeral: true
  });

  const chosenWanted = new Array(listing.wanted.length).fill(null);

  for (const map of mapping) {
    const filter = (i) => i.user.id === interaction.user.id && i.customId === map.customId;
    const selectInteraction = await awaitComponentSafe(interaction.channel, filter, { time: 60000*2 });
    if (!selectInteraction) {
      await interaction.followUp({ content: 'Selection timed out. Trade cancelled.', ephemeral: true });
      return null;
    }
    const [name, rarity] = selectInteraction.values[0].split('::');
    await selectInteraction.deferUpdate();
    chosenWanted[map.index] = { name, rarity };
  }

  return chosenWanted;
}

/**
 * Attempts to transfer cards:
 * - owner -> initiator: listing.offering (counts)
 * - initiator -> owner: listing.wanted (only 'specific' type supported here)
 *
 * Returns { success: boolean, reason?: string }
 *
 * NOTE: This is a best-effort single-process approach. For production with concurrent writes,
 * use MongoDB transactions (replica set) or stronger locking.
 */
// Updated performForcedTrade that accepts chosenWanted and validates them inside the transaction
async function performForcedTrade(ownerId, initiatorId, listing, chosenWanted) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const owner = await User.findOne({ id: ownerId }).session(session).exec();
    const initiator = await User.findOne({ id: initiatorId }).session(session).exec();

    if (!owner || !initiator) {
      await session.abortTransaction();
      return { success: false, reason: 'One of the users could not be found.' };
    }

    const findCard = (user, name, rarity) => {
      if (!user.cards || !Array.isArray(user.cards)) return null;
      return user.cards.find(c =>
        String(c.name) === String(name) &&
        String(c.rarity || '').toUpperCase() === String(rarity).toUpperCase()
      );
    };

    // Validate owner still has offered cards
    for (const offer of listing.offering) {
      const card = findCard(owner, offer.name, offer.rarity);
      if (!card || card.count < offer.count || card.locked) {
        await session.abortTransaction();
        return { success: false, reason: `Owner no longer has ${offer.count}x [${offer.rarity}] ${offer.name}.` };
      }
    }

    // Validate chosenWanted presence and alignment
    if (!Array.isArray(chosenWanted) || chosenWanted.length !== listing.wanted.length) {
      await session.abortTransaction();
      return { success: false, reason: 'Invalid chosen cards provided.' };
    }

    for (let i = 0; i < listing.wanted.length; i++) {
      const want = listing.wanted[i];
      const chosen = chosenWanted[i];
      if (!chosen || !chosen.name || !chosen.rarity) {
        await session.abortTransaction();
        return { success: false, reason: `Missing chosen card for wanted item #${i + 1}.` };
      }

      if (want.type === 'specific') {
        if (String(chosen.name) !== String(want.name) || String(chosen.rarity).toUpperCase() !== String(want.rarity).toUpperCase()) {
          await session.abortTransaction();
          return { success: false, reason: `Chosen card does not match required specific item for wanted #${i + 1}.` };
        }
      } else if (want.type === 'any_name') {
        if (String(chosen.rarity).toUpperCase() !== String(want.rarity).toUpperCase()) {
          await session.abortTransaction();
          return { success: false, reason: `Chosen card does not match required rarity for wanted #${i + 1}.` };
        }
      } else {
        await session.abortTransaction();
        return { success: false, reason: `Wanted type "${want.type}" is not supported for forced trades.` };
      }

      const initiatorCard = findCard(initiator, chosen.name, chosen.rarity);
      if (!initiatorCard || initiatorCard.count < 1 || initiatorCard.locked) {
        await session.abortTransaction();
        return { success: false, reason: `You do not have the chosen card: [${chosen.rarity}] ${chosen.name}.` };
      }
    }

    // Perform transfers owner -> initiator for offering
    for (const offer of listing.offering) {
      const cardIndex = owner.cards.findIndex(c =>
        String(c.name) === String(offer.name) &&
        String(c.rarity || '').toUpperCase() === String(offer.rarity).toUpperCase()
      );

      if (cardIndex !== -1) {
        owner.cards[cardIndex].count -= offer.count;
        if (owner.cards[cardIndex].count <= 0) owner.cards.splice(cardIndex, 1);
      } else {
        await session.abortTransaction();
        return { success: false, reason: `Owner missing offered card ${offer.name} [${offer.rarity}] during transfer.` };
      }
    }

    // Remove chosen wanted cards from initiator
    for (const chosen of chosenWanted) {
      const cardIndex = initiator.cards.findIndex(c =>
        String(c.name) === String(chosen.name) &&
        String(c.rarity || '').toUpperCase() === String(chosen.rarity).toUpperCase()
      );

      if (cardIndex !== -1) {
        initiator.cards[cardIndex].count -= 1;
        if (initiator.cards[cardIndex].count <= 0) initiator.cards.splice(cardIndex, 1);
      } else {
        await session.abortTransaction();
        return { success: false, reason: `Initiator missing chosen card ${chosen.name} [${chosen.rarity}] during transfer.` };
      }
    }

    // Add offered cards to initiator
    for (const offer of listing.offering) {
      const cardIndex = initiator.cards.findIndex(c =>
        String(c.name) === String(offer.name) &&
        String(c.rarity || '').toUpperCase() === String(offer.rarity).toUpperCase()
      );

      if (cardIndex !== -1) {
        initiator.cards[cardIndex].count += offer.count;
      } else {
        initiator.cards.push({
          name: offer.name,
          rarity: offer.rarity,
          count: offer.count,
          timestamps: [new Date()]
        });
      }
    }

    // Add chosen wanted cards to owner
    for (const chosen of chosenWanted) {
      const cardIndex = owner.cards.findIndex(c =>
        String(c.name) === String(chosen.name) &&
        String(c.rarity || '').toUpperCase() === String(chosen.rarity).toUpperCase()
      );

      if (cardIndex !== -1) {
        owner.cards[cardIndex].count += 1;
      } else {
        owner.cards.push({
          name: chosen.name,
          rarity: chosen.rarity,
          count: 1,
          timestamps: [new Date()]
        });
      }
    }

    owner.markModified('cards');
    initiator.markModified('cards');

    await owner.save({ session });
    await initiator.save({ session });

    await session.commitTransaction();
    return { success: true };

  } catch (error) {
    await session.abortTransaction();
    console.error('Trade transaction error:', error);
    return { success: false, reason: 'Database error during trade.' };
  } finally {
    session.endSession();
  }
}


async function askForQuantity(interaction, session, type, card) {
  const modal = new ModalBuilder()
    .setCustomId(`quantity_modal_${Date.now()}`)
    .setTitle(`Quantity for ${card.name}`);

  const quantityInput = new TextInputBuilder()
    .setCustomId('quantity')
    .setLabel(`How many? (max: ${card.count})`)
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(quantityInput));

  await interaction.showModal(modal);

  const modalSubmit = await interaction.awaitModalSubmit({
    filter: (i) => i.customId.startsWith('quantity_modal_') && i.user.id === session.userId,
    time: 60000
  });

  const quantity = parseInt(modalSubmit.fields.getTextInputValue('quantity'));
  
  if (isNaN(quantity) || quantity < 1 || quantity > card.count) {
    await modalSubmit.reply({ 
      content: `Invalid quantity. Must be between 1 and ${card.count}.`, 
    });
    return;
  }

  // Add to session
  if (type === 'offering') {
    session.offering.push({
      name: card.name,
      rarity: card.rarity,
      count: quantity
    });
  } else {
    session.wanted.push({
      type: 'specific',
      name: card.name,
      rarity: card.rarity
    });
  }

  await updateSessionMessage(session);
  await modalSubmit.deferUpdate();
  await interaction.deleteReply(); // remove the modal message
  //await modalSubmit.reply({ content: '✅ Card added!', flags: 64 });
}

async function askForWantedConfirm(interaction, session, card) {
  // Acknowledge the interaction and add wanted item
  // interaction may be a modal submit or select interaction; use deferUpdate if needed
  if (!interaction.deferred && !interaction.replied) {
    try { await interaction.deferUpdate(); } catch (e) { /* ignore */ }
  }

  session.wanted.push({
    type: 'specific',
    name: card.name,
    rarity: card.rarity
  });

  await updateSessionMessage(session);

  // send ephemeral confirmation
  try {
    if (!interaction.replied) {
      await interaction.followUp({ content: '✅ Wanted card added!', ephemeral: true });
    } else {
      await interaction.editReply({ content: '✅ Wanted card added!', ephemeral: true });
    }
  } catch (e) {
    // fallback: try a reply if followUp fails
    try { await interaction.channel.send({ content: '✅ Wanted card added!', ephemeral: true }); } catch (_) {}
  }
}

async function updateSessionMessage(session) {
  try {
    // Try to refresh the message from the channel to avoid stale cache
    const channel = await session.message.channel.fetch();
    const msg = await channel.messages.fetch(session.message.id).catch(() => null);
    if (!msg) {
      // session message missing — stop session gracefully
      activeSessions.delete(session.userId);
      return;
    }
    const embed = createListingEmbed(session);
    const components = createListingComponents(session);
    await msg.edit({ embeds: [embed], components });
    session.message = msg;
  } catch (err) {
    console.error('Failed to update session message:', err);
  }
}

// Updated handleInitiateTrade to prompt initiator and pass chosenWanted to the transaction
async function handleInitiateTrade(interaction, listing, sentMessage) {
  const initiatorId = interaction.user.id;
  const ownerId = listing.userId;

  if (initiatorId === ownerId) {
    return interaction.followUp({ content: 'You cannot initiate a trade on your own listing.', ephemeral: true });
  }

  const freshListing = await TradeListing.findById(listing._id).exec();
  if (!freshListing || freshListing.status !== 'active') {
    return interaction.followUp({ content: 'This listing is no longer active.', ephemeral: true });
  }

  const initiatorDoc = await User.findOne({ id: initiatorId }).exec();
  if (!initiatorDoc) {
    return interaction.followUp({ content: 'Could not load your inventory.', ephemeral: true });
  }

  const chosenWanted = await promptInitiatorChoices(interaction, freshListing, initiatorDoc);
  if (!chosenWanted) return;

  const summary = chosenWanted.map((c, idx) => `Wanted #${idx + 1}: ${c.name} [${c.rarity}]`).join('\n');
  await interaction.followUp({ content: `You selected:\n${summary}\nAttempting trade...`, ephemeral: true });

  const result = await performForcedTrade(ownerId, initiatorId, freshListing, chosenWanted);

  if (!result.success) {
    return interaction.followUp({ content: `Trade failed: ${result.reason}`, ephemeral: true });
  }

  freshListing.status = 'completed';
  await freshListing.save();

  try {
    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`initiate_trade_${listing._id}`)
        .setLabel('Initiate Trade')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true)
    );
    await sentMessage.edit({ components: [disabledRow] });
  } catch (e) { /* ignore edit errors */ }

  await interaction.followUp({ content: `✅ Trade completed between <@${ownerId}> and <@${initiatorId}>.`, ephemeral: true });

  try {
    await interaction.channel.send({ content: `✅ Trade completed between <@${ownerId}> and <@${initiatorId}> (Listing ID: ${listing._id}).` });
  } catch (e) { /* ignore */ }
}


async function showPreview(interaction, session) {
  const embed = new EmbedBuilder()
    .setTitle('📋 Listing Preview')
    .setColor(0x00AAFF)
    .setDescription('This is how your listing will appear to others:')
    .addFields(
      {
        name: '🔄 Offering',
        value: session.offering.map(o => `• ${o.count}x [${o.rarity}] ${o.name}`).join('\n') || 'None'
      },
      {
        name: '🎯 Wanted', 
        value: session.wanted.map(w => {
          switch (w.type) {
            case 'specific': return `• [${w.rarity}] ${w.name}`;
            case 'any_name': return `• Any ${w.rarity} card`;
          }
        }).join('\n') || 'None'
      }
    );

  await interaction.followUp({ embeds: [embed], flags: 64 });
}

async function publishListing(interaction, session) {
  // Validate user still has the cards
  const userDoc = await User.findOne({ id: session.userId });
  for (const offer of session.offering) {
    const card = userDoc.cards.find(c => c.name === offer.name && c.rarity === offer.rarity);
    if (!card || card.count < offer.count || card.locked) {
      return session.message.edit({ 
        content: `You no longer have ${offer.count}x [${offer.rarity}] ${offer.name} available!`, 
        embeds: [], 
        components: [] 
      });
    }
  }

  // Create listing
  const listing = new TradeListing({
    userId: session.userId,
    username: session.username,
    offering: session.offering,
    wanted: session.wanted,
    status: 'active'
  });

  await listing.save();

  // Post to channel
  await postToChannel(interaction, listing);

  await session.message.edit({ 
    content: `✅ Listing published! ID: ${listing._id}`, 
    embeds: [], 
    components: [] 
  });
}

async function postToChannel(interaction, listing) {
  if (!config.listingChannelId) return;

  const channel = await interaction.client.channels.fetch(config.listingChannelId);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle('🔄 Wanted Listing')
    .setColor(0x00AAFF)
    .setDescription(`**Trader:** <@${listing.userId}>`)
    .addFields(
      { name: 'Offering', value: listing.offering.map(o => `• ${o.count}x [${o.rarity}] ${o.name}`).join('\n') },
      { name: 'Wanted', value: listing.wanted.map(w => formatWantedItem(w)).join('\n') }
    )
    .setFooter({ text: `ID: ${listing._id} • Expires: ${new Date(listing.expiresAt).toLocaleString()}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`initiate_trade_${listing._id}`)
      .setLabel('Initiate Trade')
      .setStyle(ButtonStyle.Primary)
  );

  const sent = await channel.send({ embeds: [embed], components: [row] });

  // Collector to handle the "Initiate Trade" button clicks
  const collector = sent.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 7 * 24 * 60 * 60 * 1000 // keep for listing lifetime (7 days)
  });

  collector.on('collect', async (btnInt) => {
    // Only handle the correct customId pattern
    if (!btnInt.customId.startsWith(`initiate_trade_${listing._id}`)) return;

    try {
      // Acknowledge quickly so the client doesn't show "This interaction failed"
      await btnInt.deferReply({ ephemeral: true });

      // Handle the trade attempt
      await handleInitiateTrade(btnInt, listing, sent);
    } catch (err) {
      console.error('initiate trade error', err);
      try { await btnInt.followUp({ content: 'An internal error occurred.', ephemeral: true }); } catch (_) {}
    }
  });

  collector.on('end', () => {
    // Optionally disable the button when collector ends
    try {
      row.components[0].setDisabled(true);
      sent.edit({ components: [row] }).catch(() => {});
    } catch (e) {}
  });

  return sent;
}


function formatWantedItem(item) {
  switch (item.type) {
    case 'specific': return `• [${item.rarity}] ${item.name}`;
    case 'any_name': return `• Any ${item.rarity} card`;
  }
}

async function listActiveListings(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  
  // Get user's active listings
  const listings = await TradeListing.find({ 
    userId: userId,
    status: 'active',
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 }).lean();

  if (!listings || listings.length === 0) {
    return interaction.editReply({ 
      content: 'You have no active trade listings.',
      ephemeral: true 
    });
  }

  const embed = new EmbedBuilder()
    .setTitle('Your Active Trade Listings')
    .setColor(0x00AAFF)
    .setDescription(`You have **${listings.length}** active listing(s):`);

  listings.forEach((listing, index) => {
    const offeringText = listing.offering.map(o => `• ${o.count}x [${o.rarity}] ${o.name}`).join('\n');
    const wantedText = listing.wanted.map(w => {
      switch (w.type) {
        case 'specific': return `• [${w.rarity}] ${w.name}`;
        case 'any_name': return `• Any ${w.rarity} card`;
      }
    }).join('\n');

    embed.addFields({
      name: `Listing ${index + 1} (ID: ${listing._id})`,
      value: `**Offering:**\n${offeringText}\n\n**Wanted:**\n${wantedText}\n**Expires:** <t:${Math.floor(listing.expiresAt.getTime() / 1000)}:R>`,
      inline: false
    });
  });

  // Add cancel buttons for each listing
  const rows = [];
  for (let i = 0; i < listings.length; i += 4) {
    const row = new ActionRowBuilder();
    const batch = listings.slice(i, i + 4);
    
    batch.forEach((listing, index) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`cancel_${listing._id}`)
          .setLabel(`Cancel #${i + index + 1}`)
          .setStyle(ButtonStyle.Danger)
      );
    });
    
    rows.push(row);
  }

  await interaction.editReply({ 
    embeds: [embed], 
    components: rows,
    ephemeral: true 
  });

  // Set up collector for cancel buttons
  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120000 // 2 minutes
  });

  collector.on('collect', async (buttonInteraction) => {
    if (buttonInteraction.user.id !== userId) {
      return buttonInteraction.reply({ 
        content: 'These are not your listings.', 
        ephemeral: true 
      });
    }

    const listingId = buttonInteraction.customId.split('_')[1];
    
    try {
      await buttonInteraction.deferUpdate();
      
      // Find and cancel the listing
      const listing = await TradeListing.findOne({ 
        _id: listingId, 
        userId: userId 
      });
      
      if (!listing) {
        return buttonInteraction.followUp({ 
          content: 'Listing not found or already cancelled.', 
          ephemeral: true 
        });
      }

      listing.status = 'cancelled';
      await listing.save();

      // Update the message to remove the cancelled listing
      const updatedListings = await TradeListing.find({ 
        userId: userId,
        status: 'active',
        expiresAt: { $gt: new Date() }
      }).sort({ createdAt: -1 }).lean();

      if (updatedListings.length === 0) {
        await buttonInteraction.editReply({ 
          content: '✅ Listing cancelled. You have no more active listings.',
          embeds: [],
          components: []
        });
        collector.stop();
        return;
      }

      const updatedEmbed = new EmbedBuilder()
        .setTitle('Your Active Trade Listings')
        .setColor(0x00AAFF)
        .setDescription(`You have **${updatedListings.length}** active listing(s):`);

      updatedListings.forEach((listing, index) => {
        const offeringText = listing.offering.map(o => `• ${o.count}x [${o.rarity}] ${o.name}`).join('\n');
        const wantedText = listing.wanted.map(w => {
          switch (w.type) {
            case 'specific': return `• [${w.rarity}] ${w.name}`;
            case 'any_name': return `• Any ${w.rarity} card`;
          }
        }).join('\n');

        updatedEmbed.addFields({
          name: `Listing ${index + 1} (ID: ${listing._id})`,
          value: `**Offering:**\n${offeringText}\n\n**Wanted:**\n${wantedText}\n**Expires:** <t:${Math.floor(listing.expiresAt.getTime() / 1000)}:R>`,
          inline: false
        });
      });

      // Update buttons
      const updatedRows = [];
      for (let i = 0; i < updatedListings.length; i += 4) {
        const row = new ActionRowBuilder();
        const batch = updatedListings.slice(i, i + 4);
        
        batch.forEach((listing, index) => {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`cancel_${listing._id}`)
              .setLabel(`Cancel #${i + index + 1}`)
              .setStyle(ButtonStyle.Danger)
          );
        });
        
        updatedRows.push(row);
      }

      await buttonInteraction.editReply({ 
        embeds: [updatedEmbed], 
        components: updatedRows 
      });

      await buttonInteraction.followUp({ 
        content: `✅ Listing ${listingId} has been cancelled.`, 
        ephemeral: true 
      });

    } catch (error) {
      console.error('Cancel listing error:', error);
      await buttonInteraction.followUp({ 
        content: 'Error cancelling listing. Please try again.', 
        ephemeral: true 
      });
    }
  });

  collector.on('end', () => {
    // Optionally disable buttons when collector ends
    try {
      const disabledRows = rows.map(row => {
        const disabledRow = ActionRowBuilder.from(row);
        disabledRow.components.forEach(btn => btn.setDisabled(true));
        return disabledRow;
      });
      message.edit({ components: disabledRows }).catch(() => {});
    } catch (e) {}
  });
}
