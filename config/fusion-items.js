// data/fusion-items.js
const FUSION_ITEMS = {
  suiseiChampion: {
    name: 'Exstreamer Cup Champion Suisei',
    rarity: 'UP',
    image: 'Suisei 002',
    stock: -1,
    requires: [
      { rarity: 'C', image: 'Noel 002', count: 1 }, // Finalist Suisei
      { rarity: 'OC', image: 'Iroha 001', count: 1 }, // Top 4 Suisei
    ],
  },

  sparkleGen0Fusion: {
    name: 'Sparkle Gen0 Fusion',
    rarity: 'UP',
    image: 'Gen 0 001',
    stock: -1,
    requires: [
      { rarity: 'U', image: 'Moona 002', count: 1 },
      { rarity: 'C', image: 'Watame 502', count: 1 },
    ],
  },
};

module.exports = FUSION_ITEMS;
