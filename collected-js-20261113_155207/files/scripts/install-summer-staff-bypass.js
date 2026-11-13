#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const configPath = path.join(root, 'config.json');
const helperSource = path.join(__dirname, '..', 'utils', 'summerPullBonus.js');
const helperTarget = path.join(root, 'utils', 'summerPullBonus.js');
const commandPaths = [
  path.join(root, 'Commands', 'Utility', 'pull.js'),
  path.join(root, 'Commands', 'Utility', 'multi-pull.js'),
];

function backup(filePath) {
  const backupPath = `${filePath}.before-summer-staff-bypass`;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
    console.log(`Backup: ${path.relative(root, backupPath)}`);
  }
}

if (!fs.existsSync(configPath)) throw new Error('config.json was not found.');
if (!fs.existsSync(helperTarget)) throw new Error('utils/summerPullBonus.js was not found.');
for (const commandPath of commandPaths) {
  if (!fs.existsSync(commandPath)) throw new Error(`${path.relative(root, commandPath)} was not found.`);
}

backup(configPath);
backup(helperTarget);
for (const commandPath of commandPaths) backup(commandPath);

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (!Array.isArray(config.summerChannelBypassUserIds)) config.summerChannelBypassUserIds = [];
if (!Array.isArray(config.summerChannelBypassRoleIds)) config.summerChannelBypassRoleIds = [];
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log('Updated config.json');

fs.copyFileSync(helperSource, helperTarget);
console.log('Updated utils/summerPullBonus.js');

for (const commandPath of commandPaths) {
  let source = fs.readFileSync(commandPath, 'utf8');

  if (/roleIds:\s*interaction\.member\?\.roles\?\.cache/.test(source)) {
    console.log(`Already patched: ${path.relative(root, commandPath)}`);
    continue;
  }

  const pattern = /(summerContext\s*=\s*await\s+validateSummerPullChannel\(\{[\s\S]*?channelId:\s*interaction\.channelId,?)(\s*\n\s*\}\);)/;
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`Could not find validateSummerPullChannel call in ${path.relative(root, commandPath)}.`);
  }

  const replacement = `${match[1]}\n          roleIds: interaction.member?.roles?.cache\n            ? [...interaction.member.roles.cache.keys()]\n            : [],${match[2]}`;
  source = source.replace(pattern, replacement);
  fs.writeFileSync(commandPath, source);
  console.log(`Updated ${path.relative(root, commandPath)}`);
}

console.log('\nInstallation complete. Add IDs to config.json, then restart the bot.');
