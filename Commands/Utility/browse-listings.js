// Commands/Utility/browse-listings.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const TradeListing = require('../../models/TradeListing');
const User = require('../../models/User');
const mongoose = require('mongoose');
const PAGE_SIZE = 5; // listings per page

module.exports = {
  data: new SlashCommandBuilder()
    .setName('browse-listings')
    .setDescription('Browse active wanted listings')
    .addStringOption(option =>
      option.setName('filter')
        .setDescription('Filter by card name or rarity')
        .setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const filter = interaction.options.getString('filter');
    const query = { status: 'active', expiresAt: { $gt: new Date() } };
    if (filter) {
      query.$or = [
        { 'offering.name': new RegExp(filter, 'i') },
        { 'offering.rarity': new RegExp(filter, 'i') },
        { 'wanted.name': new RegExp(filter, 'i') },
        { 'wanted.rarity': new RegExp(filter, 'i') }
      ];
    }

    const listings = await TradeListing.find(query).sort({ createdAt: -1 }).limit(100).lean();
    if (!listings || listings.length === 0) {
      return interaction.editReply({
        content: filter ? `No active listings found for "${filter}".` : 'No active wanted listings found.',
        ephemeral: true
      });
    }

    // paginate listings into pages
    const pages = [];
    for (let i = 0; i < listings.length; i += PAGE_SIZE) {
      pages.push(listings.slice(i, i + PAGE_SIZE));
    }

    let pageIndex = 0;

    const buildPageEmbed = (idx) => {
      const page = pages[idx];
      const description = page.map((l, i) => {
        const num = idx * PAGE_SIZE + i + 1;
        const offering = (l.offering && l.offering.length) ? l.offering.map(o => `${o.count}x [${o.rarity}] ${o.name}`).join(', ') : 'None';
        const wanted = (l.wanted && l.wanted.length) ? l.wanted.map(w => {
          switch (w.type) {
            case 'specific': return `[${w.rarity}] ${w.name}`;
            case 'any_rarity': return `Any rarity: ${w.name}`;
            case 'any_name': return `Any ${w.rarity} card`;
            default: return w.name ?? 'Unknown';
          }
        }).join(', ') : 'None';
        return `**${num}.** ${l.username}\nLF: ${wanted}\nTF: ${offering}`;
      }).join('\n\n');

      return new EmbedBuilder()
        .setTitle(`Wanted Listings (page ${idx + 1} of ${pages.length})`)
        .setDescription(description)
        .setColor(0x00AAFF)
        .setFooter({ text: `Use View Listing to see details and initiate trade` });
    };

    const buildControls = (idx) => {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('browse_prev')
          .setLabel('◀ Prev')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(idx === 0),
        new ButtonBuilder()
          .setCustomId('browse_next')
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(idx === pages.length - 1),
        new ButtonBuilder()
          .setCustomId('browse_view')
          .setLabel('View Listing')
          .setStyle(ButtonStyle.Secondary)
      );
      return [row];
    };

    // send initial ephemeral page
    await interaction.editReply({ embeds: [buildPageEmbed(pageIndex)], components: buildControls(pageIndex) });
    const message = await interaction.fetchReply();

    // collector for navigation and view button (ephemeral interactions are still captured)
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120_000 // 2 minutes; adjust as needed
    });

    collector.on('collect', async btnInt => {
      if (btnInt.user.id !== interaction.user.id) {
        return btnInt.reply({ content: 'This browse session is not yours.', ephemeral: true });
      }

      try {
        switch (btnInt.customId) {
          case 'browse_prev':
            pageIndex = Math.max(0, pageIndex - 1);
            await btnInt.update({ embeds: [buildPageEmbed(pageIndex)], components: buildControls(pageIndex) });
            break;

          case 'browse_next':
            pageIndex = Math.min(pages.length - 1, pageIndex + 1);
            await btnInt.update({ embeds: [buildPageEmbed(pageIndex)], components: buildControls(pageIndex) });
            break;

          case 'browse_view':
            // Acknowledge immediately and open an ephemeral detailed view for selection
            await btnInt.deferReply({ ephemeral: true });
            // Ask the user which listing number on the current page to view
            // We'll present a simple numbered select via buttons: one button per item up to PAGE_SIZE
            await showListingSelection(btnInt, pages[pageIndex], pageIndex);
            break;
        }
      } catch (err) {
        console.error('browse-listings collector error', err);
        if (!btnInt.replied && !btnInt.deferred) {
          await btnInt.reply({ content: 'Internal error.', ephemeral: true });
        }
      }
    });

    collector.on('end', async () => {
      try {
        const disabled = buildControls(pageIndex);
        disabled[0].components.forEach(c => c.setDisabled(true));
        await message.edit({ components: disabled });
      } catch (e) { /* ignore */ }
    });

    // helper: show selection of listings on the current page and then show details
    async function showListingSelection(interactionCtx, pageListings, pageIdx) {
      // Build a row of numbered buttons for the items on this page
      const selRow = new ActionRowBuilder();
      pageListings.forEach((l, i) => {
        const num = pageIdx * PAGE_SIZE + i + 1;
        selRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`view_item_${i}`) // index within page
            .setLabel(String(num))
            .setStyle(ButtonStyle.Secondary)
        );
      });

      // Add a cancel button
      selRow.addComponents(
        new ButtonBuilder()
          .setCustomId('view_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Danger)
      );

      await interactionCtx.followUp({ content: 'Select a listing to view:', components: [selRow], ephemeral: true });

      // Wait for the user's selection
      const sel = await interactionCtx.channel.awaitMessageComponent({
        filter: (i) => i.user.id === interactionCtx.user.id && (i.customId.startsWith('view_item_') || i.customId === 'view_cancel'),
        time: 60_000
      }).catch(() => null);

      if (!sel) {
        return interactionCtx.followUp({ content: 'Selection timed out.', ephemeral: true });
      }

      if (sel.customId === 'view_cancel') {
        return sel.update({ content: 'Cancelled.', components: [], ephemeral: true });
      }

      const idxInPage = parseInt(sel.customId.split('_').pop(), 10);
      const listing = pageListings[idxInPage];

      // Show detailed view with Initiate Trade button
      const detailEmbed = new EmbedBuilder()
        .setTitle(`Listing by ${listing.username}`)
        .setColor(0x00AAFF)
        .addFields(
          { name: 'Offering', value: (listing.offering && listing.offering.length) ? listing.offering.map(o => `• ${o.count}x [${o.rarity}] ${o.name}`).join('\n') : 'None' },
          { name: 'Wanted', value: (listing.wanted && listing.wanted.length) ? listing.wanted.map(w => {
            switch (w.type) {
              case 'specific': return `• [${w.rarity}] ${w.name}`;
              case 'any_rarity': return `• Any rarity: ${w.name}`;
              case 'any_name': return `• Any ${w.rarity} card`;
              default: return `• ${w.name ?? 'Unknown'}`;
            }
          }).join('\n') : 'None' }
        )
        .setFooter({ text: `ID: ${listing._id} • Expires: ${new Date(listing.expiresAt).toLocaleString()}` });

      const detailRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`initiate_trade_view_${listing._id}`)
          .setLabel('Initiate Trade')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('detail_close')
          .setLabel('Close')
          .setStyle(ButtonStyle.Secondary)
      );

      // update the selection message to show details (acknowledge)
      await sel.update({ embeds: [detailEmbed], components: [detailRow], ephemeral: true });

      // collector for the detail buttons (ephemeral)
      const detailCollector = sel.message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 5 * 60_000 // 5 minutes
      });

      detailCollector.on('collect', async detailInt => {
        if (detailInt.user.id !== interactionCtx.user.id) {
          return detailInt.reply({ content: 'This view is not yours.', ephemeral: true });
        }

        try {
          if (detailInt.customId === 'detail_close') {
            await detailInt.update({ content: 'Closed.', embeds: [], components: [], ephemeral: true });
            detailCollector.stop();
            return;
          }

          if (detailInt.customId.startsWith('initiate_trade_view_')) {
            await detailInt.deferReply({ ephemeral: true });

            // Re-fetch listing to ensure active
            const fresh = await TradeListing.findById(listing._id).exec();
            if (!fresh || fresh.status !== 'active') {
              return detailInt.followUp({ content: 'This listing is no longer active.', ephemeral: true });
            }

            if (detailInt.user.id === fresh.userId) {
              return detailInt.followUp({ content: 'You cannot initiate a trade on your own listing.', ephemeral: true });
            }

            // Attempt forced trade (supports 'specific' wanted items)
            const result = await performForcedTrade(fresh.userId, detailInt.user.id, fresh);
            if (!result.success) {
              return detailInt.followUp({ content: `Trade failed: ${result.reason}`, ephemeral: true });
            }

            // Mark listing completed
            fresh.status = 'completed';
            await fresh.save();

            // Disable the initiate button in this ephemeral view (edit message)
            try {
              detailRow.components[0].setDisabled(true);
              await detailInt.editReply({ content: '✅ Trade completed.', embeds: [], components: [detailRow], ephemeral: true });
            } catch (e) { /* ignore */ }

            // Optionally announce in channel
            try {
              await interactionCtx.channel.send({ content: `✅ Trade completed between <@${fresh.userId}> and <@${detailInt.user.id}> (Listing ID: ${fresh._id}).` });
            } catch (e) { /* ignore */ }

            detailCollector.stop();
          }
        } catch (err) {
          console.error('detail collector error', err);
          if (!detailInt.replied && !detailInt.deferred) {
            await detailInt.reply({ content: 'Internal error.', ephemeral: true });
          }
        }
      });

      detailCollector.on('end', async () => {
        try {
          // clear components when done
          await sel.message.edit({ components: [] }).catch(() => {});
        } catch (e) { /* ignore */ }
      });
    }
  }
};

// Helper: performForcedTrade (same behavior as your other forced-trade logic)
// Supports only 'specific' wanted items. Returns { success: boolean, reason?: string }
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
  } catch (e) { /* ignore */ }
}
