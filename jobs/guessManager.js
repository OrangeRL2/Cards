const {
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const crypto = require('node:crypto');

const config = require('../config.json');
const User = require('../models/User');
const GuessChallenge = require('../models/GuessChallenge');
const holo = require('../utils/guessHolodoriClient');
const { cropSquare, unsquishCard, clipMp3, hasFfmpeg } = require('../utils/guessAssets');
const { bestMatch, maskedName } = require('../utils/guessMatcher');
const { pickHolodoriLoginReward, buildHolodoriImageUrl } = require('../utils/holodoriLoginReward');

const GUESS_PREFIX = '-';
const MODE_TIME_SECONDS = Object.freeze({ jacket: 60, song: 300, holomem: 30 });
const STAGE_SECONDS = Object.freeze({ 1: 1, 2: 3, 3: 5, 4: 8 });
const MAX_MUSIC_STAGE = 4;
const MAX_TEXT_HINTS = 3;
const HINT_COOLDOWN_MS = 2000;
const IMAGE_BASE = process.env.IMAGE_BASE || config.imageBase || 'http://152.69.195.48/images';
const MODE_LABEL = Object.freeze({ jacket: 'Guess the Jacket', song: 'Guess the Song', holomem: 'Guess the Holomem' });

const activeRounds = new Map();
let managerClient = null;
let timeoutInterval = null;
let autoTimer = null;
let nextAutoAt = null;
let started = false;

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function releasedSongs(data) {
  const now = Date.now();
  return (data.songs || []).filter(s =>
    s && s.id !== 'm9999' && (!s.startTime || Number(s.startTime) <= now)
  );
}

function expertLevel(song) {
  const d = (song?.difficulties || []).find(x => String(x.type || '').toLowerCase() === 'expert');
  return d?.level ?? null;
}

function modeTitle(mode) {
  return MODE_LABEL[mode] || 'Guess Challenge';
}

function controlLine() {
  return 'Use `-your guess` to guess, `-hint` for a hint, `-end` to give up, or `-time` for time left.';
}

function manualTip(mode) {
  return mode === 'song'
    ? '\n-# Use `-hint` to provide more of the song, or `-time` for time left!'
    : '\n-# Use `-hint` for a hint, `-end` to give up, or `-time` for time left!';
}

function modePrompt(mode) {
  if (mode === 'jacket') return 'Which song is this cropped jacket from?';
  if (mode === 'song') return 'Guess the song from this short audio clip.';
  return 'Guess the holomem from this cropped card art.';
}

async function buildRound(mode, kind, starterId = null) {
  if (!['jacket', 'song', 'holomem'].includes(mode)) throw new Error(`Unknown guess mode: ${mode}`);
  const data = await holo.getData();
  const base = {
    roundId: crypto.randomUUID(),
    kind,
    mode,
    answerId: null,
    answerName: null,
    revealUrl: null,
    starterId,
    startedAt: Date.now(),
    createdAt: Date.now(),
    guessers: new Set(),
    hintStage: 0,
    lastHintAt: 0,
    resolving: false,
    channelId: null,
    guildId: null,
    messageId: null,
    media: null,
    mediaName: null,
    meta: {},
  };

  if (mode === 'jacket' || mode === 'song') {
    const songs = shuffle(releasedSongs(data).filter(s => s?.title));
    for (const song of songs.slice(0, 12)) {
      try {
        if (mode === 'jacket') {
          if (!song.jacket) continue;
          const raw = await holo.fetchAsset(song.jacket);
          const crop = await cropSquare(raw, { size: 250 });
          return {
            ...base,
            answerId: String(song.id),
            answerName: String(song.title),
            revealUrl: holo.imageUrl(song.jacket),
            media: crop,
            mediaName: 'jacket.png',
            meta: { expertLevel: expertLevel(song) },
          };
        }

        if (!hasFfmpeg()) throw new Error('ffmpeg is required for Guess the Song.');
        const length = Number(song.length || 40);
        if (length < 26) continue;
        const audioFull = await holo.fetchSongAudio(song.id);
        const maxStart = Math.max(5, length - 20);
        const window = 5 + Math.random() * Math.max(0, maxStart - 5);
        const audioClip = await clipMp3(audioFull, window, STAGE_SECONDS[1]);
        return {
          ...base,
          answerId: String(song.id),
          answerName: String(song.title),
          revealUrl: holo.imageUrl(song.jacket),
          media: audioClip,
          mediaName: 'clip.mp3',
          meta: { audioFull, window, musicStage: 1, expertLevel: expertLevel(song) },
        };
      } catch (err) {
        console.warn(`[guess] skipped ${mode} candidate ${song?.id}:`, err.message);
      }
    }
    throw new Error(`Could not build a ${mode} round from the available song assets.`);
  }

  const cards = shuffle((data.cards || []).filter(c => c?.image && Number(c?.rarity || 0) >= 3));
  for (const card of cards.slice(0, 16)) {
    try {
      const raw = await holo.fetchAsset(card.image);
      const unsquished = await unsquishCard(raw, 16 / 9);
      const crop = await cropSquare(unsquished, { size: 250 });
      const member = (data.holomems || []).find(h => String(h.id) === String(card.characterId));
      const group = holo.findGroupForCharacter(card.characterId, data);
      return {
        ...base,
        answerId: String(card.characterId || card.character),
        answerName: String(card.character || member?.name || card.characterId),
        revealUrl: holo.imageUrl(card.thumb || card.image),
        media: crop,
        mediaName: 'holomem.png',
        meta: {
          cardName: card.name || null,
          rarity: Number(card.rarity || 0),
          attribute: card.attributeName || null,
          group: card.group?.name || group?.name || null,
        },
      };
    } catch (err) {
      console.warn(`[guess] skipped holomem candidate ${card?.id}:`, err.message);
    }
  }
  throw new Error('Could not build a holomem round from the available card assets.');
}

function challengePayload(round) {
  const manual = round.kind === 'manual';
  const timeout = MODE_TIME_SECONDS[round.mode];
  const description = manual
    ? `${modePrompt(round.mode)} You have \`${timeout}\` seconds.\n\n${controlLine()}\n-# You can give up after the normal give-up gate.`
    : `${modePrompt(round.mode)}\n\nUse \`-your guess\` to answer. **First correct answer wins a random HOLODORI card.**\n-# This reward challenge has no time limit.`;

  const embed = new EmbedBuilder()
    .setTitle(manual ? modeTitle(round.mode) : `🎲 ${modeTitle(round.mode)} — Reward Challenge`)
    .setDescription(description)
    .setColor(manual ? 0x5ab3f4 : 0xf4c542)
    .setTimestamp();

  const files = [];
  if (round.media) {
    files.push(new AttachmentBuilder(round.media, { name: round.mediaName }));
    if (round.mode !== 'song') embed.setImage(`attachment://${round.mediaName}`);
  }
  return { embeds: [embed], files, allowedMentions: { parse: [] } };
}

async function sendManual(interaction, mode) {
  const channelId = interaction.channelId;
  if (!channelId || !interaction.channel?.isTextBased?.()) {
    await interaction.reply({ content: 'Guessing can only be started in a text channel.', ephemeral: true });
    return { success: false, reason: 'BAD_CHANNEL' };
  }
  if (activeRounds.has(channelId)) {
    await interaction.reply({ content: 'A guessing game is already happening here!', ephemeral: true });
    return { success: false, reason: 'ACTIVE_CHANNEL' };
  }

  await interaction.deferReply();
  try {
    const round = await buildRound(mode, 'manual', interaction.user.id);
    round.channelId = channelId;
    round.guildId = interaction.guildId;
    const msg = await interaction.editReply(challengePayload(round));
    round.messageId = msg?.id || null;
    activeRounds.set(channelId, round);
    return { success: true, round };
  } catch (err) {
    console.error('[guess] manual start failed:', err);
    await interaction.editReply({ content: `Couldn't start that round: ${err.message}`, embeds: [], files: [] });
    return { success: false, reason: 'BUILD_FAILED', error: err };
  }
}

function autoChannelIds() {
  return Array.isArray(config.guessChannelIds)
    ? config.guessChannelIds.map(String).filter(Boolean)
    : [];
}

async function resolveTextChannel(client, channelId) {
  const channel = await client.channels.fetch(String(channelId)).catch(() => null);
  return channel && channel.isTextBased?.() ? channel : null;
}

function hasActiveAutomatic() {
  for (const r of activeRounds.values()) if (r.kind === 'auto') return true;
  return false;
}

async function chooseAutomaticChannel(client, requestedChannelId = null) {
  if (requestedChannelId) {
    const channel = await resolveTextChannel(client, requestedChannelId);
    if (!channel) return null;
    if (activeRounds.has(String(channel.id))) return null;
    return channel;
  }

  const ids = shuffle(autoChannelIds());
  for (const id of ids) {
    if (activeRounds.has(id)) continue;
    const channel = await resolveTextChannel(client, id);
    if (channel) return channel;
  }
  return null;
}

async function announceAutomatic(client, channel, challengeMessage, mode) {
  const id = String(config.birthdayChannelId || '').trim();
  if (!id) return;
  const announcement = await resolveTextChannel(client, id);
  if (!announcement) return;
  const guildId = challengeMessage.guildId || channel.guildId;
  const url = `https://discord.com/channels/${guildId}/${channel.id}/${challengeMessage.id}`;
  await announcement.send({
    content: `🎲 **A Guess Challenge has started!**\n**${modeTitle(mode)}** is waiting in <#${channel.id}>. First correct answer wins a random HOLODORI card.\n[Jump to challenge](${url})`,
    allowedMentions: { parse: [] },
  }).catch(err => console.warn('[guess] announcement failed:', err.message));
}

async function spawnAutomatic(client, { mode = null, channelId = null, forced = false, announce = true } = {}) {
  if (hasActiveAutomatic()) {
    return { success: false, reason: 'ACTIVE_AUTO' };
  }
  const selectedMode = mode && ['jacket', 'song', 'holomem'].includes(mode)
    ? mode
    : randomChoice(['jacket', 'song', 'holomem']);
  const channel = await chooseAutomaticChannel(client, channelId);
  if (!channel) return { success: false, reason: 'NO_FREE_CHANNEL' };

  try {
    const round = await buildRound(selectedMode, 'auto');
    round.channelId = String(channel.id);
    round.guildId = String(channel.guildId);
    const msg = await channel.send(challengePayload(round));
    round.messageId = String(msg.id);

    await GuessChallenge.create({
      challengeId: round.roundId,
      channelId: round.channelId,
      guildId: round.guildId,
      messageId: round.messageId,
      mode: round.mode,
      answerId: round.answerId,
      answerName: round.answerName,
      revealUrl: round.revealUrl,
      active: true,
      spawnedAt: new Date(round.startedAt),
    });

    activeRounds.set(round.channelId, round);
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = null;
    nextAutoAt = null;
    if (announce) await announceAutomatic(client, channel, msg, selectedMode);
    console.log(`[guess] ${forced ? 'forced' : 'automatic'} ${selectedMode} challenge started in ${channel.id}`);
    return { success: true, round, channel, message: msg };
  } catch (err) {
    console.error('[guess] automatic spawn failed:', err);
    return { success: false, reason: 'BUILD_FAILED', error: err };
  }
}

function randomDelayMs() {
  const minMinutes = Math.max(1, Number(config.guessAutoMinMinutes || 10));
  const maxMinutes = Math.max(minMinutes, Number(config.guessAutoMaxMinutes || 600));
  const min = minMinutes * 60 * 1000;
  const max = maxMinutes * 60 * 1000;
  // Log-uniform: short waits are common, but very long waits remain genuinely possible.
  return Math.round(Math.exp(Math.log(min) + Math.random() * (Math.log(max) - Math.log(min))));
}

function scheduleNextAutomatic(client, { retryMs = null } = {}) {
  if (!client || hasActiveAutomatic()) return null;
  if (!autoChannelIds().length) {
    console.warn('[guess] no guessChannelIds configured; automatic challenges are disabled.');
    return null;
  }
  if (autoTimer) clearTimeout(autoTimer);
  const delay = retryMs || randomDelayMs();
  nextAutoAt = new Date(Date.now() + delay);
  autoTimer = setTimeout(async () => {
    autoTimer = null;
    nextAutoAt = null;
    const result = await spawnAutomatic(client);
    if (!result.success) {
      console.warn(`[guess] automatic spawn skipped (${result.reason}); retrying later.`);
      scheduleNextAutomatic(client, { retryMs: 10 * 60 * 1000 });
    }
  }, delay);
  autoTimer.unref?.();
  console.log(`[guess] next automatic challenge scheduled for ${nextAutoAt.toISOString()}`);
  return nextAutoAt;
}

async function addHolodoriReward(userId, reward) {
  const now = new Date();
  let user = await User.findOneAndUpdate(
    { id: String(userId) },
    { $setOnInsert: { id: String(userId) } },
    { upsert: true, new: true }
  ).exec();
  const cards = Array.isArray(user.cards) ? user.cards : [];
  const index = cards.findIndex(c =>
    String(c.name) === String(reward.name) &&
    String(c.rarity) === String(reward.rarity) &&
    !c.variant
  );
  if (index >= 0) {
    const set = {};
    set[`cards.${index}.count`] = Number(cards[index].count || 0) + 1;
    set[`cards.${index}.lastAcquiredAt`] = now;
    await User.updateOne({ id: String(userId) }, { $set: set }).exec();
  } else {
    await User.updateOne(
      { id: String(userId) },
      { $push: { cards: {
        name: String(reward.name),
        rarity: String(reward.rarity),
        variant: null,
        count: 1,
        firstAcquiredAt: now,
        lastAcquiredAt: now,
      } } }
    ).exec();
  }
}

function revealEmbed(round, { title, description, color = 0x57f287, reward = null } = {}) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
  if (round.revealUrl) {
    if (reward) embed.setThumbnail(round.revealUrl);
    else embed.setImage(round.revealUrl);
  }
  if (reward) {
    const rewardImage = buildHolodoriImageUrl(reward, IMAGE_BASE);
    if (rewardImage) embed.setImage(rewardImage);
  }
  return embed;
}

