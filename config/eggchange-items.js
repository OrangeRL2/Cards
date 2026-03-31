// config/eggchange-items.js

const DEFAULT_REWARD_WEIGHTS = {
  card: 59.95,         // most likely
  fans: 35.00,         // also very likely
  eventpulls: 5.00,    // decently rare
  streamtickets: 0.05, // super rare
};

const CARD_POOLS = {
  White: {
    rarity: 'EAS',
    cards: {
      'Koyori 001': 33.33233333333333,
      'Hajime 101': 33.33233333333333,
      'Mumei 001': 33.33233333333333,
      'Easter X': 0.001,
      'Easter Y': 0.001,
      'Easter Z': 0.001,
    },
  },

  Green: {
    rarity: 'EAS',
    cards: {
      'Pekora 001': 33.33233333333333,
      'Mio 001': 33.33233333333333,
      'Raden 101': 33.33233333333333,
      'Easter X': 0.001,
      'Easter Y': 0.001,
      'Easter Z': 0.001,
    },
  },

  Red: {
    rarity: 'EAS',
    cards: {
      'Miko 001': 33.33233333333333,
      'Polka 001': 33.33233333333333,
      'Ririka 101': 33.33233333333333,
      'Easter X': 0.001,
      'Easter Y': 0.001,
      'Easter Z': 0.001,
    },
  },

  Blue: {
    rarity: 'EAS',
    cards: {
      'Ao 101': 33.33233333333333,
      'Shiori 001': 33.33233333333333,
      'Okayu 001': 33.33233333333333,
      'Easter X': 0.001,
      'Easter Y': 0.001,
      'Easter Z': 0.001,
    },
  },

  Purple: {
    rarity: 'EAS',
    cards: {
      'Bijou 001': 33.33233333333333,
      'Calli 001': 33.33233333333333,
      'Shion 001': 33.33233333333333,
      'Easter X': 0.001,
      'Easter Y': 0.001,
      'Easter Z': 0.001,
    },
  },

  Yellow: {
    rarity: 'EAS',
    cards: {
      'Kanade 101': 33.33233333333333,
      'Watame 001': 33.33233333333333,
      'Nene 001': 33.33233333333333,
      'Easter X': 0.001,
      'Easter Y': 0.001,
      'Easter Z': 0.001,
    },
  },
};

function toWeightedCardPool(colorName) {
  const def = CARD_POOLS[colorName];
  if (!def) return [];

  return Object.entries(def.cards).map(([image, weight]) => ({
    rarity: def.rarity,
    image,
    weight,
  }));
}

function createColorEggchange(colorName) {
  return {
    name: `${colorName} Egg Reward Gacha`,
    type: 'rewardgacha',
    costCards: [
      { rarity: 'EAS', image: `${colorName} Egg`, count: 5 },
    ],

    rewardPool: [
      { rewardType: 'card', weight: DEFAULT_REWARD_WEIGHTS.card },
      { rewardType: 'fans', amount: 25, weight: DEFAULT_REWARD_WEIGHTS.fans },
      { rewardType: 'eventpulls', amount: 1, weight: DEFAULT_REWARD_WEIGHTS.eventpulls },

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