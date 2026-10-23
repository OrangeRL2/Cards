// Converts this bot's own externally-hosted embed images into Discord attachments.
// Third-party URLs (Discord GIFs, avatars, arbitrary announcement URLs, etc.) stay unchanged.

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');
const ASSET_ROOTS = [
  path.join(PROJECT_ROOT, 'assets', 'images'),
  path.join(PROJECT_ROOT, 'assets', 'montlybdays'),
  path.join(PROJECT_ROOT, 'assets'),
];

const WRAPPED = Symbol('local-image-transport-installed');
const RESOLVED_PATH_CACHE = new Map();
const RESOLVED_PATH_CACHE_MAX = 4096;

function rememberResolvedPath(key, value) {
  if (RESOLVED_PATH_CACHE.has(key)) RESOLVED_PATH_CACHE.delete(key);
  RESOLVED_PATH_CACHE.set(key, value);
  if (RESOLVED_PATH_CACHE.size > RESOLVED_PATH_CACHE_MAX) {
    const oldest = RESOLVED_PATH_CACHE.keys().next().value;
    RESOLVED_PATH_CACHE.delete(oldest);
  }
  return value;
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveOwnImagePath(source) {
  if (!source || typeof source !== 'string') return null;
  if (/^attachment:\/\//i.test(source)) return null;

  if (RESOLVED_PATH_CACHE.has(source)) {
    const cached = RESOLVED_PATH_CACHE.get(source);
    RESOLVED_PATH_CACHE.delete(source);
    RESOLVED_PATH_CACHE.set(source, cached);
    return cached;
  }

  // Direct local paths are also accepted.
  if (!/^https?:\/\//i.test(source)) {
    const direct = path.isAbsolute(source) ? source : path.join(PROJECT_ROOT, source);
    return rememberResolvedPath(source, isFile(direct) ? direct : null);
  }

  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    return rememberResolvedPath(source, null);
  }

  // Only URLs exposing the bot's normal /images/... asset tree are eligible.
  // This intentionally works with the old raw IP, sslip.io, or a future hostname.
  const pathname = safeDecode(parsed.pathname || '');
  const marker = '/images/';
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex === -1) return rememberResolvedPath(source, null);

  const relativeParts = pathname
    .slice(markerIndex + marker.length)
    .split('/')
    .filter(Boolean);

  if (!relativeParts.length) return rememberResolvedPath(source, null);

  for (const root of ASSET_ROOTS) {
    const candidate = path.resolve(root, ...relativeParts);
    const normalizedRoot = path.resolve(root) + path.sep;

    // Do not allow URL path traversal outside an asset root.
    if (!(candidate + path.sep).startsWith(normalizedRoot) && candidate !== path.resolve(root)) {
      continue;
    }

    if (isFile(candidate)) return rememberResolvedPath(source, candidate);
  }

  return rememberResolvedPath(source, null);
}

function safeStem(value) {
  return String(value || 'embed-image')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'embed-image';
}

function cloneEmbedData(embed) {
  if (!embed) return embed;
  if (typeof embed.toJSON === 'function') return embed.toJSON();
  try {
    return structuredClone(embed);
  } catch {
    return { ...embed };
  }
}

function prepareOwnImage(source, key) {
  const localPath = resolveOwnImagePath(source);
  if (!localPath) return null;

  const ext = (path.extname(localPath) || '.png').toLowerCase();
  const name = `${safeStem(key)}${ext}`;

  return {
    localPath,
    attachmentUrl: `attachment://${name}`,
    file: { attachment: localPath, name },
  };
}

function localizePayload(payload, contextKey = 'embed', clearPreviousAttachments = false) {
  if (!payload || typeof payload !== 'object') return payload;
  if (!Array.isArray(payload.embeds)) return payload;

  const output = { ...payload };
  const extraFiles = [];
  let changed = false;

  output.embeds = payload.embeds.map((originalEmbed, embedIndex) => {
    const embed = cloneEmbedData(originalEmbed);
    if (!embed || typeof embed !== 'object') return embed;

    let localized = embed;

    const image = prepareOwnImage(embed.image?.url, `${contextKey}-e${embedIndex}-image`);
    if (image) {
      localized = {
        ...localized,
        image: { ...(localized.image || {}), url: image.attachmentUrl },
      };
      extraFiles.push(image.file);
      changed = true;
    }

    const thumbnail = prepareOwnImage(embed.thumbnail?.url, `${contextKey}-e${embedIndex}-thumb`);
    if (thumbnail) {
      localized = {
        ...localized,
        thumbnail: { ...(localized.thumbnail || {}), url: thumbnail.attachmentUrl },
      };
      extraFiles.push(thumbnail.file);
      changed = true;
    }

    return localized;
  });

  if (changed) {
    output.files = [
      ...(Array.isArray(payload.files) ? payload.files : []),
      ...extraFiles,
    ];
  }

  // Image viewers switch between attachment-backed image pages and ordinary
  // list/text pages. Clearing old attachments on edits prevents the previous
  // card from lingering below the new embed after Back/Jump/navigation.
  if (clearPreviousAttachments && payload.attachments === undefined) {
    output.attachments = [];
  }

  return changed || clearPreviousAttachments ? output : payload;
}

function wrapMethod(interaction, methodName, clearPreviousAttachments) {
  const original = interaction?.[methodName];
  if (typeof original !== 'function') return;

  interaction[methodName] = async function localImageWrappedMethod(payload, ...rest) {
    const key = `${interaction.id || 'interaction'}-${methodName}`;
    return original.call(this, localizePayload(payload, key, clearPreviousAttachments), ...rest);
  };
}

function wrapUpdateMethod(interaction) {
  const originalUpdate = interaction?.update;
  const originalDeferUpdate = interaction?.deferUpdate;
  const originalEditReply = interaction?.editReply;
  if (typeof originalUpdate !== 'function') return;

  interaction.update = async function localImageWrappedUpdate(payload, ...rest) {
    const key = `${interaction.id || 'interaction'}-update`;
    const localized = localizePayload(payload, key, true);
    const hasFileUpload = Array.isArray(localized?.files) && localized.files.length > 0;

    // Discord component interactions must be acknowledged quickly. Uploading a
    // card image inside update() can exceed the ~3 second acknowledgement
    // window, causing the client to flash "This interaction failed" even
    // though the upload eventually succeeds. Acknowledge first, then edit the
    // original message with the attachment.
    if (hasFileUpload && typeof originalDeferUpdate === 'function' && typeof originalEditReply === 'function') {
      if (!this.deferred && !this.replied) {
        await originalDeferUpdate.call(this);
      }
      return originalEditReply.call(this, localized);
    }

    return originalUpdate.call(this, localized, ...rest);
  };
}

function installLocalImageTransport(interaction) {
  if (!interaction || interaction[WRAPPED]) return interaction;

  try {
    Object.defineProperty(interaction, WRAPPED, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  } catch {
    interaction[WRAPPED] = true;
  }

  // Wrap update first so it keeps raw deferUpdate/editReply references for
  // the fast-ack attachment path.
  wrapUpdateMethod(interaction);
  wrapMethod(interaction, 'reply', false);
  wrapMethod(interaction, 'editReply', true);
  wrapMethod(interaction, 'followUp', false);

  return interaction;
}

module.exports = {
  resolveOwnImagePath,
  localizePayload,
  installLocalImageTransport,
};
