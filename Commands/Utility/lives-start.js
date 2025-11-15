// Commands/Utility/lives-start.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Colors
} = require('discord.js');
const { startAttemptAtomic, getDurationForStage, getStageName } = require('../../utils/liveAsync');
const User = require('../../models/User');

// helpers
function msToHuman(ms) {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts = [];
  if (hrs) parts.push(`${hrs}h`);
  if (mins) parts.push(`${mins}m`);
  if (secs || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(' ');
}
function levenshtein(a, b) {
  const aLen = a.length, bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;
  let v0 = Array(bLen + 1).fill(0).map((_, i) => i);
  let v1 = Array(bLen + 1).fill(0);
  for (let i = 0; i < aLen; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < bLen; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    [v0, v1] = [v1, v0];
  }
  return v0[bLen];
}
// now accepts optional minCount (default 1)
function findBestCardMatch(cards, query, rarity, minCount = 1) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const q = (query || '').toLowerCase().trim();
  let best = null;
  for (const c of cards) {
    if (String(c.rarity).toLowerCase() !== String(rarity).toLowerCase()) continue;
    const name = String(c.name || '').toLowerCase();
    if (!name) continue;
    if (!c.count || c.count < minCount) continue;
    let score = 0;
    if (name === q) score = 100;
    else if (q.length > 0 && name.startsWith(q)) score = 80;
    else if (q.length > 0 && name.includes(q)) score = 60;
    else {
      const dist = levenshtein(q, name);
      const norm = 1 - (dist / Math.max(name.length, q.length, 1));
      score = Math.max(0, Math.round(norm * 50));
    }
    if (!best || score > best.score) best = { card: c, score };
  }
  return best ? best.card : null;
}

// Pick a random owned card matching rarity and minCount
function pickRandomOwnedCard(cards, rarity, minCount = 1) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const pool = cards.filter(c => String(c.rarity).toLowerCase() === String(rarity).toLowerCase() && c.count >= minCount);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

const STAGE_ALLOWED_RARITIES = {
  1: ['C', 'OC', 'U'],
  2: ['S', 'R', 'RR'],
  3: ['SR', 'OSR'],
  4: ['UR', 'OUR', 'SY'],
  5: ['SEC'],
};

