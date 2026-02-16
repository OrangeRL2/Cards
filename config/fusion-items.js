// data/fusion-items.js
const FUSION_ITEMS = {
  // --- Seven Fantasy variants (same card, different requirements) ---
  // 1) noel + pekora + marine + flare (all SR)
  fantasy1: {
    name: 'FANTASY (noel + pekora + marine + flare)',
    rarity: 'COL',
    image: 'Fantasy 101',
    stock: -1,
    requires: [
      { rarity: 'SR', image: 'Noel 101', count: 1 },
      { rarity: 'SR', image: 'Pekora 101', count: 1 },
      { rarity: 'SR', image: 'Marine 101', count: 1 },
      { rarity: 'SR', image: 'Flare 101', count: 1 },
    ],
  },

  // 2) noel & pekora + marine + flare (Noel & Pekora is COL; Marine & Flare are SR)
  fantasy2: {
    name: 'FANTASY (noel & pekora + marine + flare)',
    rarity: 'COL',
    image: 'Fantasy 101',
    stock: -1,
    requires: [
      { rarity: 'COL', image: 'Noel & Pekora 101', count: 1 },
      { rarity: 'SR', image: 'Marine 101', count: 1 },
      { rarity: 'SR', image: 'Flare 101', count: 1 },
    ],
  },

  // 3) noel + pekomari + flare (Noel SR + PekoMari COL + Flare SR)
  fantasy3: {
    name: 'FANTASY (noel + PekoMari + flare)',
    rarity: 'COL',
    image: 'Fantasy 101',
    stock: -1,
    requires: [
      { rarity: 'SR', image: 'Noel 101', count: 1 },
      { rarity: 'COL', image: 'PekoMari 101', count: 1 },
      { rarity: 'SR', image: 'Flare 101', count: 1 },
    ],
  },

  // 4) noel + pekora + marifure (Noel SR + Pekora SR + MariFure COL)
  fantasy4: {
    name: 'FANTASY (noel + pekora + MariFure)',
    rarity: 'COL',
    image: 'Fantasy 101',
    stock: -1,
    requires: [
      { rarity: 'SR', image: 'Noel 101', count: 1 },
      { rarity: 'SR', image: 'Pekora 101', count: 1 },
      { rarity: 'COL', image: 'MariFure 101', count: 1 },
    ],
  },

  // 5) noel + Pekora, Marine, Flare (Noel SR + "Pekora, Marine, Flare" as single COL)
  fantasy5: {
    name: 'FANTASY (noel + Pekora, Marine, Flare)',
    rarity: 'COL',
    image: 'Fantasy 101',
    stock: -1,
    requires: [
      { rarity: 'SR', image: 'Noel 101', count: 1 },
      { rarity: 'COL', image: 'Pekora, Marine, Flare 101', count: 1 },
    ],
  },

  // 6) Noel, Pekora, Marine + flare ("Noel, Pekora, Marine" as single COL + Flare SR)
  fantasy6: {
    name: 'FANTASY (Noel, Pekora, Marine + flare)',
    rarity: 'COL',
    image: 'Fantasy 101',
    stock: -1,
    requires: [
      { rarity: 'COL', image: 'Noel, Pekora, Marine 101', count: 1 },
      { rarity: 'SR', image: 'Flare 101', count: 1 },
    ],
  },

  // 7) noel & pekora + marifure (Noel & Pekora COL + MariFure COL)
  fantasy7: {
    name: 'FANTASY (noel & pekora + marifure)',
    rarity: 'COL',
    image: 'Fantasy 101',
    stock: -1,
    requires: [
      { rarity: 'COL', image: 'Noel & Pekora 101', count: 1 },
      { rarity: 'COL', image: 'MariFure 101', count: 1 },
    ],
  },

  // Noel / Pekora / Marine (3 combinations)
noel_pekora_marine_1: {
  name: 'NOEL, PEKORA, MARINE (noel + pekora + marine)',
  rarity: 'COL',
  image: 'Noel, Pekora, Marine 101',
  stock: -1,
  requires: [
    { rarity: 'SR', image: 'Noel 101', count: 1 },
    { rarity: 'SR', image: 'Pekora 101', count: 1 },
    { rarity: 'SR', image: 'Marine 101', count: 1 },
  ],
},

noel_pekora_marine_2: {
  name: 'NOEL, PEKORA, MARINE (noel & pekora + marine)',
  rarity: 'COL',
  image: 'Noel, Pekora, Marine 101',
  stock: -1,
  requires: [
    { rarity: 'COL', image: 'Noel & Pekora 101', count: 1 },
    { rarity: 'SR', image: 'Marine 101', count: 1 },
  ],
},

noel_pekora_marine_3: {
  name: 'NOEL, PEKORA, MARINE (noel + PekoMari)',
  rarity: 'COL',
  image: 'Noel, Pekora, Marine 101',
  stock: -1,
  requires: [
    { rarity: 'SR', image: 'Noel 101', count: 1 },
    { rarity: 'COL', image: 'PekoMari 101', count: 1 },
  ],
},

// Pekora / Marine / Flare (3 combinations)
pekora_marine_flare_1: {
  name: 'PEKORA, MARINE, FLARE (pekora + marine + flare)',
  rarity: 'COL',
  image: 'Pekora, Marine, Flare 101',
  stock: -1,
  requires: [
    { rarity: 'SR', image: 'Pekora 101', count: 1 },
    { rarity: 'SR', image: 'Marine 101', count: 1 },
    { rarity: 'SR', image: 'Flare 101', count: 1 },
  ],
},

pekora_marine_flare_2: {
  name: 'PEKORA, MARINE, FLARE (PekoMari + flare)',
  rarity: 'COL',
  image: 'Pekora, Marine, Flare 101',
  stock: -1,
  requires: [
    { rarity: 'COL', image: 'PekoMari 101', count: 1 },
    { rarity: 'SR', image: 'Flare 101', count: 1 },
  ],
},

pekora_marine_flare_3: {
  name: 'PEKORA, MARINE, FLARE (pekora + MariFure)',
  rarity: 'COL',
  image: 'Pekora, Marine, Flare 101',
  stock: -1,
  requires: [
    { rarity: 'SR', image: 'Pekora 101', count: 1 },
    { rarity: 'COL', image: 'MariFure 101', count: 1 },
  ],
},

  // --- Compound items used by fantasy variants (COL items use 101 suffix) ---
  marifure: {
    name: 'MARIFURE (Marine + Flare)',
    rarity: 'COL',
    image: 'MariFure 101',
    stock: -1,
    requires: [
      { rarity: 'SR', image: 'Marine 101', count: 1 },
      { rarity: 'SR', image: 'Flare 101', count: 1 },
    ],
  },

  noel_and_pekora: {
    name: 'NOEL & PEKORA',
    rarity: 'COL',
    image: 'Noel & Pekora 101',
    stock: -1,
    requires: [
      { rarity: 'SR', image: 'Noel 101', count: 1 },
      { rarity: 'SR', image: 'Pekora 101', count: 1 },
    ],
  },

  pekomari: {
    name: 'PEKOMARI (Pekora + Marine)',
    rarity: 'COL',
    image: 'PekoMari 101',
    stock: -1,
    requires: [
      { rarity: 'SR', image: 'Pekora 101', count: 1 },
      { rarity: 'SR', image: 'Marine 101', count: 1 },
    ],
  },

  //VAL COLS
    AquaAya: {
    name: 'Aqua & Aya Trained(Aqua & Aya + Aqua & Aya)',
    rarity: 'COL',
    image: 'Aqua & Aya 101',
    stock: -1,
    requires: [
      { rarity: 'VAL', image: 'Aqua & Aya 101', count: 1 },
      { rarity: 'VAL', image: 'Aqua & Aya 101', count: 1 },
    ],
  },
    BotanTomori: {
    name: 'Botan & Tomori Trained(Botan & Tomori + Botan & Tomori)',
    rarity: 'COL',
    image: 'Botan & Tomori 101',
    stock: -1,
    requires: [
      { rarity: 'VAL', image: 'Botan & Tomori 001', count: 1 },
      { rarity: 'VAL', image: 'Botan & Tomori 001', count: 1 },
    ],
  },
      ChloeYukina: {
    name: 'Chloe & Yukina Trained(Chloe & Yukina + Chloe & Yukina)',
    rarity: 'COL',
    image: 'Chloe & Yukina 101',
    stock: -1,
    requires: [
      { rarity: 'VAL', image: 'Chloe & Yukina 101', count: 1 },
      { rarity: 'VAL', image: 'Chloe & Yukina 101', count: 1 },
    ],
  },
    FubukiKokoro: {
    name: 'Fubuki & Kokoro Trained(Fubuki & Kokoro + Fubuki & Kokoro)',
    rarity: 'COL',
    image: 'Fubuki & Kokoro 101',
    stock: -1,
    requires: [
      { rarity: 'VAL', image: 'Fubuki & Kokoro 101', count: 1 },
      { rarity: 'VAL', image: 'Fubuki & Kokoro 101', count: 1 },
    ],
  },

    LamyMashiro: {
    name: 'Lamy & Mashiro Trained(Lamy & Mashiro + Lamy & Mashiro)',
    rarity: 'COL',
    image: 'Lamy & Mashiro 101',
    stock: -1,
    requires: [
      { rarity: 'VAL', image: 'Lamy & Mashiro 101', count: 1 },
      { rarity: 'VAL', image: 'Lamy & Mashiro 101', count: 1 },
    ],
  },
      MarineRan: {
    name: 'Marine & Ran Trained(Marine & Ran + Marine & Ran)',
    rarity: 'COL',
    image: 'Marine & Ran 101',
    stock: -1,
    requires: [
      { rarity: 'VAL', image: 'Marine & Ran 101', count: 1 },
      { rarity: 'VAL', image: 'Marine & Ran 101', count: 1 },
    ],
  },

        SoraKasumi: {
    name: 'Sora & Kasumi Trained(Sora & Kasumi + Sora & Kasumi)',
    rarity: 'COL',
    image: 'Sora & Kasumi 101',
    stock: -1,
    requires: [
      { rarity: 'VAL', image: 'Sora & Kasumi 101', count: 1 },
      { rarity: 'VAL', image: 'Sora & Kasumi 101', count: 1 },
    ],
  },

    SuiseiLayer: {
    name: 'Suisei & LAYER Trained(Suisei & Layer + Suisei & Layer)',
    rarity: 'COL',
    image: 'Suisei & LAYER 101',
    stock: -1,
    requires: [
      { rarity: 'VAL', image: 'Suisei & LAYER 101', count: 1 },
      { rarity: 'VAL', image: 'Suisei & LAYER 101', count: 1 },
    ],
  },
};

module.exports = FUSION_ITEMS;
