// utils/bossUtils.js
const IMAGE_BASE = 'http://152.69.195.48/images';

function buildOshiOsrImageUrl(oshiLabel, rarity = 'OSR') {
  const baseName = typeof oshiLabel === 'string' ? oshiLabel.trim() : String(oshiLabel);
  const cardName = `${baseName} 001`;
  const encodedCardName = encodeURIComponent(cardName);
  const rarityPart = encodeURIComponent(String(rarity).trim());
  return `${IMAGE_BASE.replace(/\/$/, '')}/${rarityPart}/${encodedCardName}.png`;
}

// small debug to confirm module loads (remove if you prefer quiet logs)
console.log('[bossUtils] loaded, buildOshiOsrImageUrl available:', typeof buildOshiOsrImageUrl);

module.exports = { buildOshiOsrImageUrl };
