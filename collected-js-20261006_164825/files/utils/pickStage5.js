// utils/pickStage5.js
const pools = require('./loadImages'); // returns { P: [...], SP: [...], ... }
const path = require('path');

function normalizeCardName(name) {
  if (!name) return '';
  return String(name).trim().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').normalize('NFC');
}

function pickRandomStage5CardFromPools() {
  const pool = pools['SP'] || pools['SEC'] || pools['Budokan'] || null;
  if (!pool || !Array.isArray(pool) || pool.length === 0) return null;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  const base = path.basename(chosen, path.extname(chosen));
  const displayName = normalizeCardName(base);
  return { file: chosen, displayName };
}

module.exports = pickRandomStage5CardFromPools;
