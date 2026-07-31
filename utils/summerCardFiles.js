// utils/summerCardFiles.js
// Runtime source of truth for standard SUN card images.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ASSETS_ROOT = path.join(__dirname, '..', 'assets', 'images');
const SUN_ISLAND_FOLDERS = Object.freeze(['Blue', 'Green', 'Red', 'Yellow']);
const IMAGE_FILE_RE = /\.(png|jpe?g|webp|gif)$/i;

function normalizeIslandFolder(folder) {
  const wanted = String(folder || '').trim().toLowerCase();
  return SUN_ISLAND_FOLDERS.find(value => value.toLowerCase() === wanted) || null;
}

function readIslandSunCards(folder, assetsRoot = DEFAULT_ASSETS_ROOT) {
  const islandFolder = normalizeIslandFolder(folder);
  if (!islandFolder) return [];

  const folderPath = path.join(assetsRoot, 'SUN', islandFolder);
  if (!fs.existsSync(folderPath)) return [];

  return fs.readdirSync(folderPath, { withFileTypes: true })
    .filter(entry => entry.isFile() && IMAGE_FILE_RE.test(entry.name))
    .map(entry => ({
      rarity: 'SUN',
      cardName: path.basename(entry.name, path.extname(entry.name)),
      name: path.basename(entry.name, path.extname(entry.name)),
      folder: islandFolder,
      filename: entry.name,
      file: path.join(folderPath, entry.name),
      relativeImagePath: path.posix.join('SUN', islandFolder, entry.name),
    }))
    .sort((a, b) => a.cardName.localeCompare(b.cardName));
}

function getAllSunCardsFromFolders(assetsRoot = DEFAULT_ASSETS_ROOT) {
  return SUN_ISLAND_FOLDERS.flatMap(folder => readIslandSunCards(folder, assetsRoot));
}

function findSunCardFile(cardName, assetsRoot = DEFAULT_ASSETS_ROOT) {
  const wanted = String(cardName || '').trim().toLowerCase();
  if (!wanted) return null;
  return getAllSunCardsFromFolders(assetsRoot)
    .find(card => card.cardName.toLowerCase() === wanted) || null;
}

module.exports = {
  DEFAULT_ASSETS_ROOT,
  SUN_ISLAND_FOLDERS,
  readIslandSunCards,
  getAllSunCardsFromFolders,
  findSunCardFile,
};
