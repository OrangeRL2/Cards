const pools = require('../utils/loadImages');
const rates = { C: 0.70, R: 0.25, UR: 0.05 };

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