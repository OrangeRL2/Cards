// utils/rates.js
function rand() {
  return Math.random();
}

/**
 * Original picker (unchanged) — returns key only.
 */
function pickWeighted(options) {
  const total = options.reduce((s, o) => s + (o.weight || 0), 0);
  let r = rand() * total;
  for (const o of options) {
    if (r <= o.weight) return o.key;
    r -= o.weight;
  }
  return options[options.length - 1].key;
}

/**
 * New: weighted pick with debug roll info.
 * - If integer=true and total is an integer, rolls uniformly as an integer in [1..total].
 * - Returns: { key, roll, total }
 */
// New: weighted pick WITH roll info (for debugging / 100k integer rolls)
function pickWeightedWithRoll(options, { integer = false } = {}) {
  const total = options.reduce((s, o) => s + (o.weight || 0), 0);
  if (total <= 0) return { key: null, roll: null, total: 0 };

  // Integer roll mode: roll in [1..total]
  if (integer && Number.isInteger(total)) {
    const roll = Math.floor(Math.random() * total) + 1;
    let acc = 0;
    for (const o of options) {
      acc += (o.weight || 0);
      if (roll <= acc) return { key: o.key, roll, total };
    }
    return { key: options[options.length - 1].key, roll, total };
  }

  // Float fallback (still gives debug value, just not an integer)
  let r = Math.random() * total;
  const roll = r;
  for (const o of options) {
    if (r <= o.weight) return { key: o.key, roll, total };
    r -= o.weight;
  }
  return { key: options[options.length - 1].key, roll, total };
}

/**
 * Scale a slot odds table:
 * - Base rarity = FIRST entry's key
 * - All other weights multiplied by rate
 * - Base becomes (100 - sum(non-base))
 * - rate <= 0 => hard lock to base rarity
 */
function scaleSlotOdds(baseOptions, rate) {
  if (!Array.isArray(baseOptions) || baseOptions.length === 0) return baseOptions;
  const baseKey = baseOptions[0].key;
  if (rate <= 0) return [{ key: baseKey, weight: 100 }];

  let nonBaseSum = 0;
  const scaledNonBase = [];
  for (const opt of baseOptions) {
    if (!opt || typeof opt.weight !== 'number') continue;
    if (opt.key === baseKey) continue;
    const w = opt.weight * rate;
    nonBaseSum += w;
    scaledNonBase.push({ key: opt.key, weight: w });
  }
  const baseWeight = Math.max(0, 100 - nonBaseSum);
  return [{ key: baseKey, weight: baseWeight }, ...scaledNonBase];
}

/**
 * Apply absolute overrides AFTER scaling:
 * - overrides example: { SEC: 0.01, OUR: 0.50 }
 * - Base rarity absorbs leftover/deficit so total is 100
 * - If overrides push non-base > 100, base clamps to 0 and logs a warning
 */
function applyAbsoluteOverrides(slotOptions, overrides = {}, { warn = true } = {}) {
  if (!Array.isArray(slotOptions) || slotOptions.length === 0) return slotOptions;
  if (!overrides || typeof overrides !== 'object') return slotOptions;

  const baseKey = String(slotOptions[0].key);
  const byKey = new Map(slotOptions.map((o) => [String(o.key), { key: o.key, weight: o.weight }]));

  for (const [k, v] of Object.entries(overrides)) {
    const key = String(k);
    const w = Number(v);
    if (!Number.isFinite(w) || w < 0) continue;
    if (byKey.has(key)) byKey.get(key).weight = w;
    else byKey.set(key, { key, weight: w });
  }

  let nonBaseSum = 0;
  for (const [k, obj] of byKey.entries()) {
    if (k === baseKey) continue;
    nonBaseSum += Number(obj.weight) || 0;
  }

  const newBase = 100 - nonBaseSum;
  if (newBase < 0) {
    if (warn) {
      console.warn('[applyAbsoluteOverrides] overrides exceed 100%. Clamping base to 0.', {
        baseKey,
        nonBaseSum,
        overrides,
      });
    }
    byKey.get(baseKey).weight = 0;
  } else {
    byKey.get(baseKey).weight = newBase;
  }

  // preserve stable ordering: base first, then original keys, then any new keys
  const originalOrder = slotOptions.map((o) => String(o.key));
  const out = [];
  const seen = new Set();

  out.push(byKey.get(baseKey));
  seen.add(baseKey);

  for (const k of originalOrder) {
    if (seen.has(k)) continue;
    if (byKey.has(k)) {
      out.push(byKey.get(k));
      seen.add(k);
    }
  }

  for (const [k, obj] of byKey.entries()) {
    if (seen.has(k)) continue;
    out.push(obj);
  }

  return out;
}

