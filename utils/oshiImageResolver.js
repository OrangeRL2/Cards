'use strict';
// Find the actual on-disk image, instead of assuming every card is a .png.
// Oshi images are sent to Discord as attachments to avoid hotlink failures.
const fs = require('node:fs');
const path = require('node:path');
const { artRarity } = require('../config/unknownCards');

const DEFAULT_ROOT = path.resolve(__dirname, '..', 'assets', 'images');
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function imageParts(rarityInput, cardNameInput) {
  const rarity = String(rarityInput ?? '').trim();
  const cardName = String(cardNameInput ?? '').trim();
  if (!rarity || !cardName || /[\\/\0]/.test(cardName)) return null;

  if (/^★{3,5}$/.test(rarity)) return { segments: ['HOLODORI', rarity], cardName };
  if (rarity.toUpperCase() === 'HOLODORI') return { segments: ['HOLODORI', '★★★'], cardName };
  if (rarity.toUpperCase() === 'SUN' && /^full\s*art\b/i.test(cardName)) {
    return { segments: ['SUN', 'Full Art'], cardName };
  }
  const actualFolder = artRarity(cardName, rarity);
  if (!actualFolder || /[\\/\0]/.test(actualFolder) || actualFolder === '..') return null;
  return { segments: [actualFolder], cardName };
}

function isRegularFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function findActualFile(directory, cardName) {
  for (const extension of IMAGE_EXTENSIONS) {
    const exact = path.join(directory, cardName + extension);
    if (isRegularFile(exact)) return exact;
  }
  // Account for upper-case extensions and minor filename-case differences.
  let entries;
  try { entries = fs.readdirSync(directory); } catch { return null; }
  const wanted = cardName.normalize('NFC').toLocaleLowerCase('en');
  for (const entry of entries) {
    const ext = path.extname(entry);
    if (!IMAGE_EXTENSIONS.includes(ext.toLowerCase())) continue;
    if (path.basename(entry, ext).normalize('NFC').toLocaleLowerCase('en') !== wanted) continue;
    const file = path.join(directory, entry);
    if (isRegularFile(file)) return file;
  }
  return null;
}

function resolveOshiImage(rarity, cardName, options = {}) {
  const pieces = imageParts(rarity, cardName);
  if (!pieces) return { path: null, expected: null };
  const root = path.resolve(options.imageRoot || DEFAULT_ROOT);
  const folders = [root, path.join(root, 'other'), path.join(root, 'special')];
  for (const folder of folders) {
    const dir = path.join(folder, ...pieces.segments);
    const found = findActualFile(dir, pieces.cardName);
    if (found) return { path: found, expected: found };
  }
  return { path: null, expected: path.join(root, ...pieces.segments, pieces.cardName + '.[png|jpg|jpeg|webp|gif]') };
}

function embedImage(filePath, filenameStem = 'oshi-artwork') {
  const ext = path.extname(filePath).toLowerCase();
  const name = `${filenameStem}${ext}`;
  return { url: `attachment://${name}`, file: { attachment: filePath, name } };
}

module.exports = { resolveOshiImage, embedImage };
