'use strict';
const CARDS = [
[0,'Roboco','The Fool',0.5],[1,'Shion','The Magician',1.75],[2,'Fubuki','The High Priestess',8],[3,'Marine','The Empress',8],[4,'Korone','The Emperor',8],[5,'Mio','The Hierophant',4],[6,'Matsuri','The Lovers',5.5],[7,'Botan','The Chariot',4],[8,'Kanata','Strength',4],[9,'Chloe','The Hermit',5.5],[10,'Pekora','Wheel of Fortune',4],[11,'Noel','Justice',4],[12,'Okayu','The Hanged Man',4],[13,'Calli','Death',0.5],[14,'Iroha','Temperance',8],[15,'Towa','The Devil',8],[16,'Miko','The Tower',4],[17,'Suisei','The Star',1.75],[18,'Luna','The Moon',4],[19,'Subaru','The Sun',8],[20,'Lui','Judgement',4],[21,'Sora','The World',0.5]
].map(([number,member,name,weight])=>Object.freeze({number,member,name,weight,cardName:`${member} 001`}));
function lookup(value){const q=String(value??'').trim().toLowerCase();return CARDS.find(x=>String(x.number)===q||x.name.toLowerCase()===q||x.name.replace(/^the /i,'').toLowerCase()===q)||null;}
function weighted(rng=Math.random){let v=rng()*100;for(const c of CARDS){v-=c.weight;if(v<0)return c;}return CARDS[CARDS.length-1];}
// The 15 Bang Dream! guest cards are collectibles only. They never grant tarot effects.
// BOO collectibles: 25% BanG Dream! TRICK, 74.97% tarot, 0.03% Halloween X.
// This distribution applies to each BOO draw from both Candy exchanges and pull extra slots.
const TRICK_CARD_NAMES = Object.freeze([
  'Afterglow 001', 'Ako 001', 'Aya 001', 'Chisato 001', 'Hagumi 001',
  'Hina 001', 'Kanon 001', 'Kasumi 001', 'Kokoro 001', 'Masuki 001',
  'Nanami 001', 'Rokka 001', 'Saaya 001', 'Touko 001', 'Tsukushi 001',
]);
const TRICK_CARD_SET = new Set(TRICK_CARD_NAMES);
const X_CHANCE = 0.0003; // 0.03% of BOO collectible rolls (not of all pulls)
const TRICK_CHANCE = 0.25; // 25% of all BOO collectible rolls
const TAROT_BOO_CARDS = Object.freeze(CARDS.map(card => card.cardName));
const NORMAL_BOO_CARDS = Object.freeze([
  ...TAROT_BOO_CARDS,
  ...TRICK_CARD_NAMES,
]);
function isTrickBoo(name) {
  return TRICK_CARD_SET.has(String(name || '').trim());
}
function booFileName(name) {
  const cardName = String(name || '').trim();
  return `${cardName}${isTrickBoo(cardName) ? '.png' : '.jpg'}`;
}
function collectible(rng = Math.random) {
  const roll = rng();
  if (roll < X_CHANCE) {
    return { rarity: 'BOO', name: 'Halloween X', fileName: 'Halloween X.jpg', trick: false };
  }
  // Choose the category first so adding/removing guest cards cannot change the
  // 25% TRICK chance; cards within each category are equally likely.
  const pool = roll < X_CHANCE + TRICK_CHANCE ? TRICK_CARD_NAMES : TAROT_BOO_CARDS;
  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  const name = pool[index];
  return { rarity: 'BOO', name, fileName: booFileName(name), trick: isTrickBoo(name) };
}
module.exports = { CARDS, lookup, weighted, collectible, TRICK_CARD_NAMES, NORMAL_BOO_CARDS,
  X_CHANCE, TRICK_CHANCE, isTrickBoo, booFileName };

