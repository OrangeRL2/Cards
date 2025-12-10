// scripts/check_bday_folders.js
// Usage: run from project root: node scripts/check_bday_folders.js

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OSHI_CONFIG = path.join(PROJECT_ROOT, 'config', 'oshis.js');
const OSHI_IMAGES_ROOT = path.join(PROJECT_ROOT, 'assets', 'images', 'oshi');

// image extensions to consider
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function isImageFile(name) {
  const ext = path.extname(name).toLowerCase();
  return IMAGE_EXTS.includes(ext);
}

function safeRequire(file) {
  try {
    return require(file);
  } catch (e) {
    console.error('Failed to load', file, e.message);
    process.exit(1);
  }
}

const oshis = safeRequire(OSHI_CONFIG);
if (!Array.isArray(oshis)) {
  console.error('config/oshis.js did not export an array');
  process.exit(1);
}

if (!fs.existsSync(OSHI_IMAGES_ROOT)) {
  console.error('Oshi images root not found:', OSHI_IMAGES_ROOT);
  process.exit(1);
}

const results = [];
let emptyCount = 0;

for (const o of oshis) {
  const id = String(o.id);
  const bdayDir = path.join(OSHI_IMAGES_ROOT, id, 'bday');

  if (!fs.existsSync(bdayDir) || !fs.statSync(bdayDir).isDirectory()) {
    results.push({ id, status: 'MISSING', count: 0 });
    emptyCount++;
    continue;
  }

  const files = fs.readdirSync(bdayDir, { withFileTypes: true })
    .filter(d => d.isFile() && isImageFile(d.name))
    .map(d => d.name);

  if (files.length === 0) {
    results.push({ id, status: 'EMPTY', count: 0 });
    emptyCount++;
  } else {
    results.push({ id, status: 'OK', count: files.length, examples: files.slice(0, 5) });
  }
}

// Print a tidy table-like output
console.log('Checked bday folders under:', OSHI_IMAGES_ROOT);
console.log('------------------------------------------------------------');
for (const r of results) {
  if (r.status === 'OK') {
    console.log(`${r.id.padEnd(20)} : ${String(r.count).padStart(3)} files`);
  } else {
    console.log(`${r.id.padEnd(20)} : ${r.status}`);
  }
}
console.log('------------------------------------------------------------');
console.log(`Total oshis checked: ${results.length}`);
console.log(`Missing or empty bday folders: ${emptyCount}`);

// Optionally print examples of files for non-empty folders
console.log('\nExamples (up to 5 files) for non-empty folders:');
for (const r of results.filter(x => x.status === 'OK')) {
  console.log(`- ${r.id}: ${r.examples.join(', ')}`);
}
