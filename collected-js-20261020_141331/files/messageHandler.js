// message prefix dispatcher
const PREFIX = '!';

client.on('messageCreate', async (message) => {
  // debug
  console.log('[messageCreate]', message.author.tag, message.author.id, '->', message.content?.slice(0, 200));

  if (message.author.bot) return;
  if (!message.content || !message.content.startsWith(PREFIX)) return;

  const withoutPrefix = message.content.slice(PREFIX.length).trim();
  const [cmdName, ...rawArgs] = withoutPrefix.split(/\s+/);
  const command = client.messageCommands.get(cmdName);
  if (!command) {
    // optionally log unknown command
    // console.log('[MSG-CMD] unknown', cmdName);
    return;
  }

  try {
    // call execute(message, args) — adjust if your command signature differs
    await command.execute(message, rawArgs);
  } catch (err) {
    console.error('[MSG-CMD] command error', cmdName, err);
    try { await message.reply({ content: 'Command error' }); } catch {}
  }
});
