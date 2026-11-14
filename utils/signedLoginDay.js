'use strict';

const SignedLoginDay = require('../models/SignedLoginDay');

function jstDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function nextJstDateString(date = new Date()) {
  const [year, month, day] = jstDateString(date).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function validJstDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 2000 || year > 9999) return false;
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}

async function scheduledForJstDate(dayJST) {
  if (!validJstDate(dayJST)) return false;
  return Boolean(await SignedLoginDay.exists({ dayJST }));
}

async function scheduleJstDate(dayJST, createdBy) {
  if (!validJstDate(dayJST)) throw new Error('Invalid JST calendar date. Use YYYY-MM-DD.');
  return SignedLoginDay.findOneAndUpdate(
    { dayJST },
    { $set: { createdBy: String(createdBy) } },
    { upsert: true, new: true, runValidators: true }
  ).exec();
}

async function cancelJstDate(dayJST) {
  if (!validJstDate(dayJST)) throw new Error('Invalid JST calendar date. Use YYYY-MM-DD.');
  const result = await SignedLoginDay.deleteOne({ dayJST }).exec();
  return result.deletedCount > 0;
}

module.exports = {
  jstDateString, nextJstDateString, validJstDate,
  scheduledForJstDate, scheduleJstDate, cancelJstDate,
};