const EPHEMERAL_FLAG = 1 << 6;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('startlive')
    .setDescription('Start a live attempt: pick stage, then rarity (dropdown), then name.')
    .addIntegerOption(o =>
      o.setName('stage')
        .setDescription('Stage to send to')
        .setRequired(true)
        .addChoices(
          { name: `1 - ${getStageName(1)}`, value: 1 },
          { name: `2 - ${getStageName(2)}`, value: 2 },
          { name: `3 - ${getStageName(3)}`, value: 3 },
          { name: `4 - ${getStageName(4)}`, value: 4 },
          { name: `5 - ${getStageName(5)}`, value: 5 }
        ))
    .addBooleanOption(b =>
      b.setName('multi')
        .setDescription('Only match cards you own multiple copies of (count > 1)')
        .setRequired(false))
    .addBooleanOption(b =>
      b.setName('any')
        .setDescription('Pick a random matching card you own (no name input required)')
        .setRequired(false)),
  requireOshi: true,
  async execute(interaction) {
    const userId = interaction.user.id;
    const stage = interaction.options.getInteger('stage');
    const multiOnly = interaction.options.getBoolean('multi') || false;
    const anyRandom = interaction.options.getBoolean('any') || false;
    const hint = interaction.options.getString('hint') || '';
    const stageName = getStageName(stage);

    if (!STAGE_ALLOWED_RARITIES[stage]) {
      return interaction.reply({ content: 'Invalid stage selected.', flags: EPHEMERAL_FLAG });
    }

    // build rarity dropdown
    const rarities = STAGE_ALLOWED_RARITIES[stage];
    const select = new StringSelectMenuBuilder()
      .setCustomId(`live_rarity_select_${interaction.id}_${Date.now()}`)
      .setPlaceholder(`Choose rarity for ${stageName}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(rarities.map(r => ({ label: r, value: r, description: `Use ${r} on ${stageName}` })));

    const row = new ActionRowBuilder().addComponents(select);
    const promptEmbed = new EmbedBuilder()
      .setTitle('Choose Rarity')
      .setDescription(`Stage: **${stageName}**\nChoose a rarity from the dropdown to continue.`)
      .setColor(Colors.Blue);

    // show the select menu (do NOT defer/reply before showing selects)
    try {
      await interaction.reply({ embeds: [promptEmbed], components: [row], flags: EPHEMERAL_FLAG });
    } catch (err) {
      console.error('reply failed', err);
      return interaction.reply({ content: 'Could not show rarity selector. Try again.', flags: EPHEMERAL_FLAG });
    }

    // wait for select
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({ time: 30_000 });

    collector.on('collect', async sel => {
      if (sel.user.id !== interaction.user.id) {
        await sel.reply({ content: "This selection isn't for you.", flags: EPHEMERAL_FLAG });
        return;
      }
      collector.stop();

      const chosenRarity = sel.values[0];

      // If anyRandom is true, we skip modal and pick a random matching owned card
      if (anyRandom) {
        // immediate deferred reply to show confirmation
        try { await sel.deferReply({ flags: EPHEMERAL_FLAG }); } catch (e) { try { await sel.reply({ content: 'Processing...', flags: EPHEMERAL_FLAG }); } catch {} }

        // reload user just before picking
        const user = await User.findOne({ id: userId }).lean();
        if (!user || !Array.isArray(user.cards) || user.cards.length === 0) {
          try { await sel.editReply({ content: "You have no cards to send.", embeds: [], components: [] }); } catch {}
          return;
        }

        const candidate = pickRandomOwnedCard(user.cards, chosenRarity, multiOnly ? 2 : 1);
        if (!candidate) {
          const msg = multiOnly
            ? `No matching owned card with rarity ${chosenRarity} and count > 1 available to pick randomly.`
            : `No matching owned card with rarity ${chosenRarity} available to pick randomly.`;
          try { await sel.editReply({ content: msg, embeds: [], components: [] }); } catch {}
          return;
        }

        // confirmation embed + buttons for chosen random card
        const durationMs = getDurationForStage(stage);
        const confirmEmbed = new EmbedBuilder()
          .setTitle('Confirm Live Send (Random Pick)')
          .setDescription(`A random matching card was selected: **[${candidate.rarity}] ${candidate.name}**. Send it to **${stageName}**?`)
          .setColor(Colors.Blue)
          .addFields(
            { name: 'Card count', value: `${candidate.count}`, inline: true },
            { name: 'Ready', value: `<t:${Math.floor((Date.now() + durationMs) / 1000)}:f>`, inline: true },
            { name: 'Duration', value: msToHuman(durationMs), inline: true }
          );

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`live_confirm_${interaction.id}_${Date.now()}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`live_cancel_${interaction.id}_${Date.now()}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );

        try {
          await sel.editReply({ embeds: [confirmEmbed], components: [confirmRow], content: null });
        } catch {
          try { await sel.followUp({ embeds: [confirmEmbed], components: [confirmRow], flags: EPHEMERAL_FLAG }); } catch {}
        }

        let confirmMsg;
        try { confirmMsg = await sel.fetchReply(); } catch (err) { console.error('fetchReply failed', err); try { await sel.followUp({ content: 'Internal error preparing confirmation.', flags: EPHEMERAL_FLAG }); } catch {} return; }

        const btnCollector = confirmMsg.createMessageComponentCollector({ time: 30_000 });

        btnCollector.on('collect', async btn => {
          if (btn.user.id !== interaction.user.id) {
            await btn.reply({ content: "This confirmation isn't for you.", flags: EPHEMERAL_FLAG });
            return;
          }

          if (btn.customId.startsWith('live_cancel')) {
            try { await btn.update({ content: 'Cancelled.', embeds: [], components: [] }); } catch {
              try { await btn.followUp({ content: 'Cancelled.', flags: EPHEMERAL_FLAG }); } catch {}
            }
            btnCollector.stop('cancelled');
            return;
          }

          if (btn.customId.startsWith('live_confirm')) {
            let startRes;
            try {
              startRes = await startAttemptAtomic(userId, candidate.name, candidate.rarity);
              console.debug('[live.start] startAttemptAtomic result', { userId, stage, startRes });
            } catch (err) {
              console.error('startAttemptAtomic error', err);
              try { await btn.update({ content: 'Failed to start attempt. Try again later.', embeds: [], components: [] }); } catch {
                try { await btn.followUp({ content: 'Failed to start attempt. Try again later.', flags: EPHEMERAL_FLAG }); } catch {}
              }
              btnCollector.stop('error');
              return;
            }

            if (!startRes.success) {
              if (startRes.reason === 'stage-busy') {
                const next = startRes.nextReadyAt ? `<t:${Math.floor(new Date(startRes.nextReadyAt).getTime() / 1000)}:R>` : 'soon';
                const busyMsg = `${stageName} is occupied. Next slot frees: ${next}`;
                try { await btn.update({ content: busyMsg, embeds: [], components: [] }); } catch {
                  try { await btn.followUp({ content: busyMsg, flags: EPHEMERAL_FLAG }); } catch {}
                }
                btnCollector.stop('stage-busy');
                return;
              }
              if (startRes.reason === 'no-card') {
                const noCardMsg = `You don't have any **[${candidate.rarity}] ${candidate.name}** left to send.`;
                try { await btn.update({ content: noCardMsg, embeds: [], components: [] }); } catch {
                  try { await btn.followUp({ content: noCardMsg, flags: EPHEMERAL_FLAG }); } catch {}
                }
                btnCollector.stop('no-card');
                return;
              }
              try { await btn.update({ content: 'Failed to start attempt. Try again later.', embeds: [], components: [] }); } catch {
                try { await btn.followUp({ content: 'Failed to start attempt. Try again later.', flags: EPHEMERAL_FLAG }); } catch {}
              }
              btnCollector.stop('error');
              return;
            }

            // success
            const readyAt = startRes.readyAt instanceof Date ? startRes.readyAt : new Date(startRes.readyAt);
            const outEmbed = new EmbedBuilder()
              .setTitle('Live Attempt Started')
              .setDescription(`**[${candidate.rarity}] ${candidate.name}** has started a live at **${stageName}**.`)
              .addFields(
                { name: 'Ready', value: `<t:${Math.floor(readyAt.getTime() / 1000)}:f>`, inline: true },
                { name: 'Duration', value: msToHuman(getDurationForStage(stage)), inline: true }
              )
              .setColor(Colors.Green);

            try {
              await btn.update({ content: null, embeds: [outEmbed], components: [] });
            } catch {
              try { await btn.followUp({ embeds: [outEmbed], flags: EPHEMERAL_FLAG }); } catch {}
            }

            btnCollector.stop('started');
          }
        });

        btnCollector.on('end', async () => {});
        return;
      }

      // Normal flow: show modal to ask for name and proceed (same as before)
      const modalId = `live_name_modal_${interaction.id}_${Date.now()}`;
      const modal = new ModalBuilder().setCustomId(modalId).setTitle(`Send ${chosenRarity} to ${stageName}`);
      const nameInput = new TextInputBuilder()
        .setCustomId('name_field')
        .setLabel('Card name (partial OK)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(hint || 'Enter card name or partial')
        .setRequired(true)
        .setMaxLength(100);
      modal.addComponents(new ActionRowBuilder().addComponents(nameInput));

      try {
        await sel.showModal(modal);
      } catch (err) {
        console.error('showModal failed', err);
        try { await sel.reply({ content: 'Could not open name modal. Try again.', flags: EPHEMERAL_FLAG }); } catch {}
        return;
      }

      // await modal submit
      let submitted;
      try {
        submitted = await sel.awaitModalSubmit({
          time: 30_000,
          filter: (m) => m.customId === modalId && m.user.id === interaction.user.id
        });
      } catch (err) {
        try { await sel.followUp({ content: 'No response from modal (timed out).', flags: EPHEMERAL_FLAG }); } catch {}
        return;
      }

      // defer modal submit (we will show confirmation after matching)
      try {
        await submitted.deferReply({ flags: EPHEMERAL_FLAG });
      } catch (err) {
        console.error('deferReply failed', err);
        try { await submitted.reply({ content: 'Processing...', flags: EPHEMERAL_FLAG }); } catch {}
      }

      const rawName = submitted.fields.getTextInputValue('name_field').trim();

      // load user and find candidate
      const user = await User.findOne({ id: userId }).lean();
      if (!user || !Array.isArray(user.cards) || user.cards.length === 0) {
        return submitted.editReply({ content: "You have no cards to send.", embeds: [], components: [] });
      }
      const candidate = findBestCardMatch(user.cards, rawName, chosenRarity, multiOnly ? 2 : 1);
      if (!candidate) {
        if (multiOnly) {
          return submitted.editReply({ content: `No matching owned card with rarity ${chosenRarity} and count > 1 found for "${rawName}".`, embeds: [], components: [] });
        }
        return submitted.editReply({ content: `No matching owned card with rarity ${chosenRarity} found for "${rawName}".`, embeds: [], components: [] });
      }

      // confirmation embed + buttons
      const durationMs = getDurationForStage(stage);
      const confirmEmbed = new EmbedBuilder()
        .setTitle('Confirm Live Send')
        .setDescription(`You're about to send **[${candidate.rarity}] ${candidate.name}** to **${stageName}**.`)
        .setColor(Colors.Blue)
        .addFields(
          { name: 'Card count', value: `${candidate.count}`, inline: true },
          { name: 'Ready', value: `<t:${Math.floor((Date.now() + durationMs) / 1000)}:f>`, inline: true },
          { name: 'Duration', value: msToHuman(durationMs), inline: true }
        );

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`live_confirm_${interaction.id}_${Date.now()}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`live_cancel_${interaction.id}_${Date.now()}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      );

      try {
        await submitted.editReply({ embeds: [confirmEmbed], components: [confirmRow], content: null });
      } catch (err) {
        try { await submitted.followUp({ embeds: [confirmEmbed], components: [confirmRow], flags: EPHEMERAL_FLAG }); } catch {}
      }

      let confirmMsg;
      try {
        confirmMsg = await submitted.fetchReply();
      } catch (err) {
        console.error('fetchReply failed', err);
        try { await submitted.followUp({ content: 'Internal error preparing confirmation.', flags: EPHEMERAL_FLAG }); } catch {}
        return;
      }

      const btnCollector = confirmMsg.createMessageComponentCollector({ time: 30_000 });

      btnCollector.on('collect', async btn => {
        if (btn.user.id !== interaction.user.id) {
          await btn.reply({ content: "This confirmation isn't for you.", flags: EPHEMERAL_FLAG });
          return;
        }

        if (btn.customId.startsWith('live_cancel')) {
          try { await btn.update({ content: 'Cancelled.', embeds: [], components: [] }); } catch {
            try { await btn.followUp({ content: 'Cancelled.', flags: EPHEMERAL_FLAG }); } catch {}
          }
          btnCollector.stop('cancelled');
          return;
        }

        if (btn.customId.startsWith('live_confirm')) {
          let startRes;
          try {
            startRes = await startAttemptAtomic(userId, candidate.name, candidate.rarity);
            console.debug('[live.start] startAttemptAtomic result', { userId, stage, startRes });
          } catch (err) {
            console.error('startAttemptAtomic error', err);
            try { await btn.update({ content: 'Failed to start attempt. Try again later.', embeds: [], components: [] }); } catch {
              try { await btn.followUp({ content: 'Failed to start attempt. Try again later.', flags: EPHEMERAL_FLAG }); } catch {}
            }
            btnCollector.stop('error');
            return;
          }

          if (!startRes.success) {
            if (startRes.reason === 'stage-busy') {
              const next = startRes.nextReadyAt ? `<t:${Math.floor(new Date(startRes.nextReadyAt).getTime() / 1000)}:R>` : 'soon';
              const busyMsg = `${stageName} is occupied. Next slot frees: ${next}`;
              try { await btn.update({ content: busyMsg, embeds: [], components: [] }); } catch {
                try { await btn.followUp({ content: busyMsg, flags: EPHEMERAL_FLAG }); } catch {}
              }
              btnCollector.stop('stage-busy');
              return;
            }
            if (startRes.reason === 'no-card') {
              const noCardMsg = `You don't have any **[${candidate.rarity}] ${candidate.name}** left to send.`;
              try { await btn.update({ content: noCardMsg, embeds: [], components: [] }); } catch {
                try { await btn.followUp({ content: noCardMsg, flags: EPHEMERAL_FLAG }); } catch {}
              }
              btnCollector.stop('no-card');
              return;
            }
            try { await btn.update({ content: 'Failed to start attempt. Try again later.', embeds: [], components: [] }); } catch {
              try { await btn.followUp({ content: 'Failed to start attempt. Try again later.', flags: EPHEMERAL_FLAG }); } catch {}
            }
            btnCollector.stop('error');
            return;
          }

          // success
          const readyAt = startRes.readyAt instanceof Date ? startRes.readyAt : new Date(startRes.readyAt);
          const outEmbed = new EmbedBuilder()
            .setTitle('Live Attempt Started')
            .setDescription(`**[${candidate.rarity}] ${candidate.name}** has started a live at **${stageName}**.`)
            .addFields(
              { name: 'Ready', value: `<t:${Math.floor(readyAt.getTime() / 1000)}:f>`, inline: true },
              { name: 'Duration', value: msToHuman(getDurationForStage(stage)), inline: true }
            )
            .setColor(Colors.Green);

          try {
            await btn.update({ content: null, embeds: [outEmbed], components: [] });
          } catch {
            try { await btn.followUp({ embeds: [outEmbed], flags: EPHEMERAL_FLAG }); } catch {}
          }

          btnCollector.stop('started');
        }
      });

      btnCollector.on('end', async (_, reason) => {
        // nothing to do; ephemeral messages expire automatically
      });
    });

    collector.on('end', async (_, reason) => {
      try {
        const fetched = await interaction.fetchReply();
        if (fetched && Array.isArray(fetched.components) && fetched.components.length > 0) {
          await interaction.editReply({ content: 'closed', embeds: [], components: [], flags: EPHEMERAL_FLAG });
        }
      } catch {}
    });
  }
};
