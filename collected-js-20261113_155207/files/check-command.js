// check-commands.js
const fs = require('fs');
const path = require('path');

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    if (fs.statSync(fp).isDirectory()) out.push(...walk(fp));
    else if (fp.endsWith('.js')) out.push(fp);
  }
  return out;
}

const files = walk(path.join(__dirname, 'Commands/Utility'));
const commands = [];

for (const f of files) {
  try {
    const mod = require(f);
    const data = mod?.data;
    const name = data?.name ?? data?.options?.find?.(() => false) ?? '(no-name)';
    commands.push({ name: name, file: f });
  } catch (e) {
    console.error('Failed to require', f, e.message);
  }
}

const map = new Map();
for (const c of commands) {
  if (!map.has(c.name)) map.set(c.name, []);
  map.get(c.name).push(c.file);
}

let hasDup = false;
for (const [name, filesList] of map.entries()) {
  if (filesList.length > 1) {
    hasDup = true;
    console.log(`DUPLICATE: "${name}" in:`);
    for (const file of filesList) console.log('  ', file);
  }
}
if (!hasDup) console.log('No duplicate command names found.');
