// utils/cardPicker.js
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const ASSETS_BASE = process.env.ASSETS_BASE || process.env.IMAGE_BASE || 'assets/images'; // set to your assets root
const lastPickedByRarity = new Map(); // in-memory anti-repeat

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeFilenameForMatch(filename) {
  return filename
    .replace(/\.(png|jpg|jpeg)$/i, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\b0*(\d{1,3})\b/g, '') // remove standalone numeric codes like 001/501
    .trim()
    .toLowerCase();
}

/**
 * EXCEPTIONS map:
 * - keys are normalized primary labels (lowercase)
 * - values are arrays of alternative names or prefixes to allow when searching
 *
 * Example:
 *   // when searching for "chloe" also allow files that contain "Ruka"
 *   'chloe': ['Ruka'],
 *
 * Prefix entries: add a trailing '*' to indicate prefix matching (case-insensitive)
 *   'chloe': ['Ruka*']  // matches "Ruka 001", "Rukami", etc.
 */
const EXCEPTIONS = {
  'Pekora': ['Fantasy'],
};

/**
 * Build candidate tokens from primary label and exceptions.
 * Returns array of objects: { raw: originalExceptionString, norm: normalizedToken, isPrefix: boolean }
 */
function buildCandidates(label) {
  if (!label) return [];
  const primaryRaw = String(label).trim();
  const primaryNorm = primaryRaw.replace(/[^\w\s]/g, '').trim().toLowerCase();
  const candidates = [];
  if (primaryNorm) candidates.push({ raw: primaryRaw, norm: primaryNorm, isPrefix: false });

  const ex = EXCEPTIONS[primaryNorm];
  if (Array.isArray(ex)) {
    for (const e of ex) {
      if (!e) continue;
      const isPrefix = String(e).endsWith('*');
      const raw = isPrefix ? String(e).slice(0, -1) : String(e);
      const norm = raw.replace(/[^\w\s]/g, '').trim().toLowerCase();
      if (norm) candidates.push({ raw: String(e), norm, isPrefix });
    }
  }

  return candidates;
}

/**
 * Pick a card file from a rarity folder, preferring files that match the oshi label.
 * Returns the card name without extension (e.g., "Suisei 501") or null if none found.
 *
 * Behavior:
 * - When a label has exceptions, pick one candidate (primary or one exception) uniformly at random.
 * - If the chosen candidate yields no matches and it is an exception (not the primary),
 *   attempt the primary label once before falling back to neutral behavior.
 * - This preserves even chance among candidates while ensuring exceptions that don't exist
 *   fall back to the original primary search.
 */
async function pickCardFromRarityFolder(rarity, oshiLabel, { avoidImmediateRepeat = true } = {}) {
  try {
    const folder = path.join(ASSETS_BASE, String(rarity).toUpperCase());
    const files = await fs.readdir(folder).catch(() => []);
    if (!files || files.length === 0) {
      console.debug(`[pickCard] no files in folder ${folder}`);
      return null;
    }

    const candidatesList = files.map(f => ({ raw: f, norm: normalizeFilenameForMatch(f) }));

    // If no label provided, behave neutrally (random pick with anti-repeat)
    if (!oshiLabel) {
      return neutralPick(candidatesList, rarity, oshiLabel, avoidImmediateRepeat);
    }

    // Build candidate tokens: primary + exceptions
    const candidates = buildCandidates(oshiLabel);
    if (!candidates || candidates.length === 0) {
      // nothing to prefer, fallback to neutral
      return neutralPick(candidatesList, rarity, oshiLabel, avoidImmediateRepeat);
    }

    // Choose one candidate uniformly at random (primary and each exception have equal chance)
    const chosenIndex = crypto.randomInt(0, candidates.length);
    let cand = candidates[chosenIndex];

    // Helper to find pool for a candidate
    const findPoolForCandidate = (candidate) => {
      const exactMatches = candidatesList.filter(f => candidate.norm && new RegExp(`\\b${escapeRegExp(candidate.norm)}\\b`).test(f.norm));
      let partialMatches = [];
      if (candidate.isPrefix) {
        partialMatches = candidatesList.filter(f => candidate.norm && f.norm.startsWith(candidate.norm));
      } else {
        partialMatches = candidatesList.filter(f => candidate.norm && f.norm.includes(candidate.norm));
      }
      return exactMatches.length ? exactMatches : (partialMatches.length ? partialMatches : []);
    };

    // Try chosen candidate
    let pool = findPoolForCandidate(cand);

    // If chosen candidate produced no matches and it is not the primary, try primary once
    const primaryCandidate = candidates[0];
    if ((!pool || pool.length === 0) && cand !== primaryCandidate) {
      // attempt primary candidate as fallback before neutral
      pool = findPoolForCandidate(primaryCandidate);
      if (pool && pool.length > 0) {
        cand = primaryCandidate; // reflect that primary produced the pool
      }
    }

    // If still no pool, fall back to neutral pick
    if (!pool || pool.length === 0) {
      return neutralPick(candidatesList, rarity, oshiLabel, avoidImmediateRepeat);
    }

    // Group by normalized basename to avoid duplicates caused by different filenames mapping to same normalized name
    const grouped = new Map();
    for (const item of pool) {
      const key = item.norm;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item.raw);
    }
    const groups = Array.from(grouped.values());
    if (groups.length === 0) return neutralPick(candidatesList, rarity, oshiLabel, avoidImmediateRepeat);

    // Avoid immediate repeat for this rarity+oshi (use the original oshiLabel as key so exceptions still share the same lastPicked)
    const lastKey = `${String(rarity)}::${oshiLabel || ''}`;
    const lastPicked = lastPickedByRarity.get(lastKey);

    // Choose a group index randomly
    let groupIndex = crypto.randomInt(0, groups.length);

    if (avoidImmediateRepeat && lastPicked && groups.length > 1) {
      const chosenGroup = groups[groupIndex];
      if (chosenGroup.includes(lastPicked)) {
        // try a few times to pick a different group
        for (let i = 0; i < 5; i++) {
          const alt = crypto.randomInt(0, groups.length);
          if (alt !== groupIndex && !groups[alt].includes(lastPicked)) {
            groupIndex = alt;
            break;
          }
        }
      }
    }

    const chosenGroup = groups[groupIndex];
    const rawPick = chosenGroup[crypto.randomInt(0, chosenGroup.length)];

    // Save last picked raw filename for this rarity+oshi
    lastPickedByRarity.set(lastKey, rawPick);

    console.debug(`[pickCard] rarity=${rarity} oshi=${oshiLabel} candidate=${cand.raw} poolSize=${pool.length} groups=${groups.length} chosen=${rawPick}`);

    return path.basename(rawPick, path.extname(rawPick));
  } catch (err) {
    console.error('[pickCardFromRarityFolder] error', err);
    return null;
  }
}

