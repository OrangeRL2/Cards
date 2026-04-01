// config/eggchange-items.js
// 100,000-scale weights (integer) for cleaner RNG resolution.
// RewardPool sums to 100000. Each CardPool (per color) sums to 100000.

// Reward weights (percent -> out of 100000)
const DEFAULT_REWARD_WEIGHTS = {
  card: 59900,        // 59.90%
  fans: 30000,        // 30.00%
  eventpulls: 10000,  // 10.00%
  streamtickets: 100, // 0.10%
};

// Each color pool totals 100000.
// Easter X/Y/O = 10 each => 0.01% each (10 / 100000).
// Named cards share remaining 99970 as evenly as possible: 33324 + 33323 + 33323.
const CARD_POOLS = {
  White: {
    rarity: 'EAS',
    cards: {
      'Koyori 001': 33324,
      'Hajime 101': 33323,
      'Mumei 001': 33323,
      'Easter X': 10,
      'Easter Y': 10,
      'Easter O': 10,
    },
  },

  Green: {
    rarity: 'EAS',
    cards: {
      'Pekora 001': 33324,
      'Mio 001': 33323,
      'Raden 101': 33323,
      'Easter X': 10,
      'Easter Y': 10,
      'Easter O': 10,
    },
  },

  Red: {
    rarity: 'EAS',
    cards: {
      'Miko 001': 33324,
      'Polka 001': 33323,
      'Ririka 101': 33323,
      'Easter X': 10,
      'Easter Y': 10,
      'Easter O': 10,
    },
  },

  Blue: {
    rarity: 'EAS',
    cards: {
      'Ao 101': 33324,
      'Shiori 001': 33323,
      'Okayu 001': 33323,
      'Easter X': 10,
      'Easter Y': 10,
      'Easter O': 10,
    },
  },

  Purple: {
    rarity: 'EAS',
    cards: {
      'Bijou 001': 33324,
      'Calli 001': 33323,
      'Shion 001': 33323,
      'Easter X': 10,
      'Easter Y': 10,
      'Easter O': 10,
    },
  },

  Yellow: {
    rarity: 'EAS',
    cards: {
      'Kanade 101': 33324,
      'Watame 001': 33323,
      'Nene 001': 33323,
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