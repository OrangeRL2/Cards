#!/usr/bin/env node
/**
 * tools/scan-exceptions-zero-matches.js
 *
 * Reports:
 *  - For each rarity folder: which oshis had zero matches in that folder.
 *  - Overall: which oshis had zero matches across all scanned rarities.
 *
 * Behavior change: a file that matches the primary oshi token (word-boundary or substring)
 * counts as a hit for that oshi in that folder, in addition to exception-token matches.
 *
 * Usage:
 *   node tools/scan-exceptions-zero-matches.js
 *
 * Optional env:
 *   ASSETS_BASE  - base assets folder (defaults to ./assets/images)
 *   RARITIES     - comma-separated rarities to scan (defaults to built-in RARITY_ORDER)
 */

const fs = require('fs').promises;
const path = require('path');

// --- Inline EXCEPTIONS (self-contained) ---
const EXCEPTIONS = {
  Rushia: ['Pekora', 'Marine', 'Flare', 'Noel', 'Fantasy'],
  Mel: ['Fubuki', 'Matsuri', 'Haato', 'Aki', 'Gen 1'],
  Aqua: ['Ayame', 'Choco', 'Subaru', 'Shion', 'Gen 2'],
  Shion: ['Ayame', 'Choco', 'Subaru', 'Aqua', 'Gen 2'],
  Coco: ['Watame', 'Towa', 'Kanata', 'Luna', 'holoForce'],
  Kanata: ['Watame', 'Towa', 'Luna', 'Coco', 'holoForce'],
  Aloe: ['Lamy', 'Nene', 'Botan', 'Polka', 'NePoLaBo'],
  Amelia: ['Calli', 'Kiara', 'Ina', 'Gura', 'Myth'],
  Gura: ['Calli', 'Kiara', 'Ina', 'Amelia', 'Myth'],
  Sana: ['Kronii', 'Baelz', 'Fauna', 'Mumei'],
  Mumei: ['Kronii', 'Baelz', 'IRyS', 'Fauna', 'Promise'],
  Fauna: ['IRyS', 'Kronii', 'Baelz', 'Mumei', 'Promise'],
  Ao: ['Kanade', 'Ririka', 'Raden', 'Hajime', 'ReGLOSS'],
};

// --- Defaults / config ---
const DEFAULT_RARITY_ORDER = [
  'C', 'U', 'R', 'S', 'RR', 'OC', 'SR', 'OSR', 'SY', 'UR', 'OUR', 'HR', 'BDAY', 'SEC', 'ORI'
];

const ASSETS_BASE_BY_RARITY = {
  BDAY: path.join(__dirname, '..', 'assets', 'montlybdays')
};

const DEFAULT_ASSETS_BASE = process.env.ASSETS_BASE || path.join(__dirname, '..', 'assets', 'images');

function getAssetsBaseForRarity(rarity) {
  if (!rarity) return DEFAULT_ASSETS_BASE;
  const key = String(rarity).trim().toUpperCase();
  if (ASSETS_BASE_BY_RARITY && ASSETS_BASE_BY_RARITY[key]) return ASSETS_BASE_BY_RARITY[key];
  return DEFAULT_ASSETS_BASE;
}