function manualResultComponents(round) {
  if (!round || round.kind !== 'manual') return [];
  const stamp = Date.now();
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`guess_play_again:${round.mode}:${stamp}`)
      .setLabel('Play Again')
      .setStyle(ButtonStyle.Primary)
  )];
}

async function startManualFromButton(interaction, mode) {
  const channelId = String(interaction.channelId || '');
  if (!channelId || !interaction.channel?.isTextBased?.()) {
    await interaction.reply({ content: 'Guessing can only be started in a text channel.', ephemeral: true }).catch(() => {});
    return;
  }
  if (activeRounds.has(channelId)) {
    await interaction.reply({ content: 'A guessing game is already happening here!', ephemeral: true }).catch(() => {});
    return;
  }

  // Match the original bot: the result button is single-use and starts the same mode.
  await interaction.update({ components: [] }).catch(() => {});
  try {
    const round = await buildRound(mode, 'manual', interaction.user.id);
    round.channelId = channelId;
    round.guildId = interaction.guildId;
    const msg = await interaction.channel.send(challengePayload(round));
    round.messageId = msg?.id || null;
    activeRounds.set(channelId, round);
  } catch (err) {
    console.error('[guess] play-again start failed:', err);
    await interaction.followUp({ content: `Couldn't start that round: ${err.message}`, ephemeral: true }).catch(() => {});
  }
}

