// data/shop-items.js
// Keys are stable ids used in button customIds and DB ops
let t1 = 1000;
let t2 = 2500;
let t3 = 5000;
let t4 = 10000;
let t5 = 20000;
let t6 = 30000;
let t7 = 50000;
const SHOP_ITEMS = {
  //tier1
    bloomSui:  { name: 'Bloom Cup Suisei Top 8',  rarity: 'UP',         cost: t1,   image: 'Suisei 001', stock: -1 },
    bloomIro:  { name: 'Bloom Cup Iroha',  rarity: 'UP',         cost: t1,   image: 'Iroha 001', stock: -1 },
    bloomFub: { name: 'Bloom Cup Fubuki Top 8', rarity: 'UP',           cost: t1,  image: 'Fubuki 001',  stock: -1 },
    bloomPol: { name: 'Bloom Cup Polka Top 48', rarity: 'UP',           cost: t1,  image: 'Polka 001',  stock: -1 },
    sparkleGen0: { name: 'Shiny Sparkles Symphony Gen 0', rarity: 'UP',  cost: t1,  image: 'Gen 0 001',  stock: -1 },
    anniSorAZ:  { name: 'Anniversary SorAZ',  rarity: 'UP',               cost: t1,   image: 'SorAZ 001', stock: -1 },

    holoDoriAyame:  { name: 'HoloDori Ayame',  rarity: 'UP',               cost: t1,   image: 'Ayame 001', stock: -1 },
    holoDoriBaelz:  { name: 'HoloDori Baelz',  rarity: 'UP',               cost: t1,   image: 'Baelz 001', stock: -1 },
    holoDoriBotan:  { name: 'HoloDori Botan',  rarity: 'UP',               cost: t1,   image: 'Botan 001', stock: -1 },
    bloomCupFubukiEN:  { name: 'Bloom Cup Fubuki EN',  rarity: 'UP',               cost: t1,   image: 'Fubuki 501', stock: -1 },
    holoDoriKiara:  { name: 'HoloDori Kiara',  rarity: 'UP',               cost: t1,   image: 'Kiara 001', stock: -1 },
    holoDoriKobo:  { name: 'HoloDori Kobo',  rarity: 'UP',               cost: t1,   image: 'Kobo 001', stock: -1 },
    holoDoriLa:  { name: 'HoloDori La+',  rarity: 'UP',               cost: t1,   image: 'La+ 001', stock: -1 },
    holoDoriMatsuri:  { name: 'HoloDori Matsuri',  rarity: 'UP',               cost: t1,   image: 'Matsuri 001', stock: -1 },
    holoDoriNerissa:  { name: 'HoloDori Nerissa',  rarity: 'UP',               cost: t1,   image: 'Nerissa 001', stock: -1 },
    holoDoriOkayu:  { name: 'HoloDori Okayu',  rarity: 'UP',               cost: t1,   image: 'Okayu 001', stock: -1 },
    holoDoriPekora002:  { name: 'HoloDori Pekora',  rarity: 'UP',               cost: t1,   image: 'Pekora 002', stock: -1 },
    holoDoriRaden002:  { name: 'HoloDori Raden',  rarity: 'UP',               cost: t1,   image: 'Raden 002', stock: -1 },
    holoDoriReine:  { name: 'HoloDori Reine',  rarity: 'UP',               cost: t1,   image: 'Reine 001', stock: -1 },
    holoDoriSora:  { name: 'HoloDori Sora',  rarity: 'UP',               cost: t1,   image: 'Sora 001', stock: -1 },
    bloomCupSoraEN:  { name: 'Bloom Cup Sora EN',  rarity: 'UP',               cost: t1,   image: 'Sora 701', stock: -1 },



  //tier2
    witch1: { name: 'holoWitch holoWitches', rarity: 'UP', cost: t2,  image: 'holoWitches 001',  stock: -1 },
    worldTour1: { name: 'WorldTour25 -Synchronize!- Calli, IRyS, Nerissa, Ollie, Nene', rarity: 'UP', cost: t2, image: 'Calli, IRyS, Nerissa, Ollie, Nene 701', stock: -1 },
  //tier3
    bloomLam: { name: 'Bloom Cup Champion Lamy', rarity: 'UP',       cost: t3,  image: 'Lamy 001',  stock: -1 },
    bloomSub: { name: 'Bloom Cup Subaru', rarity: 'UP',       cost: t3,  image: 'Subaru 001',  stock: -1 },
    bloomMik: { name: 'Bloom Cup Champion Miko', rarity: 'UP',       cost: t3,  image: 'Miko 001',  stock: -1 },
    exstreamerTop8Sui: { name: 'Exstreamer Cup Top 8 Suisei', rarity: 'UP', cost: t3, image: 'Suisei 005', stock: -1 },
    bloom6: { name: 'Bloom Cup Reine Top8', rarity: 'UP',                 cost: t3,  image: 'Reine 701',  stock: -1 },
    bloomMiko: { name: 'Bloom Cup Miko EN', rarity: 'UP',                 cost: t3,  image: 'Miko 501',  stock: -1 },
  //tier4
    wgSubaLuna: { name: 'World Grand Prix Top 8 SubaLuna', rarity: 'UP',       cost: t4,  image: 'SubaLuna 001',  stock: -1 },
    wgpTop16Koy: { name: 'World Grand Prix Top 16 Koyori', rarity: 'UP',          cost: t4,  image: 'Koyori 001',  stock: -1 },
    wgpTop16Koy: { name: 'World Grand Prix Top 16 Ayame', rarity: 'UP',          cost: t4,  image: 'Ayame 002',  stock: -1 },
    wgpTop8Shion: { name: 'World Grand Prix Top 8 Shion', rarity: 'UP',            cost: t4,  image: 'Shion 001',  stock: -1 },
  //tier5
    wgpTop4: { name: 'World Grand Prix Top4 OkaKoro', rarity: 'UP',       cost: t5,  image: 'OkaKoro 001',  stock: -1 },
    exstreamerTop4Sui: { name: 'Exstreamer Cup Top 4 Suisei', rarity: 'UP', cost: t5, image: 'Suisei 004', stock: -1 },
    wgpTop4Tokyo: { name: 'World Grand Prix Tokyo Top4 Pekora', rarity: 'UP',       cost: t5,  image: 'Pekora 001',  stock: -1 },
    wgpTop4Chiba: { name: 'World Grand Prix Chiba Top4 Raden', rarity: 'UP',       cost: t5,  image: 'Raden 001',  stock: -1 },
    wtTop4Fukuoka: { name: 'World Grand Prix Fukuoka Top4 Watame', rarity: 'UP',       cost: t5,  image: 'Watame 001',  stock: -1 },
  //tier6
    exstreamer: { name: 'Exstreamer Cup Entry PekoMari', rarity: 'UP', cost: t6, image: 'PekoMari 001', stock: -1 },
    exstreamerFinal: { name: 'Exstreamer Cup Finalist Suisei', rarity: 'UP', cost: t6, image: 'Suisei 003', stock: -1 },
    
    exstreamerChamp: { name: 'Exstreamer Cup Champion Suisei', rarity: 'UP', cost: t7, image: 'Suisei 002', stock: -1 },
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


/*
// data/shop-items.js
// Keys are stable ids used in button customIds and DB ops
let t1 = 1000;
let t2 = 2500;
let t3 = 5000;
let t4 = 10000;
let t5 = 20000;
let t6 = 30000;
let t7 = 50000;
const SHOP_ITEMS = {
  //tier1
    bloomSui:  { name: 'Bloom Cup Suisei Top 8',  rarity: 'UP',         cost: t1,   image: 'Suisei 001', stock: -1 },
    bloomFub: { name: 'Bloom Cup Fubuki Top 8', rarity: 'UP',           cost: t1,  image: 'Fubuki 001',  stock: -1 },
    bloomPol: { name: 'Bloom Cup Polka Top 48', rarity: 'UP',           cost: t1,  image: 'Polka 001',  stock: -1 },
    sparkleGen0: { name: 'Shiny Sparkles Symphony Gen 0', rarity: 'UP',  cost: t1,  image: 'Gen 0 001',  stock: -1 },
    anniSorAZ:  { name: 'Anniversary SorAZ',  rarity: 'UP',               cost: t1,   image: 'SorAZ 001', stock: -1 },
  //tier2
    witch1: { name: 'HoloWitch Holowitches', rarity: 'UP', cost: t2,  image: 'Holowitches 001',  stock: -1 },
    worldTour1: { name: 'WorldTour25 -Synchronize!- Calli, IRyS, Nerissa, Ollie, Nene', rarity: 'UP', cost: t2, image: 'Calli, IRyS, Nerissa , Ollie, Nene 501', stock: -1 },
  //tier3
    bloomLam: { name: 'Bloom Cup Champion Lamy', rarity: 'UP',       cost: t3,  image: 'Lamy 001',  stock: -1 },
    bloomMik: { name: 'Bloom Cup Champion Miko', rarity: 'UP',       cost: t3,  image: 'Miko 001',  stock: -1 },
    exstreamerTop8Sui: { name: 'Exstreamer Cup Top 8 Suisei', rarity: 'UP', cost: t3, image: 'Suisei 005', stock: -1 },
    bloom6: { name: 'Bloom Cup Reine Top8', rarity: 'UP',                 cost: t3,  image: 'Reine 501',  stock: -1 },
  //tier4
    wgSubaLuna: { name: 'World Grand Prix Top 8 SubaLuna', rarity: 'UP',       cost: t4,  image: 'SubaLuna 001',  stock: -1 },
    wgpTop16Koy: { name: 'World Grand Prix Top 16 Koyori', rarity: 'UP',          cost: t4,  image: 'Koyori 001',  stock: -1 },
    wgpTop8Shion: { name: 'World Grand Prix Top 8 Shion', rarity: 'UP',            cost: t4,  image: 'Shion 001',  stock: -1 },
  //tier5
    wgpTop4: { name: 'World Grand Prix Top4 OkaKoro', rarity: 'UP',       cost: t5,  image: 'OkaKoro 001',  stock: -1 },
    exstreamerTop4Sui: { name: 'Exstreamer Cup Top 4 Suisei', rarity: 'UP', cost: t5, image: 'Suisei 004', stock: -1 },
    wgpTop4Tokyo: { name: 'World Grand Prix Tokyo Top4 Pekora', rarity: 'UP',       cost: t5,  image: 'Pekora 001',  stock: -1 },
    wgpTop4Chiba: { name: 'World Grand Prix Chiba Top4 Raden', rarity: 'UP',       cost: t5,  image: 'Raden 001',  stock: -1 },
  //tier6
    exstreamer: { name: 'Exstreamer Cup Entry PekoMari', rarity: 'UP', cost: t6, image: 'PekoMari 001', stock: -1 },
    exstreamerFinal: { name: 'Exstreamer Cup Finalist Suisei', rarity: 'UP', cost: t6, image: 'Suisei 003', stock: -1 },

    exstreamerChamp: { name: 'Exstreamer Cup Champion Suisei', rarity: 'UP', cost: t7, image: 'Suisei 002', stock: -1 },
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

