// utils/birthdayPool.js
// Central BDAY availability filter.
// config/birthdayConfig.js is authoritative; config/oshis.js is NOT consulted here.

const fs = require('fs');
const path = require('path');
const birthdayConfig = require('../config/birthdayConfig');

// Keep the complete BDAY collection here permanently.
const BIRTHDAY_FOLDER =
  process.env.BDAY_FULL_FOLDER ||
  path.join(__dirname, '..', 'assets', 'images', 'BDAY');

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;

function configuredDate() {
  const raw = birthdayConfig?.debugDate;
  if (!raw) return new Date();

  // Treat YYYY-MM-DD as a JST calendar date rather than server-local time.
  const match = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, y, m, d] = match;
    const parsed = new Date(`${y}-${m}-${d}T00:00:00+09:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getJstMonth(date = configuredDate()) {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
  }).format(date));
}

function basenameNoExt(value) {
  return path.basename(String(value || ''), path.extname(String(value || ''))).trim();
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSelectorsForMonth(month = getJstMonth()) {
  const list = birthdayConfig?.cardsByMonth?.[Number(month)];
  return Array.isArray(list)
    ? list.map(x => String(x || '').trim()).filter(Boolean)
    : [];
}

function matchesSelector(file, selector) {
  const card = normalize(basenameNoExt(file));
  const raw = String(selector || '').trim();
  if (!card || !raw) return false;

  const wildcard = raw.endsWith('*');
  const token = normalize(wildcard ? raw.slice(0, -1) : raw);
  if (!token) return false;

  if (wildcard) {
    return card === token || card.startsWith(`${token} `);
  }

  return card === token;
}

function filterBirthdayFilesForMonth(files, month = getJstMonth()) {
  const selectors = getSelectorsForMonth(month);
  if (!Array.isArray(files) || !files.length || !selectors.length) return [];
  return files.filter(file => selectors.some(selector => matchesSelector(file, selector)));
}

function filterBirthdayFilesForCurrentMonth(files) {
  return filterBirthdayFilesForMonth(files, getJstMonth());
}

function getAllBirthdayFiles() {
  if (!fs.existsSync(BIRTHDAY_FOLDER)) return [];
  return fs.readdirSync(BIRTHDAY_FOLDER)
    .filter(file => IMAGE_EXT_RE.test(file))
    .map(file => path.join(BIRTHDAY_FOLDER, file));
}

function getCurrentBirthdayFiles() {
  return filterBirthdayFilesForCurrentMonth(getAllBirthdayFiles());
}

module.exports = {
  BIRTHDAY_FOLDER,
  getJstMonth,
  getSelectorsForMonth,
  filterBirthdayFilesForMonth,
  filterBirthdayFilesForCurrentMonth,
  getAllBirthdayFiles,
  getCurrentBirthdayFiles,
};
