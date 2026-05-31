// message-commands/forceboss.js
const bossManager = require('../jobs/bossManager');
const { allowedBossSpawners } = require('../config/permissions');

module.exports = {
  name: 'forceboss',
  description: 'Force spawn a boss/stream now. Usage: !forceboss [oshiId|subunit name] [seconds]',

  async execute(message, args) {
    try {
      // Allowlist check by Discord user ID
      const authorId = message?.author?.id;

      if (!authorId || !allowedBossSpawners.includes(authorId)) {
        return message.reply('You do not have permission to use this command.');
      }

      // Resolve oshi/subunit/stream target.
      //
      // Supports:
      // !forceboss fauna
      // !forceboss fauna 60
      // !forceboss Gen 1
      // !forceboss Gen 1 60
      // !forceboss Shiranui Construction
      // !forceboss Shiranui Construction 60
      //
      // Important:
      // We try the full input first so names like "Gen 1" do not get parsed
      // as target="Gen", duration=1.
      const rawArgs = Array.isArray(args)
        ? args.map(a => String(a).trim()).filter(Boolean)
        : [];

      const fullRequestedTarget = rawArgs.length ? rawArgs.join(' ') : null;

      let requestedTarget = fullRequestedTarget;
      let durationSecArg = NaN;

      const maybeDurationSec = rawArgs.length
        ? parseInt(rawArgs[rawArgs.length - 1], 10)
        : NaN;

      const lastArgIsNumber =
        Number.isFinite(maybeDurationSec) &&
        /^\d+$/.test(rawArgs[rawArgs.length - 1] || '');

      if (lastArgIsNumber) {
        // First try the whole input as a target.
        // Example: "Gen 1" should resolve as a boss target, not duration 1.
        const fullTarget = bossManager.resolveBossTarget(fullRequestedTarget);

        // If the full input is not a valid target, treat the last number as duration.
        // Example: "fauna 60" => target="fauna", duration=60
        // Example: "Gen 1 60" => target="Gen 1", duration=60
        if (!fullTarget) {
          durationSecArg = maybeDurationSec;
          requestedTarget = rawArgs.slice(0, -1).join(' ') || null;
        }
      }

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
      const { event } = await bossManager.createAndAnnounceEvent(
        message.client,
        oshiId,
        durationMs
      );

      await message.reply(
        `Stream for **${oshiLabel}** spawned and announced (event ${event.eventId}).`
      );
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