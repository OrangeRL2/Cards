const streamManager = require('../jobs/streamManager');
const permissions = require('../config/permissions');

module.exports = {
  name: 'forcestream',
  description: 'Force-start a stream now. Usage: !forcestream [oshiId|subunit name] [seconds]',

  async execute(message, args) {
    try {
      const allowed = permissions.allowedStreamSpawners || permissions.allowedBossSpawners || [];
      if (!message?.author?.id || !allowed.includes(message.author.id)) {
        return message.reply('You do not have permission to use this command.');
      }

      const rawArgs = Array.isArray(args) ? args.map(a => String(a).trim()).filter(Boolean) : [];
      const fullRequestedTarget = rawArgs.length ? rawArgs.join(' ') : null;
      let requestedTarget = fullRequestedTarget;
      let durationSecArg = NaN;

      const maybeDuration = rawArgs.length ? parseInt(rawArgs[rawArgs.length - 1], 10) : NaN;
      const lastArgIsNumber = Number.isFinite(maybeDuration) && /^\d+$/.test(rawArgs[rawArgs.length - 1] || '');

      if (lastArgIsNumber) {
        const fullTarget = streamManager.resolveStreamTarget(fullRequestedTarget);
        if (!fullTarget) {
          durationSecArg = maybeDuration;
          requestedTarget = rawArgs.slice(0, -1).join(' ') || null;
        }
      }

      const target = streamManager.resolveStreamTarget(requestedTarget);
      if (!target) {
        return message.reply(`Unknown Oshi/subunit/stream: \`${requestedTarget}\`.`);
      }

      const durationMs = Number.isFinite(durationSecArg) && durationSecArg > 0 ? durationSecArg * 1000 : null;
      const { event } = await streamManager.createAndAnnounceEvent(message.client, target.eventOshiId, durationMs);
      return message.reply(`Stream for **${target.label}** started (event ${event.eventId}).`);
    } catch (err) {
      console.error('forcestream error', err);
      return message.reply(`Failed to start stream: ${err?.message || 'check logs'}`).catch(() => null);
    }
  },
};
