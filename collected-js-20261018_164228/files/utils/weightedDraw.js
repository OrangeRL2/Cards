const pools = require('../utils/loadImages');
const rates = { C: 0.10, OC: 0.10, U:0.10, R: 0.10, RR: 0.10,SR: 0.10, OSR: 0.10, UR: 0.10, OUR: 0.10, SEC: 0.10,   };

function weightedDraw() {
  const roll = Math.random();
  let cumulative = 0;

  for (const [rarity, rate] of Object.entries(rates)) {
    cumulative += rate;
    if (roll <= cumulative) {
      const choices = pools[rarity];
      const file = choices[Math.floor(Math.random() * choices.length)];
      return { rarity, file };
    }
  }
}
module.exports = weightedDraw;