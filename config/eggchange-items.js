// config/eggchange-items.js
// Exchange items for /eggschange (card-currency shop)

const EGGSCHANGE_ITEMS = {
  // --- GACHA EXAMPLES ---
  easterGacha1: {
    name: 'White Easter Gacha 1x',
    type: 'gacha', // 'gacha' | 'eventpulls' | 'fans'
    pulls: 1,
    costCards: [
      { rarity: 'EAS', image: 'White Egg', count: 5 },
    ],
    pool: [
      { rarity: 'EAS', image: 'Zeta 001', weight: 50.0 },
      { rarity: 'EAS', image: 'Lamy 001', weight: 50.0 },
      // add more...
    ],
    banner: { rarity: 'EAS', image: 'White Easter Banner' },
  },

  easterGacha10: {
    name: 'White Easter Gacha 10x',
    type: 'gacha',
    pulls: 10,
    costCards: [
      { rarity: 'EAS', image: 'White Egg', count: 50 },
    ],
    pool: [
      { rarity: 'EAS', image: 'Zeta 001', weight: 50.0 },
      { rarity: 'EAS', image: 'Lamy 001', weight: 50.0 },
      // add more...
    ],
    banner: { rarity: 'EAS', image: 'White Easter Banner' },
  },

  // --- EXCHANGE EGGS -> EVENT PULLS (PullQuota.eventPulls) ---
  easterPulls10: {
    name: 'Event pulls +10',
    type: 'eventpulls',
    amount: 10,
    costCards: [{ rarity: 'EAS', image: 'White Egg', count: 5 }],
    costCards: [{ rarity: 'EAS', image: 'Green Egg', count: 5 }],
    costCards: [{ rarity: 'EAS', image: 'Red Egg', count: 5 }],
    costCards: [{ rarity: 'EAS', image: 'Blue Egg', count: 5 }],
    costCards: [{ rarity: 'EAS', image: 'Purple Egg', count: 5 }],
    costCards: [{ rarity: 'EAS', image: 'Yellow Egg', count: 5 }],
  },
  // --- EXCHANGE EGGS -> FANS (User.points) ---
  easterFans100: {
    name: 'Fans +100',
    type: 'fans',
    amount: 100,
    costCards: [{ rarity: 'EAS', image: 'White Egg', count: 5 }],
  },
};

module.exports = EGGSCHANGE_ITEMS;
