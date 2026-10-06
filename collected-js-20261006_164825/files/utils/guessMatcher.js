function fold(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘`´']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  a = fold(a);
  b = fold(b);
  const n = a.length;
  const m = b.length;
  if (!n) return m;
  if (!m) return n;

  const prev = new Array(m + 1);
  const cur = new Array(m + 1);
  for (let j = 0; j <= m; j += 1) prev[j] = j;

  for (let i = 1; i <= n; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= m; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= m; j += 1) prev[j] = cur[j];
  }
  return prev[m];
}

function ratio(a, b) {
  const aa = fold(a);
  const bb = fold(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 100;
  const maxLen = Math.max(aa.length, bb.length);
  return Math.max(0, 100 * (1 - levenshtein(aa, bb) / maxLen));
}

function bestMatch(query, items, keyFn, sensitivity = 80) {
  const q = fold(query);
  if (!q) return null;

  let best = null;
  let bestScore = 0;
  for (const item of items || []) {
    const keys = (keyFn(item) || []).filter(Boolean);
    for (const raw of keys) {
      const k = fold(raw);
      if (!k) continue;
      if (k === q) return { item, score: 100, exact: true };
      let score = ratio(q, k);
      if (q.length >= 3 && k.startsWith(q)) score = Math.max(score, 92);
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
  }

  return best && bestScore >= sensitivity
    ? { item: best, score: bestScore, exact: false }
    : null;
}

function maskedName(name, fraction = 1 / 7) {
  const chars = Array.from(String(name || ''));
  const positions = chars
    .map((ch, i) => (!/\s/u.test(ch) ? i : -1))
    .filter(i => i >= 0);
  if (!positions.length) return String(name || '');

  const revealCount = Math.max(1, Math.round(positions.length * fraction));
  const shuffled = [...positions];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const revealed = new Set(shuffled.slice(0, revealCount));
  return chars.map((ch, i) => (/\s/u.test(ch) || revealed.has(i) ? ch : '_')).join('');
}

module.exports = { fold, ratio, bestMatch, maskedName };
