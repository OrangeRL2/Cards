// data/event-items.js
// Keys are stable ids used in button customIds and DB ops
let xmas = 1000;
let val = 2500;
let t3 = 5000;
let t4 = 10000;
let t5 = 20000;
let t6 = 30000;
let t7 = 50000;

const SHOP_ITEMS = {
  // XMAS
  bloomSui: { name: 'XMAS Suisei', rarity: 'XMAS', cost: xmas, image: 'Padoru Suisei', stock: -1, event: 'XMAS' },
  bloomLamy: { name: 'XMAS Lamy', rarity: 'XMAS', cost: xmas, image: 'Padoru Lamy', stock: -1, event: 'XMAS' },

  bloomChloe: { name: 'XMAS Chloe', rarity: 'XMAS', cost: xmas, image: 'Padoru Chloe', stock: -1, event: 'XMAS' },
  bloomFlare: { name: 'XMAS Flare', rarity: 'XMAS', cost: xmas, image: 'Padoru Flare', stock: -1, event: 'XMAS' },
  bloomKanata: { name: 'XMAS Kanata', rarity: 'XMAS', cost: xmas, image: 'Padoru Kanata', stock: -1, event: 'XMAS' },
  bloomMoona: { name: 'XMAS Moona', rarity: 'XMAS', cost: xmas, image: 'Padoru Moona', stock: -1, event: 'XMAS' },
  bloomMumei: { name: 'XMAS Mumei', rarity: 'XMAS', cost: xmas, image: 'Padoru Mumei', stock: -1, event: 'XMAS' },
  bloomSubaru: { name: 'XMAS Subaru', rarity: 'XMAS', cost: xmas, image: 'Padoru Subaru', stock: -1, event: 'XMAS' },
  bloomTowa: { name: 'XMAS Towa', rarity: 'XMAS', cost: xmas, image: 'Padoru Towa', stock: -1, event: 'XMAS' },
  bloomZeta: { name: 'XMAS Zeta', rarity: 'XMAS', cost: xmas, image: 'Padoru Zeta', stock: -1, event: 'XMAS' },
  padoruX: { name: 'Padoru X - Does not allow UP over 50K, ORI and COL', rarity: 'XMAS', cost: t6, image: 'Padoru X', stock: -1, event: 'XMAS' },
  

  // VAL
  VALLamy: { name: 'VAL Lamy',       rarity: 'VAL', cost: val, image: 'Lamy & Mashiro 101',  stock: -1, event: 'VAL' },
  VALAqua: { name: 'VAL Aqua',       rarity: 'VAL', cost: val, image: 'Aqua & Aya 101',  stock: -1, event: 'VAL' },
  VALBotan: { name: 'VAL Botan',       rarity: 'VAL', cost: val, image: 'Botan & Tomori 001',  stock: -1, event: 'VAL' },
  VALChloe: { name: 'VAL Chloe',       rarity: 'VAL', cost: val, image: 'Chloe & Yukina 101',  stock: -1, event: 'VAL' },
  VALFubuki: { name: 'VAL Fubuki',       rarity: 'VAL', cost: val, image: 'Fubuki & Kokoro 101',  stock: -1, event: 'VAL' },
  VALMarine: { name: 'VAL Marine',       rarity: 'VAL', cost: val, image: 'Marine & Ran 101',  stock: -1, event: 'VAL' },
  VALSuisei: { name: 'VAL Suisei',       rarity: 'VAL', cost: val, image: 'Suisei & LAYER 101',  stock: -1, event: 'VAL' },
  VALSora: { name: 'VAL Sora',       rarity: 'VAL', cost: val, image: 'Sora & Kasumi 101',  stock: -1, event: 'VAL' },
};


module.exports = SHOP_ITEMS;