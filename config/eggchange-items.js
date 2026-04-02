// config/eggchange-items.js
// Each color pool totals 100000.
// Easter X/Y/O = 10 each => 0.01% each (10 / 100000).
// Named cards share remaining 99970 across 7 names:
// 3 cards get 14282, 4 cards get 14281 (14282*3 + 14281*4 = 99970).

// Reward weights (percent -> out of 100000)
const DEFAULT_REWARD_WEIGHTS = {
  card: 59900,        // 59.90%
  fans: 30000,        // 30.00%
  eventpulls: 10000,  // 10.00%
  streamtickets: 100, // 0.10%
};

const CARD_POOLS = {
  White: {
    rarity: 'EAS',
    cards: {
      'Hajime 101': 14282,
      'Kanata 001': 14282,
      'Koyori 001': 14282,
      'Koyori 101': 14281,
      'Mumei 001': 14281,
      'Sora 001': 14281,
      'Fubuki 001': 14281,
      'Easter X': 10,
      'Easter Y': 10,
      'Easter O': 10,
    },
  },

  Green: {
    rarity: 'EAS',
    cards: {
      'Fauna 001': 14282,
      'Iroha 101': 14282,
      'Mio 001': 14282,
      'Pekora 001': 14281,
      'Raden 101': 14281,
      'AZKi 001': 14281,
      'Cecilia 001': 14281,
      'Easter X': 10,
      'Easter Y': 10,
      'Easter O': 10,
    },
  },

  Red: {
    rarity: 'EAS',
    cards: {
      'Ayame 001': 14282,
      'Miko 001': 14282,
      'Mococo 001': 14282,
      'Polka 001': 14281,
      'Ririka 101': 14281,
      'Marine 001': 14281,
      'Lui 101': 14281,
      'Easter X': 10,
      'Easter Y': 10,
      'Easter O': 10,
    },
  },

  Blue: {
    rarity: 'EAS',
    cards: {
      'Ao 101': 14282,
      'Aqua 001': 14282,
      'Chloe 101': 14282,
      'Lamy 001': 14281,
      'Okayu 001': 14281,
      'Shiori 001': 14281,
      'Suisei 001': 14281,
      'Easter X': 10,
      'Easter Y': 10,
      'Easter O': 10,
    },
  },

  Purple: {
    rarity: 'EAS',
    cards: {
      'Bijou 001': 14282,
      'Calli 001': 14282,
      'Shion 001': 14282,
      'Towa 001': 14281,
      'Ina 001': 14281,
      'Roboco 001': 14281,
      'La+ 101': 14281,
      'Easter X': 10,
      'Easter Y': 10,
      'Easter O': 10,
    },
  },

  Yellow: {
    rarity: 'EAS',
    cards: {
      'Flare 001': 14282,
      'Kanade 101': 14282,
      'Nene 001': 14282,
      'Watame 001': 14281,
      'Watame 002': 14281,
      'Ame 001': 14281,
      'Anya 001': 14281,
      'Easter X': 10,
      'Easter Y': 10,
      'Easter O': 10,
    },
  },
};

function toWeightedCardPool(colorName) {
  const def = CARD_POOLS[colorName];
  if (!def) return [];

  return Object.entries(def.cards).map(([image, weight]) => ({
    rarity: def.rarity,
    image,
    weight, // integer out of 100000-scale
  }));
}

function createColorEggchange(colorName) {
  return {
    name: `${colorName} Egg Reward Gacha`,
    type: 'rewardgacha',
    costCards: [{ rarity: 'EAS', image: `${colorName} Egg`, count: 5 }],

    rewardPool: [
      { rewardType: 'card', weight: DEFAULT_REWARD_WEIGHTS.card },
      { rewardType: 'fans', amount: 25, weight: DEFAULT_REWARD_WEIGHTS.fans },
      { rewardType: 'eventpulls', amount: 5, weight: DEFAULT_REWARD_WEIGHTS.eventpulls },

      // Stream Ticket is just a card reward
      {
        rewardType: 'streamticketcard',
        rarity: 'EAS',
        image: 'Stream Ticket',
        amount: 1,
        weight: DEFAULT_REWARD_WEIGHTS.streamtickets,
      },
    ],

    cardPool: toWeightedCardPool(colorName),
    banner: { rarity: 'EAS', image: `${colorName} Easter Banner` },
  };
}

const EGGSCHANGE_ITEMS = {
  whiteEggchange: createColorEggchange('White'),
  greenEggchange: createColorEggchange('Green'),
  redEggchange: createColorEggchange('Red'),
  blueEggchange: createColorEggchange('Blue'),
  purpleEggchange: createColorEggchange('Purple'),
  yellowEggchange: createColorEggchange('Yellow'),
};

module.exports = EGGSCHANGE_ITEMS;