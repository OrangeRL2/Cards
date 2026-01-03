// utils/loadImages.js
const fs = require('fs');
const path = require('path');

function readRarityFolders(baseDir) {
  // returns { rarityName: [absoluteFilePaths...] }
  if (!fs.existsSync(baseDir)) return {};
  const rarities = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const out = {};
  for (const rarity of rarities) {
    const folder = path.join(baseDir, rarity);
    const files = fs.readdirSync(folder)
      .filter(f => /\.(png|jpe?g|gif)$/i.test(f))
      .map(f => path.join(folder, f));
    if (files.length > 0) out[rarity] = files;
  }
  return out;
}

function loadPools() {
  const assetsBase = path.join(__dirname, '..', 'assets', 'images');

  // Default (top-level) pools: assets/images/<Rarity>/*
  const defaultPools = readRarityFolders(assetsBase);

  // Optional group-specific pools: assets/images/special/<Rarity>/* and assets/images/other/<Rarity>/*
  const specialBase = path.join(__dirname, '..', 'assets', 'images');
  const otherBase = path.join(assetsBase, 'other');

  const specialPools = readRarityFolders(specialBase);
  const otherPools = readRarityFolders(specialBase);

  // Merge into single export object while keeping group namespaces
  const pools = Object.assign({}, defaultPools);
  pools.special = specialPools;
  pools.other = otherPools;

  return pools;
}

module.exports = loadPools();
