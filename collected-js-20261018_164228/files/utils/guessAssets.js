const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

function hasFfmpeg() {
  try {
    const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return r.status === 0;
  } catch (_) {
    return false;
  }
}

async function cropSquare(buffer, { size = 250, grayscale = false } = {}) {
  const img = sharp(buffer, { failOn: 'none' });
  const meta = await img.metadata();
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  if (!width || !height) throw new Error('Could not read image dimensions.');

  const side = Math.max(1, Math.min(size, width, height));
  const left = Math.floor(Math.random() * (width - side + 1));
  const top = Math.floor(Math.random() * (height - side + 1));
  let out = sharp(buffer, { failOn: 'none' }).extract({ left, top, width: side, height: side });
  if (grayscale) out = out.grayscale();
  return out.png().toBuffer();
}

async function unsquishCard(buffer, aspect = 16 / 9) {
  const img = sharp(buffer, { failOn: 'none' });
  const meta = await img.metadata();
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  if (!width || !height) return buffer;
  const src = width / height;
  let targetW = width;
  let targetH = height;
  if (src > aspect) targetW = Math.max(1, Math.round(height * aspect));
  else if (src < aspect) targetH = Math.max(1, Math.round(width / aspect));
  if (targetW === width && targetH === height) return buffer;
  return sharp(buffer, { failOn: 'none' }).resize(targetW, targetH, { fit: 'fill' }).png().toBuffer();
}

/**
 * Cut a short MP3 clip from a full MP3 Buffer.
 *
 * Important: do NOT stream the full source Buffer into ffmpeg stdin.
 * If ffmpeg exits before Node finishes writing, the child stdin can emit an
 * unhandled EPIPE and terminate the whole bot process.
 *
 * We mirror the safer Python implementation instead:
 *   Buffer -> temporary .mp3 file -> ffmpeg reads file -> stdout Buffer
 */
async function clipMp3(inputBuffer, startSeconds, durationSeconds) {
  if (!hasFfmpeg()) {
    throw new Error('ffmpeg is not installed or not available on PATH.');
  }

  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw new Error('Audio source is empty.');
  }

  const tempName = `oneechan-guess-${process.pid}-${Date.now()}-${crypto.randomUUID()}.mp3`;
  const tempPath = path.join(os.tmpdir(), tempName);

  await fs.writeFile(tempPath, inputBuffer);

  try {
    return await new Promise((resolve, reject) => {
      const args = [
        '-hide_banner',
        '-loglevel', 'error',
        // Seek before opening input so ffmpeg does not need to decode the full
        // song before reaching the selected guess window.
        '-ss', String(Math.max(0, Number(startSeconds) || 0)),
        '-i', tempPath,
        '-t', String(Math.max(0.25, Number(durationSeconds) || 1)),
        '-vn',
        '-ac', '2',
        '-ar', '44100',
        '-codec:a', 'libmp3lame',
        '-b:a', '128k',
        '-f', 'mp3',
        'pipe:1',
      ];

      const proc = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const chunks = [];
      const errors = [];
      let settled = false;

      const finishReject = err => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      proc.stdout.on('data', chunk => chunks.push(chunk));
      proc.stderr.on('data', chunk => errors.push(chunk));

      // Attach explicit error listeners to every child stream that can emit
      // errors so a malformed audio file can never crash the bot.
      proc.on('error', finishReject);
      proc.stdout.on('error', finishReject);
      proc.stderr.on('error', finishReject);

      proc.on('close', code => {
        if (settled) return;
        settled = true;

        if (code === 0 && chunks.length) {
          resolve(Buffer.concat(chunks));
          return;
        }

        const stderr = Buffer.concat(errors).toString('utf8').trim();
        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      });
    });
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

module.exports = { hasFfmpeg, cropSquare, unsquishCard, clipMp3 };