function buildSlotOptions(baseOptions, rate, overridesForSlot) {
  const scaled = scaleSlotOdds(baseOptions, rate);
  return applyAbsoluteOverrides(scaled, overridesForSlot);
}

// (profiles unchanged)
const rateProfiles = (() => {
  const m = new Map();
  // ... (UNCHANGED CONTENT BELOW, keep your existing)
  // NOTE: I’m preserving your file’s existing profile content as-is.
  // ---- PASTE YOUR EXISTING rateProfiles SECTION HERE IF YOU EDIT BY HAND ----

  // 33% pull rate + 0% extraSlot + 0% special pulls
  m.set('1334914199968677941', {
    pullRate: 0.33,
    extraSlotRate: 0.0,
    specialPullRate: 0.0,
    overrides: { normal: {}, special: {}, boss: {} },
  });

  [
    '1188023588926795827',
    '1300468334474690583',
    '1416081468794339479',
  ].forEach((id) => {
    m.set(String(id), {
      pullRate: 0.33,
      extraSlotRate: 0.0,
      specialPullRate: 0.0,
      overrides: { normal: {}, special: {}, boss: {} },
    });
  });

  [
    '953552994232852490',
    '91103688415776768',
    '647219814011502607',
    '875533483051712543',
  ].forEach((id) => {
    m.set(String(id), {
      pullRate: 0.50,
      extraSlotRate: 0.0,
      specialPullRate: 0.0,
      overrides: { normal: {}, special: {}, boss: {} },
    });
  });

  m.set('1171127294413246567', {
    pullRate: 0.66,
    extraSlotRate: 1.0,
    specialPullRate: 0.50,
    overrides: { normal: {}, special: {}, boss: {} },
  });

  [
    '578146378501324812',
    '975246037914624030',
  ].forEach((id) => {
    m.set(String(id), {
      pullRate: 0.66,
      extraSlotRate: 1.0,
      specialPullRate: 0.50,
      overrides: { normal: {}, special: {}, boss: {} },
    });
  });

  m.set('443061305721618432', {
    pullRate: 1.0,
    extraSlotRate: 1.0,
    specialPullRate: 1.1,
    overrides: {
      normal: {
        common1: { S: 7.5, HR: 0.5, BDAY: 0.5 },
        common2: { S: 7.5, OC: 4.0 },
        common3: { S: 7.5, BDAY: 0.5 },
        common4: { S: 7.5, HR: 0.5 },
        uncommon1: { RR: 15.0, UR: 0.5 },
        uncommon2: { SR: 7.5, SY: 0.5 },
        uncommon3: { OSR: 6.0, UR: 1.0 },
        rare: { OUR: 0.9, SEC: 0.1 },
      },
      special: {},
      boss: {
        common1: { S: 7.5, HR: 0.5, BDAY: 0.5 },
        common2: { S: 7.5, OC: 4.0 },
        common3: { S: 7.5, BDAY: 0.5 },
        common4: { S: 7.5, HR: 0.5 },
        uncommon1: { RR: 15.0, UR: 0.5 },
        uncommon2: { SR: 7.5, SY: 0.5 },
        uncommon3: { OSR: 6.0, UR: 1.0 },
        rare: { OUR: 0.9, SEC: 0.1 },
      },
    },
  });

  return m;
})();

function getUserProfile(userId) {
  const idStr = String(userId);
  return (
    rateProfiles.get(idStr) || {
      pullRate: 1.0,
      extraSlotRate: 1.0,
      specialPullRate: 1.0,
      overrides: { normal: {}, special: {}, boss: {} },
    }
  );
}

function getOverrides(profile, mode, slotName) {
  return profile?.overrides?.[mode]?.[slotName] || null;
}

module.exports = {
  pickWeighted,
  pickWeightedWithRoll, // ✅ NEW
  scaleSlotOdds,
  applyAbsoluteOverrides,
  buildSlotOptions,
  rateProfiles,
  getUserProfile,
  getOverrides,
};