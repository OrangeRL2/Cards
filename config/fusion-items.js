// data/fusion-items.js
const FUSION_ITEMS = {
  // --- Seven Fantasy variants (same card, different requirements) ---
    FubuMio1: {
    name: 'FubuMio',
    rarity: 'COL',
    image: 'FubuMio 001',
    stock: -1,
    requires: [
      { rarity: 'ORI', image: 'Fubuki 001', count: 1 },
      { rarity: 'ORI', image: 'Mio 001', count: 1 },
    ],
  },
      FuwaMoco1: {
    name: 'FUWAMOCO 101',
    rarity: 'COL',
    image: 'FUWAMOCO 101',
    stock: -1,
    requires: [
      { rarity: 'SP', image: 'Fuwawa 101', count: 1 },
      { rarity: 'SP', image: 'Mococo 101', count: 1 },
    ],
  },
        FuwaMoco2: {
    name: 'FUWAMOCO 002',
    rarity: 'COL',
    image: 'FUWAMOCO 002',
    stock: -1,
    requires: [
      { rarity: 'ORI', image: 'Mococo 002', count: 1 },
      { rarity: 'ORI', image: 'Fuwawa 002', count: 1 },
    ],
  },
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

      ReGLOSS: {
    name: 'Spring ReGLOSS(Ririka + Hajime + Kanade + Raden + Ao)',
    rarity: 'COL',
    image: 'ReGLOSS 101',
    stock: -1,
    requires: [
      { rarity: 'EAS', image: 'Ririka 101', count: 1 },
      { rarity: 'EAS', image: 'Hajime 101', count: 1 },
      { rarity: 'EAS', image: 'Kanade 101', count: 1 },
      { rarity: 'EAS', image: 'Raden 101', count: 1 },
      { rarity: 'EAS', image: 'Ao 101', count: 1 },
    ],
  },

  holoX: {
    name: 'Spring holoX(Lappy + Lui + Iroha + Koyori + Chloe)',
    rarity: 'COL',
    image: 'holoX 101',
    stock: -1,
    requires: [
      { rarity: 'EAS', image: 'La+ 101', count: 1 },
      { rarity: 'EAS', image: 'Lui 101', count: 1 },
      { rarity: 'EAS', image: 'Iroha 101', count: 1 },
      { rarity: 'EAS', image: 'Koyori 101', count: 1 },
      { rarity: 'EAS', image: 'Chloe 101', count: 1 },
    ],
  },
    holoXEVAll: {
    name: 'First MISSION holoX ALL(Lappy + Lui + Koyori + Iroha)',
    rarity: 'COL',
    image: 'holoX 102',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'La+ 103', count: 1 },
      { rarity: 'EV', image: 'Lui 104', count: 1 },
      { rarity: 'EV', image: 'Koyori 105', count: 1 },
      { rarity: 'EV', image: 'Iroha 106', count: 1 },

    ],
  },
      holoXEVLappy: {
    name: 'First MISSION holoX Lappy(Lappy + Lui + Koyori + Iroha)',
    rarity: 'COL',
    image: 'holoX 103',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'La+ 103', count: 1 },
      { rarity: 'EV', image: 'Lui 104', count: 1 },
      { rarity: 'EV', image: 'Koyori 105', count: 1 },
      { rarity: 'EV', image: 'Iroha 106', count: 1 },
    ],
  },
        holoXEVLui: {
    name: 'First MISSION holoX Lui(Lappy + Lui + Koyori + Iroha)',
    rarity: 'COL',
    image: 'holoX 104',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'La+ 103', count: 1 },
      { rarity: 'EV', image: 'Lui 104', count: 1 },
      { rarity: 'EV', image: 'Koyori 105', count: 1 },
      { rarity: 'EV', image: 'Iroha 106', count: 1 },
    ],
  },
          holoXEVKoyori: {
    name: 'First MISSION holoX Koyori(Lappy + Lui + Koyori + Iroha)',
    rarity: 'COL',
    image: 'holoX 105',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'La+ 103', count: 1 },
      { rarity: 'EV', image: 'Lui 104', count: 1 },
      { rarity: 'EV', image: 'Koyori 105', count: 1 },
      { rarity: 'EV', image: 'Iroha 106', count: 1 },
    ],
  },
            holoXEVIroha: {
    name: 'First MISSION holoX Iroha(Lappy + Lui + Koyori + Iroha)',
    rarity: 'COL',
    image: 'holoX 106',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'La+ 103', count: 1 },
      { rarity: 'EV', image: 'Lui 104', count: 1 },
      { rarity: 'EV', image: 'Koyori 105', count: 1 },
      { rarity: 'EV', image: 'Iroha 106', count: 1 },
    ],
  },
              holoXEV2: {
    name: 'First MISSION holoX 2 (Lappy + Lui + Koyori + Iroha)',
    rarity: 'COL',
    image: 'holoX 107',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'La+ 103', count: 1 },
      { rarity: 'EV', image: 'Lui 104', count: 1 },
      { rarity: 'EV', image: 'Koyori 105', count: 1 },
      { rarity: 'EV', image: 'Iroha 106', count: 1 },
    ],
  },

