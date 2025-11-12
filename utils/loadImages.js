const fs = require('fs');
const path = require('path');

function loadPools() {
  const base = path.join(__dirname, '..', 'assets', 'images');
  const rarities = fs.readdirSync(base);
  const pools = {};

  for (const rarity of rarities) {
    const folder = path.join(base, rarity);
    const files = fs
      .readdirSync(folder)
      .filter(f => /\.(png|jpe?g|gif)$/.test(f));
    pools[rarity] = files.map(f => path.join(folder, f));
  }

  return pools; // { Common: [...], Rare: [...], UltraRare: [...] }
}

module.exports = loadPools();