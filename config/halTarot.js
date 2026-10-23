'use strict';
const CARDS = [
[0,'Roboco','The Fool',0.5],[1,'Shion','The Magician',1.75],[2,'Fubuki','The High Priestess',8],[3,'Marine','The Empress',8],[4,'Korone','The Emperor',8],[5,'Mio','The Hierophant',4],[6,'Matsuri','The Lovers',5.5],[7,'Botan','The Chariot',4],[8,'Kanata','Strength',4],[9,'Chloe','The Hermit',5.5],[10,'Pekora','Wheel of Fortune',4],[11,'Noel','Justice',4],[12,'Okayu','The Hanged Man',4],[13,'Calli','Death',0.5],[14,'Iroha','Temperance',8],[15,'Towa','The Devil',8],[16,'Miko','The Tower',4],[17,'Suisei','The Star',1.75],[18,'Luna','The Moon',4],[19,'Subaru','The Sun',8],[20,'Lui','Judgement',4],[21,'Sora','The World',0.5]
].map(([number,member,name,weight])=>Object.freeze({number,member,name,weight,cardName:`${member} 001`}));
function lookup(value){const q=String(value??'').trim().toLowerCase();return CARDS.find(x=>String(x.number)===q||x.name.toLowerCase()===q||x.name.replace(/^the /i,'').toLowerCase()===q)||null;}
function weighted(rng=Math.random){let v=rng()*100;for(const c of CARDS){v-=c.weight;if(v<0)return c;}return CARDS[CARDS.length-1];}
function collectible(rng=Math.random){if(rng()<0.0003)return {rarity:'BOO',name:'Halloween X'};const card=CARDS[Math.floor(rng()*CARDS.length)];return {rarity:'BOO',name:card.cardName};}
module.exports={CARDS,lookup,weighted,collectible};
