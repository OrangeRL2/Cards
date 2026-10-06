// Commands/Utility/embed-image-test.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const IMAGE_BASE = process.env.IMAGE_BASE || 'http://152.69.195.48/images';
const ASSETS_ROOT = path.join(process.cwd(), 'assets', 'images');

function collectPngs(root) {
  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
        results.push(full);
      }
    }
  }

  walk(root);
  return results;
}

// Scan once when the command module loads, not on every use.
const ALL_PNGS = collectPngs(ASSETS_ROOT);

function toImageUrl(filePath) {
  const rel = path.relative(ASSETS_ROOT, filePath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join('/');

  return `${IMAGE_BASE.replace(/\/$/, '')}/${rel}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embedimagetest')
    .setDescription('Test a random externally hosted card image in a Discord embed.'),

  async execute(interaction) {
    if (!ALL_PNGS.length) {
      return interaction.reply({
        content: 'No PNG files were found under assets/images.',
        ephemeral: true,
      });
    }

    const chosen = ALL_PNGS[Math.floor(Math.random() * ALL_PNGS.length)];
    const imageUrl = toImageUrl(chosen);
    const relative = path.relative(ASSETS_ROOT, chosen);

    const embed = new EmbedBuilder()
      .setTitle('Random Embed Image Test')
      .setDescription(`Random file: \`${relative}\`\n\nURL: ${imageUrl}`)
      .setImage(imageUrl);

    console.log('[embedimagetest]', {
      file: relative,
      imageUrl,
    });

    return interaction.reply({
      embeds: [embed],
    });
  },
};
