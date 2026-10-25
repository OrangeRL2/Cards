'use strict';
const {
  SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, AttachmentBuilder
} = require('discord.js');
const config = require('../../config.json');
const hal = require('../../utils/halEvent');
const shop = require('../../utils/halShop');
const { CARDS, isTrickBoo, booFileName } = require('../../config/halTarot');
const { buildHolodoriImageUrl } = require('../../utils/holodoriLoginReward');
const { installLocalImageTransport, resolveOwnImagePath } = require('../../utils/localizeInteractionEmbeds');
const sharp = require('sharp');
const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';
const LOGO_COLOR = 0x9b59b6;

// Same configuration pattern as the Summer menu: name and thumbnail are
// independent of the event's gameplay rules and timing.
function eventName() {
  const configured = String(config.halEventName || '').trim();
  return configured || 'Halloween BOO Event';
}
function withEventLogo(embed) {
  const url = String(config.halLogoUrl || '').trim();
  if (/^https?:\/\//i.test(url)) embed.setThumbnail(url);
  return embed;
}
function row(...buttons) { return new ActionRowBuilder().addComponents(...buttons); }
function button(id, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
}
function id(action, userId) { return `hal:${action}:${userId}`; }
function tarotDetails(card) {
  const effect = {
    0: 'Receive a [???] Halloween X card, then roll another tarot.',
    1: 'Your next paid pack has a guaranteed SEC in slot 8.',
    2: 'Every pulled card is BLUE.', 3: 'Every pulled card is GREEN.',
    4: 'Every pulled card is RED.', 5: 'Each pack costs two pull credits.',
    6: 'Your oshi appears more often in pulls.',
    7: 'Your high-rarity odds are doubled.',
    8: 'No card is lost when you perform lives.',
    9: 'Your oshi cannot appear in pulls.',
    10: 'Fans earned from lives are doubled.',
    11: 'Your next JST day\'s login guarantees a GOOD tarot effect. If you miss that day, the guarantee is forfeited.',
    12: 'Your SEC pity counter decreases instead of increasing.',
    13: 'Lives fail, Guess wins give no card, and SEC pity is frozen.',
    14: 'Every pulled card is WHITE.', 15: 'Every pulled card is PURPLE.',
    16: 'Your high-rarity odds are halved.',
    17: 'All cards pulled are your oshi.',
    18: 'The same member appears in the first four slots.',
    19: 'Every pulled card is YELLOW.',
    20: 'Each paid pack grants an additional eight cards.',
    21: 'At least one SR+ card in every pack.'
  };
  return card ? effect[card.number] : 'No active tarot.';
}
async function view(userId) {
  const [state, card] = await Promise.all([hal.getState(userId), hal.getEffect(userId)]);
  return { state: state || {}, card };
}
function hub(userId, state, card) {
  const active = hal.active();
  const embed = withEventLogo(new EmbedBuilder().setTitle(`🎃 ${eventName()}`).setColor(LOGO_COLOR))
    .setDescription(`${active ? 'Event active' : 'Event not active'} | Oct 24 - Nov 8 (JST)\n` +
      `Daily tarot expires at midnight JST. Collectible BOO cards never activate tarot effects.`)
    .addFields(
      { name: 'Candies', value: String(state.candies || 0), inline: true },
      { name: 'Active Tarot', value: card ? `${card.number} - ${card.name} (${card.member})` : 'None', inline: true },
      { name: 'Effect', value: tarotDetails(card), inline: false },
      { name: 'Shop', value: `BOO card: ${shop.BOO_PRICE} Candies\n10 BOO cards: ${shop.BOO_TEN_PRICE} Candies` +
        (state.firstHolodoriBought ? '' : `\nOne-time HOLODORI 10-pull: ${shop.HOLO_PRICE} Candies (guaranteed 5★)`), inline: false }
    );
  const rows = [row(button(id('shop', userId), 'Candy Shop', ButtonStyle.Primary),
    button(id('tarots', userId), 'Tarot Guide'), button(id('refresh', userId), 'Refresh'))];
  return { content: null, embeds: [embed], components: rows, attachments: [] };
}
function shopMenu(userId, state) {
  const balance = Number(state.candies || 0);
  const holodoriAvailable = state.firstHolodoriBought !== true;
  const description = `You have **${balance} Candies**.\n\n` +
    `**BOO Pull (${shop.BOO_PRICE})**: One collectible draw. Most results are BOO, but the 0.03% Halloween X is a separate [???] rarity.` +
    `\n**10 BOO Pulls (${shop.BOO_TEN_PRICE})**: Ten independent draws, with the same odds per card.` +
    (holodoriAvailable
      ? `\n\n**One-time HOLODORI 10-Pull (${shop.HOLO_PRICE})**: Ten HOLODORI cards with a guaranteed 5★.`
      : '');
  const purchaseButtons = [
    button(id('buyboo', userId), `BOO - ${shop.BOO_PRICE}`, ButtonStyle.Success,
      !hal.active() || balance < shop.BOO_PRICE),
    button(id('buyboo10', userId), `10 BOO - ${shop.BOO_TEN_PRICE}`, ButtonStyle.Success,
      !hal.active() || balance < shop.BOO_TEN_PRICE),
  ];
  if (holodoriAvailable) {
    purchaseButtons.push(button(id('buyholodori', userId), `HOLODORI 10 - ${shop.HOLO_PRICE}`,
      ButtonStyle.Primary, !hal.active() || balance < shop.HOLO_PRICE));
  }
  return {
    content: null,
    embeds: [withEventLogo(new EmbedBuilder().setTitle(`${eventName()} — Candy Shop`)
      .setColor(LOGO_COLOR).setDescription(description))],
    components: [row(...purchaseButtons), row(button(id('home', userId), 'Back to Event Hub'))],
    attachments: [],
  };
}
function purchaseConfirm(userId, item, token, balance) {
  const price = shop.priceOf(item);
  const title = item === 'boo' ? 'one BOO collectible'
    : item === 'boo10' ? 'ten BOO collectibles' : 'ten HOLODORI cards';
  const embed = withEventLogo(new EmbedBuilder().setTitle(`${eventName()} — Confirm Purchase`).setColor(LOGO_COLOR)
    .setDescription(`Spend **${price} Candies** to receive ${title}?\nCurrent balance: **${balance}**.`));
  return { content: null, embeds: [embed], components: [row(
    button(id(`confirm-${item}-${token}`, userId), 'Confirm Purchase', ButtonStyle.Success),
    button(id('shop', userId), 'Cancel'))], attachments: [] };
}
function tarotGuide(userId) {
  const lines = CARDS.map(c => `**${c.number} - ${c.name} (${c.member})** | ${c.weight}%\n${tarotDetails(c)}`);
  return { content: null, embeds: [withEventLogo(new EmbedBuilder().setTitle(`${eventName()} — 22 Tarot Effects`)
    .setDescription(lines.join('\n').slice(0, 4000)).setColor(LOGO_COLOR))],
    components: [row(button(id('home', userId), 'Back to Hub'))], attachments: [] };
}
function booImage(card) {
  return `${IMAGE_BASE.replace(/\/$/, '')}/BOO/${encodeURIComponent(booFileName(card.name))}`;
}
function purchaseResult(userId, result, page, { imageRef = null, logoRef = null, imageUnavailable = false } = {}) {
  const cards = result.cards;
  const card = cards[page];
  const isBoo = result.item === 'boo' || result.item === 'boo10';
  const heading = isBoo ? `[${card.rarity}] ${card.name}` : `${card.signed ? 'SIGNED ' : ''}${card.rarity} ${card.name}`;
  const trickReveal = isBoo && isTrickBoo(card.name)
    ? '\n\n🎃 **YOU\'VE BEEN TRICKED!** A BanG Dream! guest crashed your Halloween candy haul!'
    : '';
  const embed = new EmbedBuilder().setTitle(`${eventName()} — Purchase Complete`).setColor(LOGO_COLOR)
    .setDescription(`Received **${cards.length} card${cards.length === 1 ? '' : 's'}**.\nCandies remaining: **${result.balance}**` +
      (result.first ? '\nGuaranteed 5★ included!' : '') +
      `\n\n**Card ${page + 1}/${cards.length}:** ${heading}` + trickReveal +
      (imageUnavailable ? '\n-# Card artwork is temporarily unavailable.' : ''));
  if (imageRef) embed.setImage(imageRef);
  if (logoRef) embed.setThumbnail(logoRef);
  const nav = cards.length > 1 ? [row(button(id('prev', userId), 'Previous'),
    button(id('next', userId), 'Next'))] : [];
  const actions = [];
  // Reuse this purchase's next token until it succeeds. Old or repeated button
  // interactions cannot charge twice for the same BOO purchase.
  if (isBoo && result.booAgainToken) {
    const repeatPrice = shop.priceOf(result.item);
    actions.push(button(id(`buyagain-${result.booAgainToken}`, userId),
      result.item === 'boo10' ? `10 BOO Again - ${repeatPrice} Candies` : `Pull Again - ${repeatPrice} Candies`,
      ButtonStyle.Success, !hal.active() || Number(result.balance) < repeatPrice));
  }
  actions.push(button(id('shop', userId), 'Continue Shopping', ButtonStyle.Primary));
  actions.push(button(id('home', userId), 'Event Hub'));
  return { content: null, embeds: [embed], components: [...nav, row(...actions)] };
}
module.exports = {
  data: new SlashCommandBuilder().setName('halloween').setDescription('Open the Halloween tarot and Candy shop'),
  async execute(interaction) {
    installLocalImageTransport(interaction);
    await interaction.deferReply({ ephemeral: false });
    const userId = String(interaction.user.id);
    let { state, card } = await view(userId);
    await interaction.editReply(hub(userId, state, card));
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({ time: 10 * 60 * 1000,
      filter: c => c.customId.startsWith('hal:') && c.customId.endsWith(`:${userId}`) });
    let result = null;
    let page = 0;
    let renderedPage = 0;
    let screen = 'hub';
    let busy = false;
    let navigationJob = null;
    let logoAttachmentId = null;
    let logoPromise = null;
    const cardImageCache = new Map();
    const LOGO_NAME = 'hal-event-logo.png';

    // Like Guess, upload real image bytes to Discord instead of relying on the
    // external image host. Resize in memory once per card during this menu.
    function preparedCard(index) {
      if (cardImageCache.has(index)) return cardImageCache.get(index);
      const job = (async () => {
        const card = result.cards[index];
        const source = (result.item === 'boo' || result.item === 'boo10')
          ? booImage(card) : buildHolodoriImageUrl(card, IMAGE_BASE);
        const localPath = resolveOwnImagePath(source);
        if (!localPath) throw new Error(`Card artwork not found locally: ${source}`);
        const image = await sharp(localPath, { failOn: 'none' })
          .rotate()
          .resize({ width: 900, height: 1050, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 83 })
          .toBuffer();
        return { image, name: `hal-card-${index}.jpg` };
      })().catch(err => { cardImageCache.delete(index); throw err; });
      cardImageCache.set(index, job);
      return job;
    }

    function preparedLogo() {
      if (logoPromise) return logoPromise;
      logoPromise = (async () => {
        const source = String(config.halLogoUrl || '').trim();
        const localPath = resolveOwnImagePath(source);
        if (!localPath) return null;
        return await sharp(localPath, { failOn: 'none' })
          .rotate()
          .resize({ width: 240, height: 240, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();
      })().catch(err => {
        console.warn('[halloween] could not prepare the event logo:', err);
        return null;
      });
      return logoPromise;
    }

    function prefetchNeighbors(index) {
      if (!result?.cards || result.cards.length < 2) return;
      const count = result.cards.length;
      for (const neighbor of [(index + 1) % count, (index + count - 1) % count]) {
        preparedCard(neighbor).catch(err => console.warn('[halloween] could not prefetch card:', err.message));
      }
    }

    async function editCardPage(index, fresh = false) {
      let cardFile = null;
      try {
        cardFile = await preparedCard(index);
      } catch (err) {
        console.warn('[halloween] cannot load card artwork:', err.message);
      }
      if (!fresh && (screen !== 'result' || index !== page)) return;

      const logo = await preparedLogo();
      if (!fresh && (screen !== 'result' || index !== page)) return;
      const needLogoUpload = Boolean(logo && (fresh || !logoAttachmentId));
      const files = [];
      if (cardFile) files.push(new AttachmentBuilder(cardFile.image, { name: cardFile.name }));
      if (needLogoUpload) files.push(new AttachmentBuilder(logo, { name: LOGO_NAME }));

      const payload = purchaseResult(userId, result, index, {
        imageRef: cardFile ? `attachment://${cardFile.name}` : null,
        logoRef: logo && (needLogoUpload || logoAttachmentId) ? `attachment://${LOGO_NAME}` : null,
        imageUnavailable: !cardFile,
      });
      payload.files = files;
      // Retain just the existing logo; drop the previous card attachment.
      // On the first page, clear any attachments left by the old menu.
      payload.attachments = fresh || !logoAttachmentId ? [] : [{ id: logoAttachmentId }];

      try {
        const message = await interaction.editReply(payload);
        if (needLogoUpload) {
          const attachments = [...(message?.attachments?.values?.() || [])];
          logoAttachmentId = attachments.find(a => a.name === LOGO_NAME)?.id || null;
        }
      } catch (err) {
        console.warn('[halloween] card attachment edit failed; showing text result:', err);
        logoAttachmentId = null;
        const fallback = purchaseResult(userId, result, index, { imageUnavailable: true });
        // Never fall back to a remote image URL or leave the old card on screen.
        await interaction.editReply({ ...fallback, files: [], attachments: [] });
      }
      prefetchNeighbors(index);
    }

    async function showPurchasedCards(purchased) {
      result = purchased;
      if (result.item === 'boo' || result.item === 'boo10') result.booAgainToken = shop.purchaseToken();
      page = 0;
      renderedPage = 0;
      logoAttachmentId = null;
      cardImageCache.clear();
      await editCardPage(0, true);
      screen = 'result';
    }

    // Rapid button clicks change the requested page immediately. Only one
    // attachment edit runs at a time, skipping intermediate queued pages.
    function queueNavigation() {
      if (navigationJob || screen !== 'result' || !result?.cards?.length || renderedPage === page) return;
      let failed = false;
      navigationJob = (async () => {
        while (screen === 'result' && result?.cards?.length && renderedPage !== page) {
          const requestedPage = page;
          await editCardPage(requestedPage);
          if (screen !== 'result') return;
          // A newer click may have arrived during the image processing.
          if (requestedPage === page) renderedPage = requestedPage;
        }
      })().catch(err => {
        failed = true;
        console.error('[halloween] card navigation failed:', err);
      }).finally(() => {
        navigationJob = null;
        // Catch clicks received right as the worker finishes, but don't
        // automatically retry a Discord failure forever.
        if (!failed && screen === 'result' && renderedPage !== page) queueNavigation();
      });
    }

    collector.on('collect', async c => {
      if (c.user.id !== userId) {
        return c.reply({ content: 'This is someone else’s Halloween menu. Use `/halloween` to open your own!', ephemeral: true })
          .catch(() => null);
      }

      const action = c.customId.slice(4, -(userId.length + 1));
      if (action === 'prev' || action === 'next') {
        if (screen === 'result' && result?.cards?.length) {
          page = (page + (action === 'next' ? 1 : -1) + result.cards.length) % result.cards.length;
        }
        // Acknowledge every click, even if another image is still loading.
        await c.deferUpdate().catch(err => console.warn('[halloween] navigation acknowledgement failed:', err));
        queueNavigation();
        return;
      }

      // Only state-changing and menu-transition actions use the guard.
      // Ignoring duplicated clicks avoids duplicate purchases without spamming
      // players with "previous action is still running" replies.
      if (busy) {
        await c.deferUpdate().catch(() => null);
        return;
      }
      busy = true;
      try {
        await c.deferUpdate();
        if (action === 'home' || action === 'refresh') screen = 'hub';
        else if (action === 'shop') screen = 'shop';
        else if (action === 'tarots') screen = 'tarots';
        else if (action === 'buyboo' || action === 'buyboo10' || action === 'buyholodori') screen = 'confirm';
        else if (action.startsWith('confirm-') || action.startsWith('buyagain-')) screen = 'processing';
        // A previous fast page edit must finish before showing another screen.
        if (navigationJob) await navigationJob;

        if (action === 'home' || action === 'refresh') {
          ({ state, card } = await view(userId));
          return await interaction.editReply(hub(userId, state, card));
        }
        if (action === 'shop') {
          ({ state } = await view(userId));
          return await interaction.editReply(shopMenu(userId, state));
        }
        if (action === 'tarots') return await interaction.editReply(tarotGuide(userId));
        if (action === 'buyboo' || action === 'buyboo10' || action === 'buyholodori') {
          if (!hal.active()) return await interaction.editReply({ content: 'Halloween is not active.', embeds: [], components: [row(button(id('home', userId), 'Hub'))] });
          ({ state } = await view(userId));
          const item = action === 'buyboo' ? 'boo' : action === 'buyboo10' ? 'boo10' : 'holodori';
          if (item === 'holodori' && state.firstHolodoriBought) {
            screen = 'shop';
            return await interaction.editReply(shopMenu(userId, state));
          }
          return await interaction.editReply(purchaseConfirm(userId, item, shop.purchaseToken(), state.candies || 0));
        }
        if (action.startsWith('buyagain-')) {
          const token = action.slice('buyagain-'.length);
          if (!result || !['boo', 'boo10'].includes(result.item) || token !== result.booAgainToken) {
            screen = 'shop';
            ({ state } = await view(userId));
            return await interaction.editReply(shopMenu(userId, state));
          }
          // The token is fixed in the displayed button, and purchase() checks
          // it atomically in MongoDB. One click means one additional purchase.
          const purchased = await shop.purchase(userId, result.item, token);
          if (!purchased.success) {
            screen = 'shop';
            ({ state } = await view(userId));
            return await interaction.editReply({ ...shopMenu(userId, state),
              content: purchased.reason === 'NOT_ENOUGH_CANDY'
                ? 'Not enough Candies for another BOO exchange.'
                : 'That BOO pull could not be completed.' });
          }
          await showPurchasedCards(purchased);
          return;
        }
        if (action.startsWith('confirm-')) {
          const parts = action.split('-');
          const item = parts[1];
          const token = parts.slice(2).join('-');
          const purchased = await shop.purchase(userId, item, token);
          if (!purchased.success) {
            screen = 'shop';
            ({ state } = await view(userId));
            const reason = purchased.reason === 'ALREADY_PURCHASED'
              ? 'That one-time exchange has already been used.'
              : `Purchase failed: ${purchased.reason}`;
            return await interaction.editReply({ ...shopMenu(userId, state), content: reason });
          }
          await showPurchasedCards(purchased);
          return;
        }
      } catch (err) {
        console.error('[halloween]', err);
        screen = 'error';
        await interaction.editReply({ content: 'Halloween command failed. Check bot logs.', embeds: [], components: [row(button(id('home', userId), 'Back'))] }).catch(() => null);
      } finally { busy = false; }
    });
    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => null);
    });
  }
};
