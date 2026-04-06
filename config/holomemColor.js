// utils/holomemColor.js
// Attribute-color mapping for Holomem cards (rarity-aware exceptions).
//
// - DEFAULT_MEMBER_COLOR: default attribute per member (no numeric suffix).
// - EXCEPTION_CARD_COLOR: per-card overrides, with optional rarity specificity.
//
// Exceptions supported:
//   A) 'Name::RARITY': 'attribute'
//      { 'SorAZ 001::P': 'support' }
//   B) 'Name': { RARITY: 'attribute' }
//      { 'SorAZ 001': { P: 'support', EAS: 'blue' } }
//   C) 'Name': 'attribute' (applies to all rarities)
//
// Returned values are normalized to lowercase and validated against ALLOWED_COLORS.

const ALLOWED_COLORS = new Set([
  'white', 'green', 'red', 'blue', 'purple', 'yellow',
  'support', 'typo', 'mixed',
  // 'none' is a special value you can explicitly set, and also used as a filter for unmapped.
  'none',
]);

// Emoji mentions for attributes (Application emojis)
// Format: <:name:id>  (use <a:name:id> if animated)
const ATTRIBUTE_EMOJIS2 = {
  white:  '<:white:1490582793678229607>',
  yellow: '<:yellow:1490582791895650456>',
  green:  '<:green:1490582789425336320>',
  blue:   '<:blue:1490582787407740949>',
  red:    '<:red:1490582785692274742>',
  purple: '<:purple:1490582784169738392>',

  // Fallback category emoji
  others: '<:others:1490582781732847797>',

  // Non-color attributes
  support: '<:others:1490582781732847797>',
  typo:    '<:typo:1490616602037583933>',
  mixed:   '<:white:1490582793678229607>,<:yellow:1490582791895650456>,<:green:1490582789425336320>,<:blue:1490582787407740949>,<:red:1490582785692274742>,<:purple:1490582784169738392>',

  // none = intentionally show nothing
  none: '',
};

const ATTRIBUTE_EMOJIS = {
  white:  '<:white:1490610704674324520>',
  yellow: '<:yellow:1490610703143538698>',
  green:  '<:green:1490610701515882569>',
  blue:   '<:blue:1490610699859267664>',
  red:    '<:red:1490610698135273492>',
  purple: '<:purple:1490610695803240541>',

  // Fallback category emoji
  others: '<:others:1490610693530058782>',

  // Non-color attributes
  support: '<:others:1490582781732847797>',
  typo:    '<:typo:1490617070184955984>',
  mixed:   '<:white:1490610704674324520>,<:yellow:1490610703143538698>,<:green:1490610701515882569>,<:blue:1490610699859267664>,<:red:1490610698135273492>,<:purple:1490610695803240541>',

  // none = intentionally show nothing
  none: '',
};

function getAttributeEmoji(attr) {
  const key = String(attr ?? '').trim().toLowerCase();
  return ATTRIBUTE_EMOJIS[key] ?? '';
}

