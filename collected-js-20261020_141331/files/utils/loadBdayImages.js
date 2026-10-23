// utils/loadBdayImages.js
const fs = require('fs');
const path = require('path');

function normalizeLabel(label) {
  if (!label) return '';
  return String(label).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
}

function loadAllBdayFiles() {
  const base = path.join(__dirname, '..', 'assets', 'images', 'BDAY');
  const allFiles = []; // absolute paths

  try {
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return allFiles;
  } catch {
    return allFiles;
  }

  const entries = fs.readdirSync(base);
  for (const entry of entries) {
    const abs = path.join(base, entry);
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        const subfiles = fs
          .readdirSync(abs)
          .filter(f => /\.(png|jpe?g|gif)$/i.test(f))
          .map(f => path.join(abs, f));
        allFiles.push(...subfiles);
      } else if (stat.isFile() && /\.(png|jpe?g|gif)$/i.test(entry)) {
        allFiles.push(abs);
      }
    } catch {
      continue;
    }
  }

  return allFiles;
}

const ALL_FILES = loadAllBdayFiles();

// Build quick lookup map, keyed by normalized folder name and also by filename prefix
function buildIndex(files) {
  const byFolder = new Map(); // folderKey -> [files]
  const byPrefix = new Map(); // prefixKey -> [files]
  const rootPool = [];

  for (const f of files) {
    const basename = path.basename(f);
    const dir = path.dirname(f);
    const parent = path.basename(dir);

    // if the file lives in a folder, index by that folder name (normalized)
    if (parent && parent.toLowerCase() !== 'bday') {
      const folderKey = normalizeLabel(parent);
      if (!byFolder.has(folderKey)) byFolder.set(folderKey, []);
      byFolder.get(folderKey).push(f);
    } else {
      // file is directly under bday root or in a 'bday' parent — treat as root pool (fallback)
      rootPool.push(f);
    }

    // index by filename prefix (take first token before space or underscore or dash)
    const nameNoExt = basename.replace(/\.[^.]+$/, '');
    const prefixToken = nameNoExt.split(/[\s_-]+/)[0]; // e.g., "Aki" from "Aki 001"
    if (prefixToken) {
      const prefixKey = normalizeLabel(prefixToken);
      if (!byPrefix.has(prefixKey)) byPrefix.set(prefixKey, []);
      byPrefix.get(prefixKey).push(f);
    }
  }

  return { byFolder, byPrefix, rootPool };
}

const INDEX = buildIndex(ALL_FILES);

function pickBdayFile(oshiLabel) {
  if (!oshiLabel) return null;
  const key = normalizeLabel(oshiLabel);

  // 1) try folder match
  const folderChoices = INDEX.byFolder.get(key);
  if (folderChoices && folderChoices.length > 0) {
    return folderChoices[Math.floor(Math.random() * folderChoices.length)];
  }

  // 2) try filename prefix match (e.g., "Aki 001.png" matches "aki")
  const prefixChoices = INDEX.byPrefix.get(key);
  if (prefixChoices && prefixChoices.length > 0) {
    return prefixChoices[Math.floor(Math.random() * prefixChoices.length)];
  }

  // 3) fallback to root pool
  if (INDEX.rootPool && INDEX.rootPool.length > 0) {
    return INDEX.rootPool[Math.floor(Math.random() * INDEX.rootPool.length)];
  }

  return null;
}

module.exports = { pickBdayFile, INDEX, normalizeLabel };