/**
 * Neutral random pick helper (used when no label matches or no label provided)
 */
function neutralPick(candidatesList, rarity, oshiLabel, avoidImmediateRepeat) {
  if (!Array.isArray(candidatesList) || candidatesList.length === 0) return null;

  // Group by normalized basename to avoid duplicates caused by different filenames mapping to same normalized name
  const grouped = new Map();
  for (const item of candidatesList) {
    const key = item.norm;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item.raw);
  }
  const groups = Array.from(grouped.values());
  if (groups.length === 0) return null;

  const lastKey = `${String(rarity)}::${oshiLabel || ''}`;
  const lastPicked = lastPickedByRarity.get(lastKey);

  let groupIndex = crypto.randomInt(0, groups.length);

  if (avoidImmediateRepeat && lastPicked && groups.length > 1) {
    const chosenGroup = groups[groupIndex];
    if (chosenGroup.includes(lastPicked)) {
      for (let i = 0; i < 5; i++) {
        const alt = crypto.randomInt(0, groups.length);
        if (alt !== groupIndex && !groups[alt].includes(lastPicked)) {
          groupIndex = alt;
          break;
        }
      }
    }
  }

  const chosenGroup = groups[groupIndex];
  const rawPick = chosenGroup[crypto.randomInt(0, chosenGroup.length)];

  lastPickedByRarity.set(lastKey, rawPick);

  console.debug(`[pickCard-neutral] rarity=${rarity} oshi=${oshiLabel} poolSize=${candidatesList.length} groups=${groups.length} chosen=${rawPick}`);

  return path.basename(rawPick, path.extname(rawPick));
}

/**
 * drawPack(userId, opts = null, specialLabel = null)
 * - specialLabel: when provided, prefer files matching this label (same matching as settlement)
 * Returns array of { rarity, file } where file is basename without extension.
 */
async function drawPack(userId, opts = null, specialLabel = null) {
  // Replace this with your actual pack composition
  const packRarities = opts?.rarities || ['C', 'U', 'R']; // example; adapt to your rules
  const pack = [];

  for (const rarity of packRarities) {
    let picked = null;

    // If a special label is provided, try to pick a matching file first
    if (specialLabel) {
      try {
        picked = await pickCardFromRarityFolder(rarity, specialLabel, { avoidImmediateRepeat: true });
      } catch (err) {
        console.error('[drawPack] pickCardFromRarityFolder error', { rarity, specialLabel, err });
        picked = null;
      }

      // Defensive check: ensure the picked file actually contains the token after normalization
      if (picked && specialLabel) {
        const norm = normalizeFilenameForMatch(picked);
        const token = String(specialLabel).toLowerCase().replace(/[^\w\s]/g, '').trim();
        if (!token || !new RegExp(`\\b${escapeRegExp(token)}\\b`).test(norm)) {
          console.debug('[drawPack] picked file did not match token, falling back', { picked, norm, token });
          picked = null;
        }
      }
    }

    // Fallback to any pick if no special match found
    if (!picked) {
      picked = await pickCardFromRarityFolder(rarity, null, { avoidImmediateRepeat: true });
    }

    // If still nothing, synthesize a fallback name (e.g., `${rarity}-unknown-001`)
    if (!picked) {
      picked = `${rarity}-unknown-001`;
    }

    pack.push({ rarity, file: picked });
  }

  return pack;
}

module.exports = { pickCardFromRarityFolder, drawPack, normalizeFilenameForMatch, EXCEPTIONS };
