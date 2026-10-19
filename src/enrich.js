/**
 * enrich.js — fills in what an uploaded file is missing: cover art, album, year
 * and genre from the iTunes Search API, lyrics (synced LRC when there is one)
 * from LRCLIB. Both are free, keyless and CORS-enabled, so this runs straight
 * from the browser. Only empty fields are filled — tags from the file win.
 *
 * Matching uses title + artist + duration. Duration is what tells the original
 * apart from a remix, live take or radio edit, and keeps LRC timings in sync.
 * An uncertain match is reported but never applied.
 */
import { parseLyrics } from './lyrics';

export const ENRICH_VERSION = 1;

const ITUNES = 'https://itunes.apple.com/search';
const LRCLIB = 'https://lrclib.net/api';
const COVER_SIZE = 600;
const ITUNES_PER_MINUTE = 18; // Apple allows roughly 20

/** The network (not the catalogue) failed — the track stays queued and is retried later. */
export class OfflineError extends Error {}

// ── Text matching ─────────────────────────────────────────────
const FOLD = { ł: 'l', đ: 'd', ø: 'o', æ: 'ae', œ: 'oe', ß: 'ss' };
// Words that mean a different recording: a remix must never get the original's cover or LRC timings.
const VERSION_WORDS = ['remix', 'live', 'na zywo', 'unplugged', 'acoustic', 'akustycznie', 'instrumental', 'karaoke', 'cover', 'sped up', 'slowed', 'nightcore', 'acapella', 'a cappella']
  .map(w => new RegExp(`\\b${w}\\b`));
const UNKNOWN_ARTISTS = new Set(['', 'nieznany wykonawca', 'unknown', 'unknown artist']);
const UNKNOWN_ALBUMS = new Set(['', 'singiel', 'unknown', 'unknown album']);

function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[łđøæœß]/g, c => FOLD[c]);
}