// Default attribute by member (no numeric suffix).
const DEFAULT_MEMBER_COLOR = {
    'Miko': 'red',
    'Suisei': 'blue',
    'Sora': 'white',
    'Roboco': 'purple',
    'ROBOCO': 'purple',
    'AZKi': 'green',
    'Azki': 'green',
// Gen1
    'Aki': 'green',
    'Matsuri': 'yellow',
    'Haato': 'red',
    'Fubuki': 'white',
    'Mel': 'yellow',
// Gen2

    'Choco': 'purple',
    'Subaru': 'yellow',
    'Aqua': 'blue',
    'Shion': 'purple',
    'Ayame': 'red',
//Gamers
    'Okayu': 'blue',
    'Mio': 'green',
    'Korone': 'yellow',
//Gen3
    'Pekora': 'green',
    'Marine': 'red',
    'Rushia': 'green',
    'Flare': 'yellow',
    'Noel': 'white',
//Gen4
    'Kanata': 'white',
    'Watame': 'yellow',
    'Towa': 'purple',
    'Luna': 'white',
    'Coco': 'yellow',
//NePoLaBo
    'Nene': 'yellow',
    'Polka': 'red',
    'Botan': 'green',
    'Lamy': 'blue',
    'Aloe': 'purple',
//HoloX
    'Koyori': 'white',
    'Chloe': 'blue',
    'La+': 'purple',
    'Lui': 'red',
    'Iroha': 'green',
//ReGLOSS
    'Raden': 'green',
    'Ao': 'blue',
    'Ririka': 'red',
    'Kanade': 'yellow',
    'Hajime': 'white',

//FLOW GLOW
    'Riona': 'white',
    'Su': 'blue',
    'Chihaya': 'green',
    'Niko': 'yellow',
    'Vivi': 'purple',

//ID Gen1
    'Risu': 'yellow',
    'Moona': 'blue',
    'Iofi': 'green',

//ID Gen2
    'Anya': 'yellow',
    'Reine': 'green',
    'Ollie': 'purple',

//ID Gen3
    'Kaela': 'red',
    'Zeta': 'white',
    'Kobo': 'blue',

//Myth
    'Amelia': 'yellow',
    'Calli': 'purple',
    'Ina': 'purple',
    'Gura': 'blue',
    'Kiara': 'red',

//Council
    'Baelz': 'red',
    'IRyS': 'white',
    'IRys': 'white',
    'Irys': 'white',
    'Kronii': 'blue',
    'Fauna': 'green',
    'Sana': 'purple',
    'Mumei': 'white',

//Advent
    'Fuwawa': 'blue',
    'Mococo': 'red',
    'Bijou': 'purple',
    'Shiori': 'blue',
    'Nerissa': 'purple',

//Justice
    'Elizabeth': 'red',
    'Raora': 'white',
    'Gigi': 'yellow',
    'Cecilia': 'green',

//Staff
    'Achan': 'blue',
    'Nodoka': 'white',

//Eggs
    'Easter X': 'green',
    'Easter Y': 'blue',
    'Easter O': 'blue',
    'Blue Egg': 'blue',
    'Green Egg': 'green',
    'Red Egg': 'red',
    'Yellow Egg': 'yellow',
    'Purple Egg': 'purple',
    'White Egg': 'white',

    'Support': 'support',
    'Mikkorone': 'support',
    'SorAZ': 'support',
    'holoX': 'support',
    'AyaFubuMi': 'support',
    'Fantasy': 'support',
    'FANTASY': 'support',
    'FLOW GLOW': 'support',
    'holoForce': 'support',
    'holoX': 'support',
    'Promise': 'support',
    'ReGLOSS': 'support',
    'Shiranui Construction': 'support',
    'ReGLOSS': 'support',
    'Advent': 'support',
    'AREA 15': 'support',
    'Bakatare Circus': 'support',
    'GAMERS': 'support',
    'Gen 0': 'support',
    'Gen 1': 'support',
    'Gen 2': 'support',
    'Gen 3': 'support',
    'Gen 4': 'support',
    'holoh3ro': 'support',
    'holoro': 'support',
    'Kanata Construction': 'support',
    'Lamy, Noel, Lui, Aki': 'support',
    'NePoLaBo': 'support',
    'Nerissa & Elizabeth': 'support',
    'Pekora & Moona': 'support',
    'Sora & Iroha': 'support',
    'Towa & La+': 'support',
    'Choco, Luna, Subaru': 'purple',
    'Dorobo Construction': 'support',
    'Justice': 'support',
    'Raora & Bijou': 'support',
    'Calli, IRyS, Nerissa , Ollie, Nene': 'white',
    'Holowitches': 'white',
    'SubaLuna': 'white',
//Duos
    'FUWAMOCO': 'blue',
    'OkaKoro': 'yellow',
    'Flare & Hajime': 'yellow',
    'Lamy & Nene': 'blue',
    'Matsuri & Marine': 'red',
    'Ina & Ririka': 'red',

    //mixxx
    'miComet': 'Mixed',
    'MariFure': 'Mixed',
    'Noel & Pekora': 'Mixed',
    'Noel, Pekora, Marine, Flare': 'Mixed',
    'Pekora, Marine, Flare': 'Mixed',
    'PekoMari': 'Mixed',
    

    'Force': 'typo',
    'Gen0': 'typo',
    'Gen2': 'typo',
    'holoforce': 'typo',

    //cheers
    'Cheer Blue': 'blue',
    'Cheer Green': 'green',
    'Cheer Red': 'red',
    'Cheer Purple': 'purple',
    'Cheer Yellow': 'yellow',
    'Cheer White': 'white',

    //padoru
    'Padoru Chloe': 'blue',
    'Padoru Flare': 'yellow',
    'Padoru Kanata': 'white',
    'Padoru Lamy': 'blue',
    'Padoru Moona': 'blue',
    'Padoru Subaru': 'yellow',
    'Padoru Suisei': 'blue',
    'Padoru Towa': 'purple',
    'Padoru Zeta': 'yellow',
    'Padoru Mumei': 'white',
    
};

