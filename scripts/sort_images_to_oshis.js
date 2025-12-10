// scripts/sort_images_to_oshis.js
// Usage: run from project root: node scripts/sort_images_to_oshis.js

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const IMAGES_ROOT = path.join(PROJECT_ROOT, 'assets', 'images');
const OSHI_IMAGES_ROOT = path.join(IMAGES_ROOT, 'oshi');
const OSHIS_CONFIG = path.join(PROJECT_ROOT, 'config', 'oshis.js');

// Rarity folders to scan (as requested)
const RARITIES = ['C','HR','OC','OSR','OUR','P','R','RR','S','SEC','SP','SR','SY','U','UP','UR','bday'];

// Helper: normalize a string for matching (lowercase, remove non-alphanumeric)
function normalizeForMatch(s) {
  if (!s) return '';
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Load oshis list from config/oshis.js
let oshis;
try {
  oshis = require(OSHIS_CONFIG);
  if (!Array.isArray(oshis)) throw new Error('oshis config is not an array');
} catch (err) {
  console.error('Failed to load oshis config:', err.message);
  process.exit(1);
}

// Build matchers for each oshi
const oshiMatchers = oshis.map(o => {
  const id = String(o.id);
  const label = String(o.label || '');
  const candidates = new Set();

  // Add id and label variants
  candidates.add(normalizeForMatch(id));
  candidates.add(normalizeForMatch(label));
  // also add label without spaces/punctuation (already normalized)
  // add uppercase original forms too (for logging)
  return {
    id,
    label,
    candidates: Array.from(candidates).filter(Boolean)
  };
});

// Ensure oshi images root exists
if (!fs.existsSync(OSHI_IMAGES_ROOT)) {
  fs.mkdirSync(OSHI_IMAGES_ROOT, { recursive: true });
}

// Summary counters
let copiedCount = 0;
let skippedCount = 0;
const unmatchedFiles = [];
const matchedFiles = [];

// For each rarity folder, scan files
for (const rarity of RARITIES) {
  const rarityPath = path.join(IMAGES_ROOT, rarity);
  if (!fs.existsSync(rarityPath) || !fs.statSync(rarityPath).isDirectory()) {
    console.warn(`Rarity folder missing, skipping: ${rarityPath}`);
    continue;
  }

  const items = fs.readdirSync(rarityPath, { withFileTypes: true });
  for (const it of items) {
    if (!it.isFile()) continue;
    const filename = it.name;
    // only consider common image extensions
    if (!/\.(png|jpe?g|webp|gif)$/i.test(filename)) continue;

    const nameNoExt = path.basename(filename, path.extname(filename));
    const normName = normalizeForMatch(nameNoExt);

    // Try to find a matching oshi
    let matched = null;
    for (const o of oshiMatchers) {
      for (const cand of o.candidates) {
        if (!cand) continue;
        // match if normalized filename contains the normalized candidate
        if (normName.includes(cand)) {
          matched = o;
          break;
        }
      }
      if (matched) break;
    }

    if (!matched) {
      unmatchedFiles.push({ rarity, filename });
      continue;
    }

    // Prepare destination folder: assets/images/oshi/<oshiId>/<RARITY>/
    const destDir = path.join(OSHI_IMAGES_ROOT, matched.id, rarity);
    try {
      fs.mkdirSync(destDir, { recursive: true });
    } catch (err) {
      console.error('Failed to create dest dir', destDir, err.message);
      skippedCount++;
      continue;
    }

    const src = path.join(rarityPath, filename);
    const dest = path.join(destDir, filename);

    try {
      // If file already exists at destination, skip (or you can overwrite by using copyFileSync without check)
      if (fs.existsSync(dest)) {
        console.log(`Already exists, skipping: ${dest}`);
        skippedCount++;
      } else {
        fs.copyFileSync(src, dest);
        copiedCount++;
        matchedFiles.push({ rarity, filename, oshi: matched.id });
        console.log(`Copied: ${filename} -> oshi/${matched.id}/${rarity}/`);
      }
    } catch (err) {
      console.error(`Failed to copy ${src} -> ${dest}:`, err.message);
      skippedCount++;
    }
  }
}

// Summary
console.log('--- Summary ---');
console.log(`Copied files: ${copiedCount}`);
console.log(`Skipped files: ${skippedCount}`);
console.log(`Unmatched files: ${unmatchedFiles.length}`);
if (unmatchedFiles.length) {
  console.log('Unmatched examples (rarity : filename):');
  unmatchedFiles.slice(0, 50).forEach(f => console.log(`  ${f.rarity} : ${f.filename}`));
}
console.log('Done.');
