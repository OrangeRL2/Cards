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
    message: null
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
          case 'any_rarity': return `**${index + 1}.** Any rarity: ${item.name}`;
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
      .setCustomId('preview_listing')
      .setLabel('Preview Listing')
      .setStyle(ButtonStyle.Secondary),
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
      // Defer update immediately to avoid "already replied" errors
      //await interaction.deferUpdate();

      switch (interaction.customId) {
        case 'add_offering':
            // showModal must be called directly in response to the interaction
            await showCardSearchModal(interaction, session, 'offering');
            break;
        case 'add_wanted':
          await showWantedTypeSelection(interaction, session);
          break;
        case 'remove_last_offering':
            session.offering.pop();

            // Acknowledge quickly so the client doesn't show failure
            await interaction.deferUpdate();

            // Then update the stored message (or use interaction.update if you want to update the same message)
            await updateSessionMessage(session);
            break;
          break;
        case 'remove_last_wanted':
          session.wanted.pop();
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
      await interaction.followUp({ content: 'An error occurred.'});
    }
  });

  collector.on('end', () => {
    activeSessions.delete(session.userId);
  });
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

  await interaction.showModal(modal);

  const modalSubmit = await interaction.awaitModalSubmit({
    filter: (i) => i.customId.startsWith('card_search_') && i.user.id === session.userId,
    time: 60000
  });

  const searchTerm = modalSubmit.fields.getTextInputValue('search').toLowerCase();

  if (type === 'wanted') {
    // Build universe from pools (same logic as miss)
    const universe = [];
    const RARITY_ORDER = Object.keys(pools); // or keep your RARITY_ORDER constant if available
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
      return modalSubmit.reply({ content: `No cards found matching "${searchTerm}".`, ephemeral: true });
    }

    if (availableCards.length === 1) {
      // For wanted we don't need quantity; ask for rarity confirmation (if needed)
      return await askForWantedConfirm(modalSubmit, session, availableCards[0]);
    }

    return await showCardSelectMenu(modalSubmit, session, type, availableCards);
  } else {
    // offering: search user's own cards as before
    const userDoc = await User.findOne({ id: session.userId });
    const availableCards = (userDoc?.cards || []).filter(card =>
      !card.locked &&
      card.name.toLowerCase().includes(searchTerm)
    );

    if (availableCards.length === 0) {
      return modalSubmit.reply({
        content: `No available cards found matching "${searchTerm}".`,
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
    ephemeral: true
  });

  const selectInteraction = await interaction.channel.awaitMessageComponent({
    filter: (i) => i.customId === `card_select_${type}` && i.user.id === session.userId,
    time: 60000
  });

  const [scope, cardName, rarity] = selectInteraction.values[0].split('::');

  if (scope === 'univ') {
    // Universe/wanted card selected
    const cardObj = { name: cardName, rarity };
    await askForWantedConfirm(selectInteraction, session, cardObj);
  } else {
    // User card selected
    const userDoc = await User.findOne({ id: session.userId });
    const selectedCard = (userDoc?.cards || []).find(c => c.name === cardName && c.rarity === rarity);
    await askForQuantity(selectInteraction, session, type, selectedCard);
  }
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
async function performForcedTrade(ownerId, initiatorId, listing) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Load both users within transaction
    const owner = await User.findOne({ id: ownerId }).session(session).exec();
    const initiator = await User.findOne({ id: initiatorId }).session(session).exec();

    if (!owner || !initiator) {
      await session.abortTransaction();
      return { success: false, reason: 'One of the users could not be found.' };
    }

    // Improved card finding function that handles your data structure
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

    // Validate initiator has wanted cards (only specific types)
    for (const want of listing.wanted) {
      if (want.type === 'specific') {
        const card = findCard(initiator, want.name, want.rarity);
        if (!card || card.count < 1 || card.locked) {
          await session.abortTransaction();
          return { success: false, reason: `You do not have the required wanted card: [${want.rarity}] ${want.name}.` };
        }
      } else {
        await session.abortTransaction();
        return { success: false, reason: `Wanted type "${want.type}" is not supported for forced trades yet.` };
      }
    }

    // SIMPLIFIED APPROACH: Perform transfers without complex locking
    // Since we're in a transaction, we can safely modify
    
    // 1. Remove cards from owners
    for (const offer of listing.offering) {
      const cardIndex = owner.cards.findIndex(c => 
        String(c.name) === String(offer.name) && 
        String(c.rarity || '').toUpperCase() === String(offer.rarity).toUpperCase()
      );
      
      if (cardIndex !== -1) {
        owner.cards[cardIndex].count -= offer.count;
        if (owner.cards[cardIndex].count <= 0) {
          owner.cards.splice(cardIndex, 1);
        }
      }
    }

    // 2. Remove wanted cards from initiator
    for (const want of listing.wanted.filter(w => w.type === 'specific')) {
      const cardIndex = initiator.cards.findIndex(c => 
        String(c.name) === String(want.name) && 
        String(c.rarity || '').toUpperCase() === String(want.rarity).toUpperCase()
      );
      
      if (cardIndex !== -1) {
        initiator.cards[cardIndex].count -= 1;
        if (initiator.cards[cardIndex].count <= 0) {
          initiator.cards.splice(cardIndex, 1);
        }
      }
    }

    // 3. Add received cards to each user
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

    for (const want of listing.wanted.filter(w => w.type === 'specific')) {
      const cardIndex = owner.cards.findIndex(c => 
        String(c.name) === String(want.name) && 
        String(c.rarity || '').toUpperCase() === String(want.rarity).toUpperCase()
      );
      
      if (cardIndex !== -1) {
        owner.cards[cardIndex].count += 1;
      } else {
        owner.cards.push({
          name: want.name,
          rarity: want.rarity,
          count: 1,
          timestamps: [new Date()]
        });
      }
    }

    // Mark documents as modified
    owner.markModified('cards');
    initiator.markModified('cards');

    // Save both users
    await owner.save({ session });
    await initiator.save({ session });

    // Commit transaction
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

// Helper to unlock cards if something fails
async function unlockCards(ownerId, initiatorId, listing) {
  try {
    for (const offer of listing.offering) {
      await User.updateOne(
        { id: ownerId, 'cards.name': offer.name, 'cards.rarity': offer.rarity },
        { $set: { 'cards.$.locked': false } }
      ).exec();
    }
    for (const want of listing.wanted.filter(w => w.type === 'specific')) {
      await User.updateOne(
        { id: initiatorId, 'cards.name': want.name, 'cards.rarity': want.rarity },
        { $set: { 'cards.$.locked': false } }
      ).exec();
    }
  } catch (e) { /* ignore unlock errors */ }
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
  await modalSubmit.reply({ content: '✅ Card added!', flags: 64 });
}

async function showWantedTypeSelection(interaction, session) {
  // Simple implementation - just use the same card search for wanted items
  await showCardSearchModal(interaction, session, 'wanted');
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

// Ensure User model is required at top: const User = require('../../models/User');

async function handleInitiateTrade(interaction, listing, sentMessage) {
  const initiatorId = interaction.user.id;
  const ownerId = listing.userId;

  if (initiatorId === ownerId) {
    return interaction.followUp({ content: 'You cannot initiate a trade on your own listing.', ephemeral: true });
  }

  // Re-fetch fresh listing from DB to ensure status
  const freshListing = await TradeListing.findById(listing._id).exec();
  if (!freshListing || freshListing.status !== 'active') {
    return interaction.followUp({ content: 'This listing is no longer active.', ephemeral: true });
  }

  // Attempt the forced trade
  const result = await performForcedTrade(ownerId, initiatorId, freshListing);

  if (!result.success) {
    return interaction.followUp({ content: `Trade failed: ${result.reason}`, ephemeral: true });
  }

  // Mark listing completed and update DB
  freshListing.status = 'completed';
  await freshListing.save();

  // Disable the button on the posted message
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

  // Notify both parties publicly (or privately if you prefer)
  await interaction.followUp({ content: `✅ Trade completed between <@${ownerId}> and <@${initiatorId}>.`, ephemeral: true });

  try {
    // Optionally DM or mention the owner in channel
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
            case 'any_rarity': return `• Any rarity: ${w.name}`;
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

  // FIX: Remove the duplicate channel.send() call
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
    case 'any_rarity': return `• Any rarity: ${item.name}`;
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
        case 'any_rarity': return `• Any rarity: ${w.name}`;
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
            case 'any_rarity': return `• Any rarity: ${w.name}`;
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

