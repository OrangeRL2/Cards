#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'jobs', 'guessManager.js');
let src = fs.readFileSync(file, 'utf8');

const oldSig = "async function spawnAutomatic(client, { mode = null, channelId = null, forced = false } = {}) {";
const newSig = "async function spawnAutomatic(client, { mode = null, channelId = null, forced = false, announce = true } = {}) {";

if (src.includes(oldSig)) {
  src = src.replace(oldSig, newSig);
} else if (!src.includes(newSig)) {
  throw new Error('Could not find the expected spawnAutomatic() signature. No changes were made.');
}

const oldCall = "    await announceAutomatic(client, channel, msg, selectedMode);";
const newCall = "    if (announce) await announceAutomatic(client, channel, msg, selectedMode);";

if (src.includes(oldCall)) {
  src = src.replace(oldCall, newCall);
} else if (!src.includes(newCall)) {
  throw new Error('Could not find the expected announceAutomatic() call. No changes were made.');
}

fs.writeFileSync(file, src);
console.log('Patched jobs/guessManager.js successfully.');
