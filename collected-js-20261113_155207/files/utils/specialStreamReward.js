// Parse/validate a first-place stream reward without changing ordinary streams.
const fs = require('node:fs');
const path = require('node:path');
const { BIRTHDAY_FOLDER } = require('./birthdayPool');

const ASSET_ROOT = path.join(__dirname, '..', 'assets', 'images');
const IMAGE_BASE = process.env.STREAM_IMAGE_BASE || process.env.BOSS_IMAGE_BASE || 'http://152.69.195.48/images';
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

function parseSpecialStreamArgs(content) {
  const body = String(content || '').replace(/^\s*!\w+\s*/, '').trim();
  const flags = {};
  const flagPattern = /--([a-z][a-z0-9-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))/gi;
  const leftover = body.replace(flagPattern, (match, key, doubleQuoted, singleQuoted, plain) => {
    const name = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(flags, name)) throw new Error(`Duplicate flag: --${name}`);
    flags[name] = String(doubleQuoted ?? singleQuoted ?? plain ?? '').trim();
    return ' ';
  }).trim();
  if (/--\S+/.test(leftover)) throw new Error('Invalid flag syntax. Use --rarity="SEC" --card="Suisei 001".');
  if (!flags.rarity || !flags.card) {
    throw new Error('Both --rarity="..." and --card="..." are required.');
  }
  for (const name of Object.keys(flags)) {
    if (!['rarity', 'card', 'target', 'seconds'].includes(name)) throw new Error(`Unknown flag: --${name}`);
  }
  if (flags.target && leftover) throw new Error('Specify the stream target either before the flags or with --target, not both.');
  const rarity = flags.rarity.toUpperCase();
  if (!/^[A-Z0-9★]{1,20}$/u.test(rarity)) throw new Error('Invalid rarity name.');
  const card = flags.card.replace(/\.(png|jpe?g|webp)$/i, '').trim();
  if (!card || card.length > 120 || /[\\/\x00-\x1f]/.test(card) || card === '.' || card === '..') {
    throw new Error('Invalid card name; use a card filename without its extension.');
  }
  const explicitTarget = flags.target || leftover;
  const guessedTarget = card.replace(/\s+\d{1,3}$/u, '').trim();
  const targetInput = explicitTarget || guessedTarget;
  if (!targetInput) throw new Error('Could not infer the stream target. Supply --target="Suisei".');
  let seconds = null;
  if (flags.seconds !== undefined) {
    if (!/^\d+$/.test(flags.seconds) || Number(flags.seconds) <= 0 || Number(flags.seconds) > 604800) {
      throw new Error('--seconds must be a positive number up to 604800 (7 days).');
    }
    seconds = Number(flags.seconds);
  }
  return { rarity, card, targetInput, seconds };
}

function assetFolder(rarity) {
  if (rarity === 'BDAY') return BIRTHDAY_FOLDER;
  if (rarity === 'OSR') return process.env.OSR_ASSETS_BASE || path.join(__dirname, '..', 'assets', 'montlybdays', 'OSR');
  return path.join(ASSET_ROOT, rarity);
}

function resolveSpecialRewardImage(rarity, card) {
  const folder = assetFolder(rarity);
  let files;
  try {
    files = fs.readdirSync(folder);
  } catch (err) {
    throw new Error(`Cannot read ${rarity} asset folder (${folder}). Check the rarity and assets.`);
  }
  const file = files.find(f => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()) &&
    path.basename(f, path.extname(f)).toLowerCase() === card.toLowerCase());
  if (!file) throw new Error(`Card [${rarity}] ${card} was not found in ${folder}.`);
  const actualCard = path.basename(file, path.extname(file));
  const url = `${IMAGE_BASE.replace(/\/$/, '')}/${encodeURIComponent(rarity)}/${encodeURIComponent(file)}`;
  return { rarity, card: actualCard, imageUrl: url };
}

module.exports = { parseSpecialStreamArgs, resolveSpecialRewardImage };