// --- Normalization / matching helpers (same semantics as picker) ---
function normalizeToken(s) {
  return String(s || '').toLowerCase().replace(/[^\w\s]/g, '').trim();
}
function normalizeFilenameForMatch(filename) {
  const base = path.basename(filename, path.extname(filename));
  return normalizeToken(base);
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getExceptionListForOshi(oshi) {
  if (!oshi) return [];
  const norm = normalizeToken(oshi);
  const candidates = [
    EXCEPTIONS[norm],
    EXCEPTIONS[oshi],
    EXCEPTIONS[capitalize(oshi)]
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c.map(e => String(e || '').trim()).filter(Boolean);
  }
  return [];
}

// Matching logic: prefix '*' => startsWith, else word-boundary or substring
function matchesTokenOnNormalizedName(normName, exTokenRaw) {
  if (!exTokenRaw) return false;
  const isPrefix = typeof exTokenRaw === 'string' && exTokenRaw.endsWith('*');
  const exToken = isPrefix
    ? normalizeToken(exTokenRaw.slice(0, -1))
    : normalizeToken(exTokenRaw);

  if (!exToken) return false;

  if (isPrefix) {
    return normName.startsWith(exToken);
  }

  // exact token (word boundary)
  const re = new RegExp(`\\b${escapeRegExp(exToken)}\\b`);
  if (re.test(normName)) return true;

  // substring fallback
  return normName.includes(exToken);
}

// --- Rarities to scan (env override allowed) ---
const RARITY_ORDER = process.env.RARITIES
  ? process.env.RARITIES.split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_RARITY_ORDER;

// --- Main scan ---
(async function main() {
  const oshis = Object.keys(EXCEPTIONS || {});
  if (!oshis.length) {
    console.log('No exceptions configured in the script. Exiting.');
    process.exit(0);
  }

  // Track per-rarity which oshis had zero matches
  const perRarityZero = {}; // rarity -> Set(oshi)
  // Track overall matches per oshi across all rarities
  const overallMatches = {}; // oshi -> totalMatchesCount
  for (const o of oshis) overallMatches[o] = 0;

  console.log('Scanning rarities:', RARITY_ORDER.join(', '), '\n');

  for (const rarity of RARITY_ORDER) {
    const base = getAssetsBaseForRarity(rarity);
    const folder = path.join(base, String(rarity).toUpperCase());
    let files = [];
    try {
      files = await fs.readdir(folder);
    } catch (err) {
      console.warn(`rarity=${rarity} folder missing or unreadable: ${folder}`);
      // treat missing folder as "no matches for all oshis" for clarity
      perRarityZero[rarity] = new Set(oshis);
      continue;
    }

    const candidates = files.map(f => ({ raw: f, norm: normalizeFilenameForMatch(f) }));

    // For this rarity, collect oshis that had zero matches
    const zeroSet = new Set();

    for (const oshiKey of oshis) {
      const exList = getExceptionListForOshi(oshiKey);

      // First: check primary oshi token itself as a potential match.
      // Primary token normalized:
      const primaryToken = normalizeToken(oshiKey);
      let anyMatchInThisRarity = false;

      if (primaryToken) {
        // exact token (word boundary) or substring counts as a hit
        const rePrimary = new RegExp(`\\b${escapeRegExp(primaryToken)}\\b`);
        for (const c of candidates) {
          if (rePrimary.test(c.norm) || c.norm.includes(primaryToken)) {
            anyMatchInThisRarity = true;
            overallMatches[oshiKey] += 1;
          }
        }
      }

      // Then: check exceptions (if any)
      if (!anyMatchInThisRarity && exList.length) {
        for (const exRaw of exList) {
          const matches = candidates.filter(c => matchesTokenOnNormalizedName(c.norm, exRaw));
          if (matches.length > 0) {
            anyMatchInThisRarity = true;
            overallMatches[oshiKey] += matches.length;
          }
        }
      }

      // If there were no exceptions configured at all, and primary token didn't match,
      // treat as zero match for this rarity.
      if (!anyMatchInThisRarity) zeroSet.add(oshiKey);
    }

    perRarityZero[rarity] = zeroSet;

    // Print per-rarity summary
    if (zeroSet.size === 0) {
      console.log(`rarity=${rarity}: all oshis had at least one match (including primary token matches)`);
    } else {
      console.log(`rarity=${rarity}: ${zeroSet.size} oshi(s) with NO matches:`);
      for (const o of Array.from(zeroSet).sort()) {
        console.log(`  - ${o}`);
      }
    }
    console.log('');
  }

  // Overall: oshis with zero matches across all rarities
  const oshisZeroOverall = Object.entries(overallMatches)
    .filter(([oshi, count]) => count === 0)
    .map(([oshi]) => oshi);

  console.log('--- Overall summary ---');
  if (oshisZeroOverall.length === 0) {
    console.log('Every oshi had at least one match (primary token or exceptions) in some rarity folder.');
  } else {
    console.log('Oshis with ZERO matches across all scanned rarities:');
    for (const o of oshisZeroOverall.sort()) {
      const raritiesWithZero = RARITY_ORDER.filter(r => perRarityZero[r] && perRarityZero[r].has(o));
      console.log(`  - ${o}  (zero in rarities: ${raritiesWithZero.join(', ')})`);
    }
  }

  // Exit code: 0 if all oshis had at least one match somewhere, 2 otherwise
  process.exitCode = oshisZeroOverall.length === 0 ? 0 : 2;
})().catch(err => {
  console.error('Fatal error during scan:', err);
  process.exit(1);
});
