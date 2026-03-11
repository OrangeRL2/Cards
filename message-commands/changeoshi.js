// commands/changeoshi.js
const { EmbedBuilder } = require('discord.js');

const OshiUser = require('../models/Oshi');
const OSHI_LIST = require('../config/oshis');

// Same admin allowlist approach as admingive.js 
const ALLOWED_IDS = ['153551890976735232', '409717160995192832', '272129129841688577'];
const PREFIX = '!';

function resolveUserId(raw, message) {
  if (!raw) return null;

  // 1) mention in the message (e.g., !changeoshi @user fubuki)
  const mentioned = message.mentions?.users?.first?.();
  if (mentioned) return mentioned.id;

  // 2) raw could be <@123> or <@!123>
  const mentionMatch = String(raw).match(/^<@!?(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];

  // 3) raw could be a plain ID
  const idMatch = String(raw).match(/^(\d+)$/);
  if (idMatch) return idMatch[1];

  return null;
}

function findOshiId(input) {
  if (!Array.isArray(OSHI_LIST)) return null;
  const q = String(input).trim().toLowerCase();

  const byId = OSHI_LIST.find(o => String(o.id).toLowerCase() === q);
  if (byId) return byId.id;

  const byLabel = OSHI_LIST.find(o => String(o.label).toLowerCase() === q);
  if (byLabel) return byLabel.id;

  return null;
}

module.exports = {
  name: 'changeoshi',
  description: 'Change a user’s oshi quickly (admin only)',

  async execute(message, args = []) {
    try {
      if (!message.content?.startsWith(PREFIX)) return;
      if (message.author.bot) return;

      // Permission check matches your existing prefix command pattern [1](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/admingive.js)
      if (!ALLOWED_IDS.includes(String(message.author.id))) {
        return message.reply({ content: 'You are not allowed to use this command.' }).catch(() => {});
      }

      // args[0] = user/id/mention, args[1..] = oshi text
      const rawTarget = args[0];
      const userId = resolveUserId(rawTarget, message);

      const oshiText = args.slice(1).join(' ').replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1').trim();

      if (!userId || !oshiText) {
        return message.reply({
          content: 'Usage: !changeoshi <userId|@mention> <oshi...>\nExample: !changeoshi 153551890976735232 fubuki'
        }).catch(() => {});
      }

      // store OSHI_LIST id if possible; else store raw input [2](https://ace00101-my.sharepoint.com/personal/nauldee_nawill_ace00101_onmicrosoft_com/Documents/Microsoft%20Copilot%20Chat%20%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB/oshi.js)
      const matchedId = findOshiId(oshiText);
      const oshiIdToStore = matchedId || oshiText;

      // upsert
      const now = new Date();
      await OshiUser.updateOne(
        { userId },
        {
          $set: { oshiId: oshiIdToStore },
          $setOnInsert: { userId, chosenAt: now }
        },
        { upsert: true }
      ).exec();

      const embed = new EmbedBuilder()
        .setTitle('✅ Oshi Changed')
        .setColor('#2ecc71')
        .setDescription(`**User:** <@${userId}>\n**New Oshi:** \`${oshiIdToStore}\``)
        .setFooter({ text: '!changeoshi' })
        .setTimestamp();

      return message.reply({ embeds: [embed] }).catch(() => {});
    } catch (err) {
      console.error('[changeoshi] error', err);
      return message.reply({ content: 'Unexpected error running changeoshi.' }).catch(() => {});
    }
  }
};