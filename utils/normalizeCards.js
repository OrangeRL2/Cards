// utils/normalizeCards.js
const path = require('path');

function safeArr(x) { return Array.isArray(x) ? x : []; }

function normalizeCards(rawCards) {
  // returns array of { name, rarity, count, timestamps }
  const out = [];

  if (!rawCards) return out;

  // Array shape
  if (Array.isArray(rawCards)) {
    for (const it of rawCards) {
      if (!it) continue;
      out.push({
        name: String(it.name || '').trim(),
        rarity: String(it.rarity || '').trim(),
        count: Number(it.count || 0),
        timestamps: safeArr(it.timestamps).map(t => new Date(t).getTime()).filter(Boolean),
      });
    }
    return out;
  }

  // Map shape
  if (rawCards instanceof Map) {
    for (const [k, v] of rawCards.entries()) {
      const key = k;
      const group = v || {};
      // grouped byRarity
      if (group.byRarity) {
        const inner = group.byRarity instanceof Map ? Array.from(group.byRarity.entries()) : Object.entries(group.byRarity || {});
        for (const [rarKey, infoRaw] of inner) {
          const info = infoRaw || {};
          out.push({
            name: (group.name || String(key)).trim(),
            rarity: String(info.rarity || rarKey || '').trim(),
            count: Number(info.count || 0),
            timestamps: safeArr(info.timestamps).map(t => new Date(t).getTime()).filter(Boolean),
          });
        }
        continue;
      }

      // flat card info directly
      if (group.count !== undefined && group.rarity) {
        out.push({
          name: String(group.name || key).trim(),
          rarity: String(group.rarity || '').trim(),
          count: Number(group.count || 0),
          timestamps: safeArr(group.timestamps).map(t => new Date(t).getTime()).filter(Boolean),
        });
        continue;
      }

      // composite key "Name::R"
      if (typeof key === 'string' && key.includes('::')) {
        const [nm, rar] = key.split('::');
        out.push({
          name: String(nm).trim(),
          rarity: String((group && group.rarity) || rar || '').trim(),
          count: Number((group && group.count) || 0),
          timestamps: safeArr(group && group.timestamps).map(t => new Date(t).getTime()).filter(Boolean),
        });
        continue;
      }

      // fallback inspect inner entries
      const innerEntries = Object.entries(group || {}).slice(0, 200);
      for (const [ik, iv] of innerEntries) {
        if (!iv) continue;
        if (iv.count !== undefined || iv.rarity) {
          out.push({
            name: String(group.name || key).trim(),
            rarity: String(iv.rarity || ik || '').trim(),
            count: Number(iv.count || 0),
            timestamps: safeArr(iv.timestamps).map(t => new Date(t).getTime()).filter(Boolean),
          });
        }
      }
    }
    return out;
  }

  // Plain object
  for (const [k, v] of Object.entries(rawCards || {})) {
    const group = v || {};
    if (group.byRarity) {
      const inner = Object.entries(group.byRarity || {});
      for (const [rarKey, infoRaw] of inner) {
        const info = infoRaw || {};
        out.push({
          name: String(group.name || k).trim(),
          rarity: String(info.rarity || rarKey || '').trim(),
          count: Number(info.count || 0),
          timestamps: safeArr(info.timestamps).map(t => new Date(t).getTime()).filter(Boolean),
        });
      }
      continue;
    }

    if (group.count !== undefined && group.rarity) {
      out.push({
        name: String(group.name || k).trim(),
        rarity: String(group.rarity || '').trim(),
        count: Number(group.count || 0),
        timestamps: safeArr(group.timestamps).map(t => new Date(t).getTime()).filter(Boolean),
      });
      continue;
    }

    if (typeof k === 'string' && k.includes('::')) {
      const [nm, rar] = k.split('::');
      out.push({
        name: String(nm).trim(),
        rarity: String((group && group.rarity) || rar || '').trim(),
        count: Number((group && group.count) || 0),
        timestamps: safeArr(group && group.timestamps).map(t => new Date(t).getTime()).filter(Boolean),
      });
      continue;
    }

    const inner = Object.entries(group || {}).slice(0, 200);
    for (const [ik, iv] of inner) {
      if (!iv) continue;
      if (iv.count !== undefined || iv.rarity) {
        out.push({
          name: String(group.name || k).trim(),
          rarity: String(iv.rarity || ik || '').trim(),
          count: Number(iv.count || 0),
          timestamps: safeArr(iv.timestamps).map(t => new Date(t).getTime()).filter(Boolean),
        });
      }
    }
  }

  return out;
}

module.exports = { normalizeCards };