async function handleGuessInteraction(interaction) {
  if (!interaction?.isButton?.()) return false;
  const customId = String(interaction.customId || '');
  if (!customId.startsWith('guess_play_again:')) return false;

  const [, mode, stampRaw] = customId.split(':');
  if (!['jacket', 'song', 'holomem'].includes(mode)) {
    await interaction.reply({ content: 'That Guess button is no longer valid.', ephemeral: true }).catch(() => {});
    return true;
  }

  const stamp = Number(stampRaw || 0);
  if (!stamp || Date.now() - stamp > 30_000) {
    await interaction.update({ components: [] }).catch(() => {});
    await interaction.followUp({ content: 'That Play Again button has expired.', ephemeral: true }).catch(() => {});
    return true;
  }

  await startManualFromButton(interaction, mode);
  return true;
}

async function correctAnswer(message, round) {
  if (round.resolving) return;
  round.resolving = true;

  if (round.kind === 'auto') {
    const claimed = await GuessChallenge.findOneAndUpdate(
      { challengeId: round.roundId, active: true },
      { $set: { active: false, winnerId: String(message.author.id), resolvedAt: new Date() } },
      { new: true }
    ).exec();
    if (!claimed) return;
    activeRounds.delete(round.channelId);

    let reward = null;
    let rewardError = null;
    try {
      reward = pickHolodoriLoginReward();
      await addHolodoriReward(message.author.id, reward);
      await GuessChallenge.updateOne(
        { challengeId: round.roundId },
        { $set: { reward: { rarity: reward.rarity, name: reward.name, signed: Boolean(reward.signed) } } }
      ).exec();
    } catch (err) {
      rewardError = err;
      console.error('[guess] reward grant failed:', err);
    }

    const rewardLine = reward
      ? `\n\n🎴 Reward: **${reward.signed ? '✍️ SIGNED ' : ''}${reward.rarity} ${reward.name}**`
      : `\n\n⚠️ The answer was accepted, but the reward could not be granted automatically.${rewardError ? ' An admin should check the logs.' : ''}`;
    const embed = revealEmbed(round, {
      title: '✅ Correct!',
      description: `${message.author} guessed **${round.answerName}** first!${rewardLine}`,
      reward,
    });
    await message.reply({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
    scheduleNextAutomatic(message.client);
    return;
  }

  activeRounds.delete(round.channelId);
  const seconds = ((Date.now() - round.startedAt) / 1000).toFixed(2);
  const extra = round.mode === 'holomem' && round.meta.cardName ? `\n**Card:** ${round.meta.cardName}` : '';
  const embed = revealEmbed(round, {
    title: '✅ Correct!',
    description: `${message.author} successfully guessed **${round.answerName}** in \`${seconds}\` seconds!${extra}`,
  });
  await message.reply({
    embeds: [embed],
    components: manualResultComponents(round),
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

async function wrongGuess(message, round, label) {
  const tip = round.kind === 'manual' ? manualTip(round.mode) : '';
  await message.reply({
    embeds: [new EmbedBuilder()
      .setTitle('❌ Incorrect')
      .setDescription(`Incorrectly guessed **${label}**.${tip}`)
      .setColor(0xed4245)],
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

async function processGuess(message, round, content) {
  const data = await holo.getData();
  if (round.mode === 'holomem') {
    const hit = bestMatch(content, data.holomems || [], h => [h.name, h.shortName, h.id], 80);
    if (!hit) {
      await message.reply({ content: `Couldn't find a holomem matching \`${String(content).slice(0, 100)}\`.${round.kind === 'manual' ? manualTip(round.mode) : ''}`, allowedMentions: { parse: [] } }).catch(() => {});
      return;
    }
    if (String(hit.item.id) === String(round.answerId)) return correctAnswer(message, round);
    return wrongGuess(message, round, hit.item.name || hit.item.shortName || hit.item.id);
  }

  const hit = bestMatch(content, data.songs || [], s => [s.title, s.id], 80);
  if (!hit) {
    await message.reply({ content: `Couldn't find a song matching \`${String(content).slice(0, 100)}\`.${round.kind === 'manual' ? manualTip(round.mode) : ''}`, allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }
  if (String(hit.item.id) === String(round.answerId)) return correctAnswer(message, round);
  return wrongGuess(message, round, hit.item.title || hit.item.id);
}

function giveupGateSeconds(round) {
  const total = MODE_TIME_SECONDS[round.mode] || 60;
  return total * (round.mode === 'song' ? 1 / 15 : 1 / 4);
}

async function endManualRound(round, channel, enderId, reason = 'ended') {
  activeRounds.delete(round.channelId);
  const title = reason === 'timeout' ? '⏰ Failed' : '🛑 Guess Ended';
  const description = reason === 'timeout'
    ? `Time ran out. The correct answer was **${round.answerName}**.`
    : `The answer was **${round.answerName}**.`;
  const embed = revealEmbed(round, { title, description, color: 0xed4245 });
  await channel.send({
    embeds: [embed],
    components: manualResultComponents(round),
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

async function hintForRound(round) {
  if (round.kind !== 'manual') return { content: 'Hints are disabled for rewarded random challenges.' };
  const now = Date.now();
  if (now - round.lastHintAt < HINT_COOLDOWN_MS) return { content: 'Please wait a moment before the next hint.' };
  round.lastHintAt = now;

  if (round.mode === 'song') {
    const stage = Number(round.meta.musicStage || 1);
    if (stage >= MAX_MUSIC_STAGE) {
      return {
        embeds: [new EmbedBuilder().setTitle(`Guess Hint — Stage ${MAX_MUSIC_STAGE}/${MAX_MUSIC_STAGE}`).setDescription('The full hint clip has already been revealed.').setColor(0xfee75c)],
      };
    }
    const next = stage + 1;
    const clip = await clipMp3(round.meta.audioFull, round.meta.window, STAGE_SECONDS[next]);
    round.meta.musicStage = next;
    round.media = clip;
    return {
      embeds: [new EmbedBuilder().setTitle(`Guess Hint — Stage ${next}/${MAX_MUSIC_STAGE}`).setDescription(`Here's **${STAGE_SECONDS[next]}s** of the same song section.`).setColor(0xfee75c)],
      files: [new AttachmentBuilder(clip, { name: 'clip.mp3' })],
    };
  }

  const stage = Math.min(MAX_TEXT_HINTS, Number(round.hintStage || 0) + 1);
  const advanced = stage > Number(round.hintStage || 0);
  round.hintStage = stage;
  const lines = [];
  if (round.mode === 'jacket') {
    if (stage >= 1) {
      if (round.meta.expertLevel != null) {
        lines.push(`The song is level **\`${round.meta.expertLevel}\`** on **Expert**.`);
      } else {
        const data = await holo.getData();
        const song = (data.songs || []).find(s => String(s.id) === String(round.answerId));
        const seconds = Number(song?.length || song?.playingSeconds || 0);
        lines.push(seconds > 0
          ? `The in-game song is **\`${Math.round(seconds)}\` seconds** long.`
          : 'No chart-level metadata is available for this song.');
      }
    }
    if (stage >= 2) lines.push(`The name has **\`${Array.from(round.answerName).length}\`** characters.`);
    if (stage >= 3) {
      if (!round.meta.masked) round.meta.masked = maskedName(round.answerName);
      lines.push(`Name: \`${round.meta.masked}\``);
    }
  } else {
    if (stage >= 1) lines.push(`The rarity of this card is **${'★'.repeat(Math.max(1, Math.min(5, Number(round.meta.rarity || 0))))}**.`);
    if (stage >= 2) lines.push(`The attribute of this card is **${round.meta.attribute || 'unknown'}**.`);
    if (stage >= 3) lines.push(`This card belongs to **${round.meta.group || 'unknown'}**.`);
  }
  if (!advanced || stage >= MAX_TEXT_HINTS) lines.push('-# All text hints have been revealed.');
  return {
    embeds: [new EmbedBuilder().setTitle(`Guess Hint — Stage ${stage}/${MAX_TEXT_HINTS}`).setDescription(lines.join('\n')).setColor(0xfee75c)],
  };
}

async function handleControlMessage(message, round, command) {
  if (command === 'time') {
    if (round.kind === 'auto') return message.reply({ content: 'This reward challenge has no time limit.', allowedMentions: { parse: [] } });
    const end = Math.floor((round.startedAt + MODE_TIME_SECONDS[round.mode] * 1000) / 1000);
    return message.reply({ content: `This guess ends <t:${end}:R>.`, allowedMentions: { parse: [] } });
  }

  if (command === 'hint') {
    try {
      return message.reply({ ...(await hintForRound(round)), allowedMentions: { parse: [] } });
    } catch (err) {
      return message.reply({ content: `Couldn't generate the hint: ${err.message}`, allowedMentions: { parse: [] } });
    }
  }

  if (command === 'end') {
    if (round.kind === 'auto') return message.reply({ content: 'Reward challenges cannot be ended by players.', allowedMentions: { parse: [] } });
    if (String(message.author.id) !== String(round.starterId)) {
      if (!round.guessers.has(String(message.author.id))) {
        return message.reply({ content: 'You must make at least one guess before giving up.', allowedMentions: { parse: [] } });
      }
      const remaining = giveupGateSeconds(round) - (Date.now() - round.startedAt) / 1000;
      if (remaining > 0) {
        return message.reply({ content: `Cannot end the guess for another \`${Math.round(remaining)}\` seconds.`, allowedMentions: { parse: [] } });
      }
    }
    return endManualRound(round, message.channel, message.author.id, 'ended');
  }
  return null;
}

async function handleMessage(message) {
  if (!message || message.author?.bot || !message.content?.startsWith(GUESS_PREFIX)) return false;
  if (message.content.startsWith('-#')) return false;
  const round = activeRounds.get(String(message.channel.id));
  if (!round) return false;
  const content = message.content.slice(GUESS_PREFIX.length).trim();
  if (!content) return true;
  const command = content.toLowerCase().replace(/\s+/g, '');
  if (['hint', 'end', 'time'].includes(command)) {
    await handleControlMessage(message, round, command);
    return true;
  }
  round.guessers.add(String(message.author.id));
  try {
    await processGuess(message, round, content);
  } catch (err) {
    console.error('[guess] guess processing failed:', err);
    await message.reply({ content: 'Guess processing failed. Please try again in a moment.', allowedMentions: { parse: [] } }).catch(() => {});
  }
  return true;
}

async function slashHint(interaction) {
  const round = activeRounds.get(String(interaction.channelId));
  if (!round) return interaction.reply({ content: "There's no active round here.", ephemeral: true });
  try {
    await interaction.reply({ ...(await hintForRound(round)), allowedMentions: { parse: [] } });
  } catch (err) {
    await interaction.reply({ content: `Couldn't generate the hint: ${err.message}`, ephemeral: true });
  }
}

async function slashTime(interaction) {
  const round = activeRounds.get(String(interaction.channelId));
  if (!round) return interaction.reply({ content: "There's no active round here.", ephemeral: true });
  if (round.kind === 'auto') return interaction.reply({ content: 'This reward challenge has no time limit.' });
  const end = Math.floor((round.startedAt + MODE_TIME_SECONDS[round.mode] * 1000) / 1000);
  return interaction.reply({ content: `This guess ends <t:${end}:R>.` });
}

async function slashEnd(interaction) {
  const round = activeRounds.get(String(interaction.channelId));
  if (!round) return interaction.reply({ content: "There's no active round here.", ephemeral: true });
  if (round.kind === 'auto') return interaction.reply({ content: 'Reward challenges cannot be ended by players.', ephemeral: true });
  const userId = String(interaction.user.id);
  if (userId !== String(round.starterId)) {
    if (!round.guessers.has(userId)) return interaction.reply({ content: 'You must make at least one guess before giving up.', ephemeral: true });
    const remaining = giveupGateSeconds(round) - (Date.now() - round.startedAt) / 1000;
    if (remaining > 0) return interaction.reply({ content: `Cannot end the guess for another \`${Math.round(remaining)}\` seconds.`, ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  await endManualRound(round, interaction.channel, userId, 'ended');
  await interaction.editReply('Ended.');
}

async function restoreAutomaticRounds(client) {
  const docs = await GuessChallenge.find({ active: true }).sort({ spawnedAt: 1 }).lean().exec();
  if (!docs.length) return 0;
  let restored = 0;
  for (const doc of docs) {
    const channel = await resolveTextChannel(client, doc.channelId);
    if (!channel) {
      await GuessChallenge.updateOne({ challengeId: doc.challengeId }, { $set: { active: false, resolvedAt: new Date() } }).exec();
      continue;
    }
    if (activeRounds.has(String(doc.channelId))) continue;
    activeRounds.set(String(doc.channelId), {
      roundId: doc.challengeId,
      kind: 'auto',
      mode: doc.mode,
      answerId: doc.answerId,
      answerName: doc.answerName,
      revealUrl: doc.revealUrl || null,
      starterId: null,
      startedAt: new Date(doc.spawnedAt || doc.createdAt || Date.now()).getTime(),
      createdAt: Date.now(),
      guessers: new Set(),
      hintStage: 0,
      lastHintAt: 0,
      resolving: false,
      channelId: String(doc.channelId),
      guildId: String(doc.guildId),
      messageId: String(doc.messageId || ''),
      media: null,
      mediaName: null,
      meta: {},
    });
    restored += 1;
  }
  return restored;
}

async function sweepTimeouts() {
  const now = Date.now();
  for (const round of [...activeRounds.values()]) {
    if (round.kind !== 'manual') continue;
    const expires = round.startedAt + (MODE_TIME_SECONDS[round.mode] || 60) * 1000;
    if (now < expires) continue;
    const channel = await resolveTextChannel(managerClient, round.channelId);
    if (channel) await endManualRound(round, channel, null, 'timeout');
    else activeRounds.delete(round.channelId);
  }
}

async function startGuessManager(client) {
  managerClient = client;
  if (started) return;
  started = true;
  client.on('interactionCreate', interaction => {
    handleGuessInteraction(interaction).catch(err => console.error('[guess] button interaction failed:', err));
  });
  try {
    const restored = await restoreAutomaticRounds(client);
    console.log(`[guess] manager started; restored ${restored} automatic challenge(s).`);
  } catch (err) {
    console.error('[guess] failed to restore automatic challenges:', err);
  }
  timeoutInterval = setInterval(() => sweepTimeouts().catch(err => console.error('[guess] timeout sweep error:', err)), 2000);
  timeoutInterval.unref?.();
  if (!hasActiveAutomatic()) scheduleNextAutomatic(client);
}

function stopGuessManager() {
  if (timeoutInterval) clearInterval(timeoutInterval);
  if (autoTimer) clearTimeout(autoTimer);
  timeoutInterval = null;
  autoTimer = null;
  nextAutoAt = null;
  started = false;
}

function getStatus() {
  return {
    activeRounds: [...activeRounds.values()].map(r => ({ channelId: r.channelId, kind: r.kind, mode: r.mode, answerName: r.answerName })),
    nextAutoAt,
  };
}

module.exports = {
  MODE_TIME_SECONDS,
  activeRounds,
  startGuessManager,
  stopGuessManager,
  sendManual,
  spawnAutomatic,
  scheduleNextAutomatic,
  handleMessage,
  slashHint,
  slashTime,
  slashEnd,
  handleGuessInteraction,
  getStatus,
};