holoWitchesEV1: {
    name: 'holoWitches 001',
    rarity: 'COL',
    image: 'holoWitches 001',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'Luna 001', count: 1 },
      { rarity: 'EV', image: 'Miko 001', count: 1 },
      { rarity: 'EV', image: 'Kanata 001', count: 1 },
      { rarity: 'EV', image: 'Marine 001', count: 1 },
      { rarity: 'EV', image: 'Chloe 001', count: 1 },
      { rarity: 'EV', image: 'Shion 001', count: 1 },
    ],
  },

  holoWitchesEV2: {
    name: 'holoWitches 002',
    rarity: 'COL',
    image: 'holoWitches 002',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'Luna 002', count: 1 },
      { rarity: 'EV', image: 'Miko 002', count: 1 },
      { rarity: 'EV', image: 'Kanata 002', count: 1 },
      { rarity: 'EV', image: 'Marine 002', count: 1 },
      { rarity: 'EV', image: 'Chloe 002', count: 1 },
      { rarity: 'EV', image: 'Shion 002', count: 1 },
    ],
  },

  holoWitchesEV3: {
    name: 'holoWitches 003',
    rarity: 'COL',
    image: 'holoWitches 003',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'Luna 001', count: 1 },
      { rarity: 'EV', image: 'Miko 001', count: 1 },
      { rarity: 'EV', image: 'Kanata 001', count: 1 },
      { rarity: 'EV', image: 'Marine 001', count: 1 },
      { rarity: 'EV', image: 'Chloe 001', count: 1 },
      { rarity: 'EV', image: 'Shion 001', count: 1 },
    ],
  },

  holoWitchesEV4: {
    name: 'holoWitches 004',
    rarity: 'COL',
    image: 'holoWitches 004',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'Luna 001', count: 1 },
      { rarity: 'EV', image: 'Miko 001', count: 1 },
      { rarity: 'EV', image: 'Kanata 001', count: 1 },
      { rarity: 'EV', image: 'Marine 001', count: 1 },
      { rarity: 'EV', image: 'Chloe 001', count: 1 },
      { rarity: 'EV', image: 'Shion 001', count: 1 },
    ],
  },

  holoWitchesEV5: {
    name: 'holoWitches 005',
    rarity: 'COL',
    image: 'holoWitches 005',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'Luna 002', count: 1 },
      { rarity: 'EV', image: 'Miko 002', count: 1 },
      { rarity: 'EV', image: 'Kanata 002', count: 1 },
      { rarity: 'EV', image: 'Marine 002', count: 1 },
      { rarity: 'EV', image: 'Chloe 002', count: 1 },
      { rarity: 'EV', image: 'Shion 002', count: 1 },
    ],
  },

  holoWitchesEV6: {
    name: 'holoWitches 006',
    rarity: 'COL',
    image: 'holoWitches 006',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'Luna 001', count: 1 },
      { rarity: 'EV', image: 'Miko 001', count: 1 },
      { rarity: 'EV', image: 'Kanata 001', count: 1 },
      { rarity: 'EV', image: 'Marine 001', count: 1 },
      { rarity: 'EV', image: 'Lamy 001', count: 1 },
      { rarity: 'EV', image: 'Fubuki 001', count: 1 },
    ],
  },

  holoWitchesEV7: {
    name: 'holoWitches 007',
    rarity: 'COL',
    image: 'holoWitches 007',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'Luna 001', count: 1 },
      { rarity: 'EV', image: 'Miko 001', count: 1 },
      { rarity: 'EV', image: 'Kanata 001', count: 1 },
      { rarity: 'EV', image: 'Marine 001', count: 1 },
      { rarity: 'EV', image: 'Lamy 001', count: 1 },
      { rarity: 'EV', image: 'Fubuki 001', count: 1 },
    ],
  },
    holoWitchesEV8: {
    name: 'holoWitches 008',
    rarity: 'COL',
    image: 'holoWitches 008',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'Marine 002', count: 1 },
      { rarity: 'EV', image: 'Miko 002', count: 1 },
      { rarity: 'EV', image: 'Luna 002', count: 1 },
      { rarity: 'EV', image: 'Chloe 002', count: 1 },
      { rarity: 'EV', image: 'Shion 002', count: 1 },
      { rarity: 'EV', image: 'Kanata 002', count: 1 },
    ],
  },
      holoWitchesEV9: {
    name: 'holoWitches 009',
    rarity: 'COL',
    image: 'holoWitches 009',
    stock: -1,
    requires: [
      { rarity: 'EV', image: 'Marine 002', count: 1 },
      { rarity: 'EV', image: 'Miko 002', count: 1 },
      { rarity: 'EV', image: 'Luna 002', count: 1 },
      { rarity: 'EV', image: 'Chloe 002', count: 1 },
      { rarity: 'EV', image: 'Shion 002', count: 1 },
      { rarity: 'EV', image: 'Kanata 002', count: 1 },
    ],
  },
        holoWitchesEV9: {
    name: 'holoWitches 010',
    rarity: 'COL',
    image: 'holoWitches 010',
    stock: -1,
    requires: [
      { rarity: 'SR', image: 'Marine 001', count: 1 },
      { rarity: 'SR', image: 'Miko 001', count: 1 },
      { rarity: 'SR', image: 'Luna 001', count: 1 },
      { rarity: 'SR', image: 'Chloe 003', count: 1 },
      { rarity: 'SR', image: 'Shion 001', count: 1 },
      { rarity: 'SR', image: 'Kanta 001', count: 1 },
    ],
  },
};

module.exports = FUSION_ITEMS;