/** Title without (feat. …), [Official Video], " - Remastered 2011" and punctuation. */
function baseTitle(s) {
  return fold(s)
    .replace(/[([{].*?[)\]}]/g, ' ')
    .replace(/\s(feat|ft|featuring)\.?\s.*$/, ' ')
    .replace(/\s[-–—]\s(?=.*\b(remaster(ed)?|edit|version|wersja|mono|stereo|bonus|mix|remix|live|acoustic|akustycznie|instrumental|demo)\b).*$/, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Version words that sit outside the base title ("Live and Let Die" is not a live version). */
function versionTags(s) {
  const all = fold(s), base = baseTitle(s);
  return VERSION_WORDS.filter(re => re.test(all) && !re.test(base)).map(re => re.source).join();
}

/** Bigram Dice similarity, 0–1, ignoring spaces. */
function dice(a, b) {
  const A = a.replace(/\s+/g, ''), B = b.replace(/\s+/g, '');
  if (A === B) return 1;
  if (A.length < 2 || B.length < 2) return 0;
  const grams = new Map();
  for (let i = 0; i < A.length - 1; i++) { const g = A.slice(i, i + 2); grams.set(g, (grams.get(g) || 0) + 1); }
  let hits = 0;
  for (let i = 0; i < B.length - 1; i++) {
    const g = B.slice(i, i + 2), n = grams.get(g);
    if (n) { hits++; grams.set(g, n - 1); }
  }
  return (2 * hits) / (A.length + B.length - 2);
}

const plainName = (s) => fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const artistParts = (s) => fold(s)
  .split(/\s*(?:,|&|\+|\/|;|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\band\b|\bi\b)\s*/)
  .map(plainName).filter(Boolean);

/** Best match between any of the credited artists ("Taco Hemingway & Quebonafide" ↔ "Quebonafide"). */
function artistSimilarity(a, b) {
  let best = dice(plainName(a), plainName(b));
  for (const x of artistParts(a)) for (const y of artistParts(b)) best = Math.max(best, dice(x, y));
  return best;
}

export const isUnknownArtist = (a) => UNKNOWN_ARTISTS.has(fold(a).trim());
const isUnknownAlbum = (a) => UNKNOWN_ALBUMS.has(fold(a).trim());
/** Title as a search term: no bracketed extras, no featured artists. */
const queryTitle = (s) => String(s || '').replace(/[([{].*?[)\]}]/g, ' ').replace(/\s(feat|ft|featuring)\.?\s.*$/i, ' ').replace(/\s+/g, ' ').trim();

/**
 * Picks the candidate that is this recording. `query` and candidates are
 * { title, artist, duration }. Returns { candidate, confidence: 'exact' | 'uncertain' } or null.
 * Without a known artist only a near-identical title with the same length from a
 * single artist counts as exact — common titles are shared by many songs.
 */
function pickMatch(query, candidates, { maxDiff, bonus = () => 0 }) {
  const qTitle = baseTitle(query.title);
  const qTags = versionTags(query.title);
  const scored = [];
  for (const c of candidates) {
    if (versionTags(c.title) !== qTags) continue;
    const titleSim = dice(qTitle, baseTitle(c.title));
    const artistSim = query.artist ? artistSimilarity(query.artist, c.artist) : 0;
    const diff = query.duration && c.duration ? Math.abs(query.duration - c.duration) : null;
    scored.push({ c, titleSim, artistSim, diff, rank: (diff ?? 0) / 10 - titleSim - artistSim - bonus(c) });
  }
  scored.sort((a, b) => a.rank - b.rank);

  if (query.artist) {
    const exact = scored.find(s => s.titleSim >= 0.85 && s.artistSim >= 0.8 && (s.diff === null || s.diff <= maxDiff));
    if (exact) return { candidate: exact.c, confidence: 'exact' };
  } else {
    const exact = scored.filter(s => s.titleSim >= 0.9 && s.diff !== null && s.diff <= Math.min(2, maxDiff));
    if (exact.length && new Set(exact.map(s => plainName(s.c.artist))).size === 1) return { candidate: exact[0].c, confidence: 'exact' };
  }
  const close = scored.find(s => s.titleSim >= 0.6 && (!query.artist || s.artistSim >= 0.5));
  return close ? { candidate: close.c, confidence: 'uncertain' } : null;
}

// ── Network ───────────────────────────────────────────────────
async function request(url, timeout, retry = true) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (e) {
    throw new OfflineError(e.message);
  } finally {
    clearTimeout(timer);
  }
  // A brief hiccup (LRCLIB answers 503 now and then) is worth one quick second try.
  if (retry && (res.status === 429 || res.status >= 500)) {
    await new Promise(r => setTimeout(r, 1500));
    return request(url, timeout, false);
  }
  // Rate limiting (iTunes answers 403) and server trouble are temporary: retry later rather than record "not found".
  if (res.status === 403 || res.status === 429 || res.status >= 500) throw new OfflineError(`HTTP ${res.status}`);
  return res;
}

async function getJson(url, timeout = 12000) {
  const res = await request(url, timeout);
  return res.ok ? res.json() : null;
}

const itunesCalls = [];
async function itunesSlot() {
  for (;;) {
    const now = Date.now();
    while (itunesCalls.length && now - itunesCalls[0] > 60000) itunesCalls.shift();
    if (itunesCalls.length < ITUNES_PER_MINUTE) { itunesCalls.push(now); return; }
    await new Promise(r => setTimeout(r, 60000 - (now - itunesCalls[0]) + 50));
  }
}

async function itunesSearch(term) {
  if (!term) return [];
  await itunesSlot();
  const params = new URLSearchParams({ term, media: 'music', entity: 'song', limit: '15', country: 'PL' });
  const data = await getJson(`${ITUNES}?${params}`);
  // Compilations ("Bravo Hits", credited to "Various Artists") would bring their own cover and album name.
  const compilation = (r) => /various artists|różni wykonawcy/i.test(r.collectionArtistName || '');
  return (data?.results || []).filter(r => r.kind === 'song' && !compilation(r)).map(r => ({
    id: r.trackId,
    title: r.trackName,
    artist: r.artistName,
    album: r.collectionName || '',
    duration: r.trackTimeMillis ? r.trackTimeMillis / 1000 : 0,
    year: r.releaseDate?.slice(0, 4) || '',
    genre: r.primaryGenreName || '',
    artwork: r.artworkUrl100?.replace(/\/\d+x\d+bb\.\w+$/, `/${COVER_SIZE}x${COVER_SIZE}bb.jpg`),
  }));
}

/** "Szampan - Single" → the app's own "Singiel"; "Name - EP" → "Name". */
function albumName(collection) {
  if (/\s-\sSingle$/i.test(collection)) return 'Singiel';
  return collection.replace(/\s-\sEP$/i, '').trim();
}

async function searchCatalog(query) {
  const title = queryTitle(query.title);
  let results = await itunesSearch(query.artist ? `${query.artist} ${title}` : title);
  if (!results.length && query.artist) results = await itunesSearch(title); // artist spelled differently
  // Prefer the album release over the single of the same recording.
  return pickMatch(query, results, { maxDiff: 30, bonus: c => (/\s-\sSingle$/i.test(c.album) ? 0 : 0.15) });
}

async function fetchCover(url) {
  const res = await request(url, 15000);
  if (!res.ok) return null;
  const blob = await res.blob();
  return blob.type.startsWith('image/') ? blob : null;
}

const lyricsCandidate = (rec) => ({ title: rec.trackName, artist: rec.artistName, duration: rec.duration, rec });

/** LRCLIB record for this recording, or null. Tries the catalogue names first, then the file's own. */
async function findLyrics(query, hit) {
  const strict = { title: hit?.title || query.title, artist: hit?.artist || query.artist, duration: query.duration };
  const attempts = [];
  if (hit) attempts.push({ artist: hit.artist, title: hit.title });
  if (query.artist && !(hit && fold(hit.artist) === fold(query.artist) && fold(hit.title) === fold(query.title))) {
    attempts.push({ artist: query.artist, title: queryTitle(query.title) });
  }

  for (const a of attempts) {
    const params = new URLSearchParams({ artist_name: a.artist, track_name: a.title });
    if (query.duration) params.set('duration', String(Math.round(query.duration)));
    const rec = await getJson(`${LRCLIB}/get?${params}`, 15000);
    if (rec && pickMatch(strict, [lyricsCandidate(rec)], { maxDiff: 3 })?.confidence === 'exact') return rec;
  }

  const first = attempts[0] || { artist: '', title: queryTitle(query.title) };
  const params = new URLSearchParams({ track_name: first.title });
  if (first.artist) params.set('artist_name', first.artist);
  const list = await getJson(`${LRCLIB}/search?${params}`, 15000);
  if (!Array.isArray(list)) return null;
  const match = pickMatch(strict, list.map(lyricsCandidate), { maxDiff: 3, bonus: c => (c.rec.syncedLyrics ? 0.5 : 0) });
  return match?.confidence === 'exact' ? match.candidate.rec : null;
}

// ── Public API ────────────────────────────────────────────────
/** Whether a lookup could still add something: a cover, the artist, or synced lyrics. */
export function needsEnrich(track) {
  return !track.coverBlob || isUnknownArtist(track.artist) || (!track.enrich?.lyricsLocked && !parseLyrics(track.lyrics)?.synced);
}

/**
 * Looks up whatever `track` is missing. Returns { changes, report }: `changes`
 * is ready for updateTrack and only touches empty fields; `report` is
 * { match: 'exact' | 'uncertain' | 'none' | 'skipped', instrumental }.
 * Throws OfflineError when the network failed.
 */
export async function enrichTrack(track) {
  const knownArtist = !isUnknownArtist(track.artist);
  const query = { title: track.title, artist: knownArtist ? track.artist : '', duration: track.duration || 0 };
  const changes = {};
  const report = { match: 'skipped', instrumental: false };
  const current = parseLyrics(track.lyrics);

  let hit = null;
  if (!track.coverBlob || !knownArtist) {
    const found = await searchCatalog(query);
    report.match = found?.confidence || 'none';
    if (found?.confidence === 'exact') hit = found.candidate;
  }

  if (hit) {
    if (!track.coverBlob && hit.artwork) {
      const blob = await fetchCover(hit.artwork);
      if (blob) { changes.coverBlob = blob; changes.coverUrl = URL.createObjectURL(blob); }
    }
    // Without an artist the title came from the file name too — the catalogue's spelling is better.
    if (!knownArtist) { changes.artist = hit.artist; changes.title = hit.title; }
    if (isUnknownAlbum(track.album) && hit.album) changes.album = albumName(hit.album);
    if (!track.year && hit.year) changes.year = hit.year;
    if (!track.genre && hit.genre) changes.genre = hit.genre;
  }

  if (!track.enrich?.lyricsLocked && !current?.synced) {
    const rec = await findLyrics(query, hit);
    if (rec?.instrumental) report.instrumental = true;
    else if (rec?.syncedLyrics) changes.lyrics = rec.syncedLyrics;
    else if (rec?.plainLyrics && !current) changes.lyrics = rec.plainLyrics;
  }

  return { changes, report };
}
