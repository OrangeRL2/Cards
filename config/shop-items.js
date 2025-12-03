// data/shop-items.js
// Keys are stable ids used in button customIds and DB ops
let IC = 1000;
let SR = 5000;
let UR = 10000;
let OUR = 25000;

let qualification = 10000;
let top48 = 1000;
let top16 = 1500;
let top8 = 2500;
let top4 = 5000;
let finalist = 10000;
let champ = 25000;

const SHOP_ITEMS = {
  bloom1:  { name: 'Bloom Cup Suisei Top8',  rarity: 'UP',   cost: IC + top8,   image: 'Suisei 001', stock: -1 },
  bloom2: { name: 'Bloom Cup Lamy Champ', rarity: 'UP',       cost: IC + champ,  image: 'Lamy 001',  stock: -1 },
  bloom3: { name: 'Bloom Cup Fubuki Top 8', rarity: 'UP',     cost: IC + top8,  image: 'Fubuki 001',  stock: -1 },
  bloom4: { name: 'Bloom Cup Miko Champ', rarity: 'UP',       cost: IC + champ,  image: 'Miko 001',  stock: -1 },
  bloom5: { name: 'Bloom Cup Polka Top48', rarity: 'UP',       cost: IC + top48,  image: 'Polka 001',  stock: -1 },
  bloom6: { name: 'Bloom Cup Reine Top8', rarity: 'UP',       cost: IC + top8,  image: 'Reine 501',  stock: -1 },

  sparkle1: { name: 'Shiny Sparkles Symphony Gen 0', rarity: 'UP', cost: IC,  image: 'Gen 0 001',  stock: -1 },

  witch1: { name: 'HoloWitch Holowitches', rarity: 'UP', cost: IC,  image: 'Holowitches 001',  stock: -1 },

  worldTour1: { name: 'WorldTour25 -Synchronize!- Calli, IRyS, Nerissa, Ollie, Nene', rarity: 'UP', cost: IC, image: 'Calli, IRyS, Nerissa , Ollie, Nene 501', stock: -1 },

  wgpTop16: { name: 'World Grand Prix Top16 Koyori', rarity: 'UP', cost: SR + top16,  image: 'Koyori 001',  stock: -1 },
  wgpTop4: { name: 'World Grand Prix Top4 OkaKoro', rarity: 'UP', cost: UR + top4,  image: 'OkaKoro 001',  stock: -1 },

  exstreamerChamp: { name: 'Exstreamer Cup Champion Suisei', rarity: 'UP', cost: OUR + champ, image: 'Suisei 002', stock: -1 },
};

module.exports = SHOP_ITEMS;

//notes
/*
base price
Illust Change (P) 1000
SR 5000
UR 10000
OUR 25000
entry + 0
certain entry qualification + 10000
top48 + 1000
top16 + 1000
top8 + 2500
top4 + 5000
Finalist + 10000
Champion + 25000
*/