// Card-specific overrides.
const EXCEPTION_CARD_COLOR = {
  // Examples:
  'FUWAMOCO 001': 'blue',
    'Flare & Hajime 001': 'yellow',
    'Lamy & Nene 001': 'blue',
    'Matsuri & Marine 001': 'red',
    'Ina & Ririka 001': 'red',
    'Ollie & Baelz 001': 'purple',
    'Pekora & Riona 001': 'white',
    'Subaru & Watame 001': 'yellow',
    'Suisei & Iroha 001': 'green',
    'Aqua & Aya 101': 'blue',
    'Botan & Tomori 101': 'green',
    'Botan & Tomori 001': 'green',
    'Chloe & Yukina 101': 'blue',
    'Fubuki & Kokoro 101': 'white',
    'Lamy & Mashiro 101': 'blue',
    'Marine & Ran 101': 'red',
    'Sora & Kasumi 101': 'white',
    'Suisei & LAYER 101': 'blue',
    'Watame & Subaru 001': 'yellow',
    'Watame & Subaru 002': 'yellow',
    'Pekora, Subaru, Calli, Kobo 001': 'blue',

    'La+ & AZKi 001': 'support',
    'Lamy, Noel, Lui, Aki': 'support',
    'Nerissa & Elizabeth 001': 'support',
    'Dorobo Construction 501': 'support',
    'Choco, Luna, Subaru 002': 'support',
    'holoForce 001::S': 'support',
    'holoForce 001::U': 'support',
    'holoForce 001::P': 'support',

    'MiKorone 001': 'typo',
    'Ayama 001': 'typo',
    'Area 15 001': 'typo',
    'GEN 0 001': 'typo',
    'Regloss 001': 'typo',
    'holoforce 001': 'typo',
    'Okakoro 001': 'typo',
    'Sora & Iofi 001': 'typo',
    'Sora & Iofi 501': 'typo',
    'Force 001': 'typo',
    'Dorobo Contsruction 501': 'typo',

    'PekoMari 001::P': 'mixed',
    'SorAZ 001::P': 'mixed',
    'SorAZ 501::P': 'mixed',
    'SorAZ 001::R': 'mixed',
    'SorAZ 501::R': 'mixed',
    'FUWAMOCO 001::SR': 'mixed',
    'FUWAMOCO 501::SR': 'mixed',
    'FUWAMOCO 001::S': 'support',
    'FUWAMOCO 501::S': 'support',
    'FUWAMOCO 002::S': 'support',
    'FUWAMOCO 502::S': 'support',
    'FUWAMOCO 001::R': 'mixed',
    'FUWAMOCO 501::R': 'mixed',
    'FUWAMOCO 001::C': 'support',
    'FUWAMOCO 501::C': 'support',

    'FUWAMOCO 002::C': 'support',
    'FUWAMOCO 502::C': 'support',
    'FUWAMOCO 501::C': 'support',

    'Watame 002::OSR': 'white',
};

function normKey(s) {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function extractMember(cardName) {
  const name = String(cardName ?? '').trim().replace(/\s+/g, ' ');
  if (/\s\d+$/.test(name)) {
    return name.replace(/\s\d+$/, '').trim();
  }
  return name;
}

function normalizeAttr(attr) {
  const a = normKey(attr);
  if (!a) return null;
  return ALLOWED_COLORS.has(a) ? a : null;
}

function getExceptionAttr(cardName, rarity) {
  const nName = normKey(cardName);
  const nR = normKey(rarity);

  // A) direct key "name::rarity"
  const direct = EXCEPTION_CARD_COLOR[`${nName}::${nR}`] ?? EXCEPTION_CARD_COLOR[`${cardName}::${rarity}`];
  if (typeof direct === 'string') return normalizeAttr(direct);
  if (direct && typeof direct === 'object') {
    const v = direct[nR] ?? direct[rarity];
    if (typeof v === 'string') return normalizeAttr(v);
  }

  // B/C) name-only key
  const byName = EXCEPTION_CARD_COLOR[nName] ?? EXCEPTION_CARD_COLOR[cardName];
  if (typeof byName === 'string') return normalizeAttr(byName);
  if (byName && typeof byName === 'object') {
    const v = byName[nR] ?? byName[rarity];
    if (typeof v === 'string') return normalizeAttr(v);
  }

  return null;
}

function resolveCardColor(cardName, rarity) {
  const exc = getExceptionAttr(cardName, rarity);
  if (exc) return exc;

  const member = extractMember(cardName);
  const memberKey = normKey(member);
  const def = DEFAULT_MEMBER_COLOR[memberKey] ?? DEFAULT_MEMBER_COLOR[member];
  const d = normalizeAttr(def);
  if (d) return d;

  return null;
}

module.exports = {
  ALLOWED_COLORS,
  DEFAULT_MEMBER_COLOR,
  EXCEPTION_CARD_COLOR,
  resolveCardColor,
  extractMember,
 ATTRIBUTE_EMOJIS,
 getAttributeEmoji,
};
