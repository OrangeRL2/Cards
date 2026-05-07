// message-commands/forceboss.js
const bossManager = require('../jobs/bossManager');
const { allowedBossSpawners } = require('../config/permissions');

module.exports = {
  name: 'forceboss',
  description: 'Force spawn a boss/stream now. Usage: !forceboss [oshiId|subunit name] [seconds]',

  async execute(message, args) {
    try {
      // Allowlist check (by Discord user ID)
      const authorId = message?.author?.id;
      if (!authorId || !allowedBossSpawners.includes(authorId)) {
        return message.reply('You do not have permission to use this command.');
      }

      // Resolve oshi/subunit/stream target.
      // Supports multi-word subunits by treating the last numeric arg as duration
      // and joining everything before it as the target.
      // Examples:
      // !forceboss fauna 60
      // !forceboss Fauna 60
      // !forceboss FauMei 60
      // !forceboss miComet 60
      // !forceboss Shiranui Construction 60
      const rawArgs = Array.isArray(args)
        ? args.map(a => String(a).trim()).filter(Boolean)
        : [];

      const maybeDurationSec = rawArgs.length
        ? parseInt(rawArgs[rawArgs.length - 1], 10)
        : NaN;

      // Only treat the final argument as duration if it is purely numeric.
      // This avoids accidentally parsing names like "Gen 1" as target="Gen", duration=1.
      const hasDurationArg =
        Number.isFinite(maybeDurationSec) &&
        /^\d+$/.test(rawArgs[rawArgs.length - 1] || '');

      const durationSecArg = hasDurationArg ? maybeDurationSec : NaN;
      const requestedTargetParts = hasDurationArg ? rawArgs.slice(0, -1) : rawArgs;
      const requestedTarget = requestedTargetParts.length
        ? requestedTargetParts.join(' ')
        : null;

      const bossTarget = bossManager.resolveBossTarget(requestedTarget);

      if (!bossTarget) {
        return message.reply(
          `Unknown oshi/subunit/stream: \`${requestedTarget}\`. ` +
          `Use a valid oshi id/name or an exception/subunit name like \`Shiranui Construction\`.`
        );
      }

      const oshiId = bossTarget.eventOshiId;
      const oshiLabel = bossTarget.label;

      const durationMs =
        Number.isFinite(durationSecArg) && durationSecArg > 0
          ? durationSecArg * 1000
          : null;

      // Use centralized helper in bossManager to create and announce the event
      const { event } = await bossManager.createAndAnnounceEvent(message.client, oshiId, durationMs);

      await message.reply(`Stream for **${oshiLabel}** spawned and announced (event ${event.eventId}).`);
    } catch (err) {
      console.error('forceboss error', err);
      try {
        await message.reply('Failed to force spawn boss. Check logs.');
      } catch (e) {
        // ignore
      }
    }
  }
};
