// Serve the bot's own artwork as Discord attachments, not remote embeds.
// The synchronous localizePayload API remains for channel.send/message.edit callers.
// Interaction methods use a cached, optimized, fast-ack path for image galleries.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const PROJECT_ROOT = path.join(__dirname, '..');
const ASSET_ROOTS = [
  path.join(PROJECT_ROOT, 'assets', 'images'),
  path.join(PROJECT_ROOT, 'assets', 'montlybdays'),
  path.join(PROJECT_ROOT, 'assets'),
];
const WRAPPED = Symbol('local-image-transport-installed');
const RESOLVED_PATH_CACHE = new Map();
const RESOLVED_PATH_CACHE_MAX = 4096;
const IMAGE_CACHE = new Map();
const IMAGE_CACHE_LIMIT = 48 * 1024 * 1024;
const IMAGE_CACHE_ENTRIES = 192;
let cachedBytes = 0;
const pendingPageEdits = new Map();

function rememberResolvedPath(key, value) {
  if (RESOLVED_PATH_CACHE.has(key)) RESOLVED_PATH_CACHE.delete(key);
  RESOLVED_PATH_CACHE.set(key, value);
  if (RESOLVED_PATH_CACHE.size > RESOLVED_PATH_CACHE_MAX) RESOLVED_PATH_CACHE.delete(RESOLVED_PATH_CACHE.keys().next().value);
  return value;
}
function isFile(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}
function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}
function resolveOwnImagePath(source) {
  if (!source || typeof source !== 'string' || /^attachment:\/\//i.test(source)) return null;
  if (RESOLVED_PATH_CACHE.has(source)) {
    const cached = RESOLVED_PATH_CACHE.get(source);
    RESOLVED_PATH_CACHE.delete(source);
    RESOLVED_PATH_CACHE.set(source, cached);
    return cached;
  }
  if (!/^https?:\/\//i.test(source)) {
    const direct = path.isAbsolute(source) ? source : path.join(PROJECT_ROOT, source);
    return rememberResolvedPath(source, isFile(direct) ? direct : null);
  }
  let parsed;
  try { parsed = new URL(source); } catch { return rememberResolvedPath(source, null); }
  const pathname = safeDecode(parsed.pathname || '');
  const marker = '/images/';
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex === -1) return rememberResolvedPath(source, null);
  const relativeParts = pathname.slice(markerIndex + marker.length).split('/').filter(Boolean);
  if (!relativeParts.length) return rememberResolvedPath(source, null);
  for (const root of ASSET_ROOTS) {
    const candidate = path.resolve(root, ...relativeParts);
    if (candidate !== path.resolve(root) && !candidate.startsWith(path.resolve(root) + path.sep)) continue;
    if (isFile(candidate)) return rememberResolvedPath(source, candidate);
  }
  return rememberResolvedPath(source, null);
}
function safeStem(value) {
  return String(value || 'embed-image').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'embed-image';
}
function cloneEmbedData(embed) {
  if (!embed) return embed;
  if (typeof embed.toJSON === 'function') return embed.toJSON();
  try { return structuredClone(embed); } catch { return { ...embed }; }
}
function prepareOwnImage(source, key) {
  const localPath = resolveOwnImagePath(source);
  if (!localPath) return null;
  const ext = (path.extname(localPath) || '.png').toLowerCase();
  const name = `${safeStem(key)}${ext}`;
  return { localPath, attachmentUrl: `attachment://${name}`, file: { attachment: localPath, name } };
}
// Retained for message/channel sends in boss streams, announcements, etc.
function localizePayload(payload, contextKey = 'embed', clearPreviousAttachments = false) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.embeds)) return payload;
  const output = { ...payload };
  const extraFiles = [];
  let changed = false;
  output.embeds = payload.embeds.map((originalEmbed, index) => {
    const embed = cloneEmbedData(originalEmbed);
    if (!embed || typeof embed !== 'object') return embed;
    for (const field of ['image', 'thumbnail']) {
      const image = prepareOwnImage(embed[field]?.url, `${contextKey}-e${index}-${field}`);
      if (!image) continue;
      embed[field] = { ...embed[field], url: image.attachmentUrl };
      extraFiles.push(image.file);
      changed = true;
    }
    return embed;
  });
  if (changed) output.files = [...(Array.isArray(payload.files) ? payload.files : []), ...extraFiles];
  if (clearPreviousAttachments && payload.attachments === undefined) output.attachments = [];
  return changed || clearPreviousAttachments ? output : payload;
}

