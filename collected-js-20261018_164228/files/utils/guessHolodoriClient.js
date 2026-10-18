const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const config = require('../config.json');

const DATA_DIR = path.join(process.cwd(), 'images', 'guess', 'data');
const SONGS_FILE = path.join(DATA_DIR, 'songs.json');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');

const DEFAULT_ASSET_BASE = 'http://152.69.195.48/images/guess';

let cache = null;
let cacheMtimes = { songs: 0, cards: 0 };

function assetBase() {
  return String(
    config.guessAssetBaseUrl ||
    process.env.GUESS_ASSET_BASE_URL ||
    DEFAULT_ASSET_BASE
  ).replace(/\/+$/, '');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function statMtime(file) {
  return fs.statSync(file).mtimeMs;
}

function memberId(name) {
  return `member:${String(name || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')}`;
}

function buildData() {
  if (!fs.existsSync(SONGS_FILE)) {
    throw new Error(`Missing Guess song manifest: ${SONGS_FILE}`);
  }
  if (!fs.existsSync(CARDS_FILE)) {
    throw new Error(`Missing Guess card manifest: ${CARDS_FILE}`);
  }

  const songsRaw = readJson(SONGS_FILE);
  const cardsRaw = readJson(CARDS_FILE);

  const songs = (Array.isArray(songsRaw) ? songsRaw : [])
    .filter(s => s && s.id && s.title)
    .map(s => ({
      id: String(s.id),
      title: String(s.title),
      length: Number(s.playingSeconds || s.length || 0),
      playingSeconds: Number(s.playingSeconds || s.length || 0),
      characterIds: Array.isArray(s.characterIds) ? s.characterIds : [],
      jacket: `jacket:${s.id}`,
      difficulties: Array.isArray(s.difficulties) ? s.difficulties : [],
    }));

  const cards = (Array.isArray(cardsRaw) ? cardsRaw : [])
    .filter(c => c && c.assetId && c.member)
    .map(c => ({
      id: String(c.assetId),
      assetId: String(c.assetId),
      characterId: memberId(c.member),
      character: String(c.member),
      name: c.cardName ? String(c.cardName) : null,
      rarity: Number(c.rarity || 0),
      attributeName: c.attribute || null,
      group: c.group ? { name: String(c.group) } : null,
      image: `card:${c.assetId}`,
      thumb: `card:${c.assetId}`,
    }));

  const byMember = new Map();
  for (const card of cards) {
    if (!byMember.has(card.characterId)) {
      byMember.set(card.characterId, {
        id: card.characterId,
        name: card.character,
        shortName: card.character,
      });
    }
  }

  return {
    fetchedAt: Date.now(),
    assetInfo: null,
    songs,
    cards,
    holomems: [...byMember.values()],
    holomemGroups: [],
  };
}

async function refresh({ force = false } = {}) {
  const songsMtime = statMtime(SONGS_FILE);
  const cardsMtime = statMtime(CARDS_FILE);

  if (
    !force &&
    cache &&
    cacheMtimes.songs === songsMtime &&
    cacheMtimes.cards === cardsMtime
  ) {
    return cache;
  }

  cache = buildData();
  cacheMtimes = { songs: songsMtime, cards: cardsMtime };

  console.log(
    `[guess] local data loaded: ${cache.songs.length} songs, ` +
    `${cache.cards.length} cards, ${cache.holomems.length} holomems`
  );

  return cache;
}

async function getData() {
  return refresh();
}

function imageUrl(assetKey) {
  const key = String(assetKey || '');

  if (key.startsWith('jacket:')) {
    const songId = key.slice('jacket:'.length);
    return `${assetBase()}/jackets/${encodeURIComponent(songId)}.png`;
  }

  if (key.startsWith('card:')) {
    const assetId = key.slice('card:'.length);
    return `${assetBase()}/cards/${encodeURIComponent(assetId)}.png`;
  }

  if (/^https?:\/\//i.test(key)) return key;
  return null;
}

async function requestBytes(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: 30 * 1024 * 1024,
    maxBodyLength: 30 * 1024 * 1024,
  });
  return Buffer.from(response.data);
}

async function fetchAsset(assetKey) {
  const url = imageUrl(assetKey);
  if (!url) throw new Error(`Unknown Guess image asset: ${assetKey}`);
  return requestBytes(url);
}

async function fetchSongAudio(songId) {
  const url = `${assetBase()}/audio/${encodeURIComponent(String(songId))}.mp3`;
  return requestBytes(url);
}

function findGroupForCharacter(characterId, data = cache) {
  for (const group of data?.holomemGroups || []) {
    if ((group.members || []).some(member => String(member.id) === String(characterId))) {
      return group;
    }
  }
  return null;
}

module.exports = {
  assetBase,
  refresh,
  getData,
  imageUrl,
  fetchAsset,
  fetchSongAudio,
  findGroupForCharacter,
};