function cacheKey(filePath, size, stamp, role) {
  return `${filePath}|${size}|${stamp}|${role}`;
}
function imageCacheSet(key, promise) {
  IMAGE_CACHE.set(key, { promise, bytes: 0 });
  while (IMAGE_CACHE.size > IMAGE_CACHE_ENTRIES) {
    const oldest = IMAGE_CACHE.keys().next().value;
    const old = IMAGE_CACHE.get(oldest);
    cachedBytes -= old.bytes;
    IMAGE_CACHE.delete(oldest);
  }
}
function trimImageCache() {
  while (cachedBytes > IMAGE_CACHE_LIMIT && IMAGE_CACHE.size > 1) {
    const key = IMAGE_CACHE.keys().next().value;
    cachedBytes -= IMAGE_CACHE.get(key).bytes;
    IMAGE_CACHE.delete(key);
  }
}
async function optimizedFile(filePath, role) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return filePath;
  const stat = await fs.promises.stat(filePath);
  if (stat.size < 64 * 1024) return filePath;
  const key = cacheKey(filePath, stat.size, stat.mtimeMs, role);
  if (IMAGE_CACHE.has(key)) {
    const entry = IMAGE_CACHE.get(key);
    IMAGE_CACHE.delete(key);
    IMAGE_CACHE.set(key, entry);
    return entry.promise;
  }
  const promise = (async () => {
    const input = sharp(filePath, { failOn: 'none' }).rotate()
      .resize(role === 'thumbnail'
        ? { width: 240, height: 240, fit: 'inside', withoutEnlargement: true }
        : { width: 900, height: 1050, fit: 'inside', withoutEnlargement: true });
    if (ext === '.png') return input.png({ compressionLevel: 7 }).toBuffer();
    if (ext === '.webp') return input.webp({ quality: 82 }).toBuffer();
    return input.jpeg({ quality: 83, mozjpeg: true }).toBuffer();
  })();
  imageCacheSet(key, promise);
  try {
    const output = await promise;
    const entry = IMAGE_CACHE.get(key);
    if (entry && entry.promise === promise) {
      entry.bytes = output.length;
      cachedBytes += output.length;
      trimImageCache();
    }
    return output;
  } catch (err) {
    if (IMAGE_CACHE.get(key)?.promise === promise) IMAGE_CACHE.delete(key);
    console.warn('[local-images] optimization failed; using original:', filePath, err.message);
    return filePath;
  }
}
function stableName(filePath, role) {
  const ext = path.extname(filePath).toLowerCase() || '.png';
  const hash = crypto.createHash('sha1').update(`${filePath}|${role}`).digest('hex').slice(0, 14);
  return `bot-${role}-${hash}${ext}`;
}
function currentAttachments(interaction) {
  const out = new Map();
  const values = interaction?.message?.attachments?.values?.();
  if (!values) return out;
  for (const attachment of values) if (attachment?.name && attachment?.id) out.set(attachment.name, String(attachment.id));
  return out;
}
async function optimizedInteractionPayload(payload, interaction, clearOld = false) {
  if (!payload || typeof payload !== 'object') return payload;
  const output = { ...payload };
  const oldAttachments = clearOld ? currentAttachments(interaction) : new Map();
  const retained = [];
  const files = Array.isArray(payload.files) ? [...payload.files] : [];
  let changed = false;
  if (Array.isArray(payload.embeds)) {
    output.embeds = [];
    for (const original of payload.embeds) {
      const embed = cloneEmbedData(original);
      if (embed && typeof embed === 'object') {
        for (const role of ['image', 'thumbnail']) {
          const source = embed[role]?.url;
          const localPath = resolveOwnImagePath(source);
          if (!localPath) continue;
          const name = stableName(localPath, role);
          embed[role] = { ...embed[role], url: `attachment://${name}` };
          changed = true;
          if (oldAttachments.has(name)) {
            retained.push({ id: oldAttachments.get(name) });
          } else if (!files.some(file => file?.name === name)) {
            files.push({ attachment: await optimizedFile(localPath, role), name });
          }
        }
      }
      output.embeds.push(embed);
    }
  }
  // Commands that already send attachment:// images (pull/multi-pull) can use
  // this path too: optimize only images stored as local files, not GIFs/avatars.
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (!file || typeof file.attachment !== 'string') continue;
    if (!isFile(file.attachment)) continue;
    const optimized = await optimizedFile(file.attachment, 'image');
    if (optimized !== file.attachment) {
      files[i] = { ...file, attachment: optimized };
      changed = true;
    }
  }
  if (changed || files.length) output.files = files;
  if (clearOld && (payload.embeds !== undefined || payload.files !== undefined || payload.attachments !== undefined)) {
    // A component switching from image to list must drop obsolete artwork;
    // when the same image/logo remains, keep its Discord attachment instead.
    const explicit = Array.isArray(payload.attachments) ? payload.attachments : [];
    output.attachments = [...explicit, ...retained.filter(a => !explicit.some(x => x.id === a.id))];
  }
  return output;
}
function containsOwnArtwork(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (Array.isArray(payload.files) && payload.files.length > 0) return true;
  if (!Array.isArray(payload.embeds)) return false;
  return payload.embeds.some(embed => {
    const data = cloneEmbedData(embed);
    return Boolean(resolveOwnImagePath(data?.image?.url) || resolveOwnImagePath(data?.thumbnail?.url));
  });
}
function isPageNavigation(interaction) {
  const action = String(interaction?.customId || '').toLowerCase();
  return /(?:^|[:_\-/])(?:prev|next|back|view|page|jump|holoprev|holonext|imgprev|imgnext)(?:$|[:_\-/])/.test(action);
}
async function acknowledgeComponent(interaction, originalDeferUpdate) {
  if (!interaction?.deferred && !interaction?.replied && typeof originalDeferUpdate === 'function') {
    await originalDeferUpdate.call(interaction);
  }
}
// Coalesce ONLY navigation updates. Never drop a purchase, confirmation,
// selection or other state-changing action.
function queueLatestPage(interaction, run) {
  const messageId = interaction?.message?.id;
  if (!messageId) return run();
  let state = pendingPageEdits.get(messageId);
  if (!state) {
    state = { running: false, pending: null };
    pendingPageEdits.set(messageId, state);
  }
  return new Promise((resolve, reject) => {
    if (state.pending) state.pending.resolve(null);
    state.pending = { run, resolve, reject };
    if (state.running) return;
    state.running = true;
    void (async () => {
      while (state.pending) {
        const current = state.pending;
        state.pending = null;
        try { current.resolve(await current.run()); }
        catch (err) { current.reject(err); }
      }
      state.running = false;
      if (pendingPageEdits.get(messageId) === state) pendingPageEdits.delete(messageId);
    })();
  });
}
async function waitForPageEdits(interaction) {
  const messageId = interaction?.message?.id;
  if (!messageId) return;
  const state = pendingPageEdits.get(messageId);
  if (!state) return;
  if (state.pending) {
    state.pending.resolve(null);
    state.pending = null;
  }
  // Existing edit may still finish; subsequent state changes must not be overwritten.
  while (state.running) await new Promise(resolve => setTimeout(resolve, 10));
}
function withoutUploadedImages(payload) {
  const output = { ...payload, files: [], attachments: [] };
  if (Array.isArray(payload.embeds)) {
    output.embeds = payload.embeds.map(original => {
      const embed = cloneEmbedData(original);
      for (const role of ['image', 'thumbnail']) {
        if (/^attachment:\/\//i.test(embed?.[role]?.url || '')) delete embed[role];
      }
      return embed;
    });
  }
  return output;
}
async function sendWithImageFallback(original, interaction, payload, ...rest) {
  try {
    return await original.call(interaction, payload, ...rest);
  } catch (err) {
    if (!Array.isArray(payload?.files) || payload.files.length === 0) throw err;
    console.warn('[local-images] attachment upload failed; retrying text-only:', err.message);
    try {
      return await original.call(interaction, withoutUploadedImages(payload), ...rest);
    } catch {
      throw err;
    }
  }
}
function wrapMethod(interaction, methodName, clearPreviousAttachments) {
  const original = interaction?.[methodName];
  if (typeof original !== 'function') return;
  const deferUpdate = interaction?.deferUpdate;
  interaction[methodName] = async function localImageWrappedMethod(payload, ...rest) {
    const nav = clearPreviousAttachments && isPageNavigation(this);
    if (nav) await acknowledgeComponent(this, deferUpdate);
    const run = async () => {
      if (clearPreviousAttachments && !nav && this?.message?.id) await waitForPageEdits(this);
      return sendWithImageFallback(original, this, await optimizedInteractionPayload(payload, this, clearPreviousAttachments), ...rest);
    };
    return nav ? queueLatestPage(this, run) : run();
  };
}
function wrapUpdateMethod(interaction) {
  const originalUpdate = interaction?.update;
  const originalDeferUpdate = interaction?.deferUpdate;
  const originalEditReply = interaction?.editReply;
  if (typeof originalUpdate !== 'function') return;
  interaction.update = async function localImageWrappedUpdate(payload, ...rest) {
    const nav = isPageNavigation(this);
    const needsAttachment = containsOwnArtwork(payload);
    if (nav || needsAttachment) await acknowledgeComponent(this, originalDeferUpdate);
    const run = async () => {
      if (!nav) await waitForPageEdits(this);
      const prepared = await optimizedInteractionPayload(payload, this, true);
      if (nav || needsAttachment) return sendWithImageFallback(originalEditReply, this, prepared);
      return sendWithImageFallback(originalUpdate, this, prepared, ...rest);
    };
    return nav ? queueLatestPage(this, run) : run();
  };
}
function installLocalImageTransport(interaction) {
  if (!interaction || interaction[WRAPPED]) return interaction;
  Object.defineProperty(interaction, WRAPPED, { value: true, configurable: false });
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
  optimizedInteractionPayload,
  isPageNavigation,
};
