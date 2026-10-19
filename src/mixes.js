import { usePlayerStore } from './store';
import { showToast } from './App';

const DAY = 86400000;

export function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Weighted random sample (Efraimidis–Spirakis): rarely played tracks win more often. */
function surprisePick(tracks, count = 30) {
  return tracks
    .map(t => ({ t, key: Math.random() ** (1 + (t.playCount || 0)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map(x => x.t);
}

export function timeOfDayName(hour) {
  if (hour >= 5 && hour < 11) return 'Poranny rozruch';
  if (hour >= 11 && hour < 17) return 'Dzienny flow';
  if (hour >= 17 && hour < 22) return 'Wieczorny chill';
  return 'Nocna zmiana';
}

const countBy = (entries) => {
  const map = new Map();
  for (const id of entries) map.set(id, (map.get(id) || 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};

// ── Auto-DJ ───────────────────────────────────────────────────
// BPM distance that treats half/double time as neighbours (a 70 BPM ballad sits fine next to 140).
const bpmGap = (a, b) => Math.min(Math.abs(a - b), Math.abs(a - 2 * b), Math.abs(2 * a - b));

/**
 * Orders analysed tracks into a set: energy climbs to a peak around two thirds
 * of the way through, then cools down; within that arc each next track is the
 * closest tempo among the nearest candidates.
 */
export function buildAutoDjSet(tracks) {
  const pool = tracks.filter(t => t.analysis?.bpm && typeof t.analysis.energy === 'number');
  if (pool.length < 4) return [];
  const byEnergy = [...pool].sort((a, b) => a.analysis.energy - b.analysis.energy);
  const rise = [], fall = [];
  byEnergy.forEach((t, i) => (i % 3 === 2 ? fall : rise).push(t));
  const arc = [...rise, ...fall.reverse()];

  const set = [arc.shift()];
  while (arc.length) {
    const prev = set[set.length - 1].analysis.bpm;
    let best = 0;
    for (let i = 1; i < Math.min(3, arc.length); i++) {
      if (bpmGap(prev, arc[i].analysis.bpm) < bpmGap(prev, arc[best].analysis.bpm)) best = i;
    }
    set.push(arc.splice(best, 1)[0]);
  }
  return set;
}

export function playAutoDj(tracks) {
  const set = buildAutoDjSet(tracks);
  if (!set.length) {
    showToast('Auto-DJ potrzebuje co najmniej 4 przeanalizowanych utworów', 'info');
    return;
  }
  const player = usePlayerStore.getState();
  usePlayerStore.setState({ shuffle: false }); // the order *is* the feature
  if (!player.crossfadeSeconds) player.setCrossfadeSeconds(6);
  player.loadAndPlay(set[0], set, 0);
  const bpms = set.map(t => t.analysis.bpm);
  showToast(`Auto-DJ: ${set.length} utworów, ${Math.min(...bpms)}–${Math.max(...bpms)} BPM, crossfade ${usePlayerStore.getState().crossfadeSeconds} s`, 'success');
}

/**
 * Auto-generated mixes built from the library and the local listening log.
 * A mix only shows up when it would actually differ from "play everything".
 */
export function buildSmartMixes(tracks, playLog, now = Date.now()) {
  if (!tracks.length) return [];
  const byId = new Map(tracks.map(t => [t.id, t]));
  const hour = new Date(now).getHours();
  const mixes = [];

  mixes.push({
    id: 'surprise', icon: 'dice', name: 'Zaskocz mnie',
    desc: 'Losowo, z naciskiem na to, czego rzadko słuchasz',
    tracks: surprisePick(tracks),
  });

  const djSet = buildAutoDjSet(tracks);
  if (djSet.length) {
    mixes.push({
      id: 'autodj', icon: 'wave', name: 'Auto-DJ',
      desc: 'Rozgrzewka, szczyt, wyciszenie — z płynnym tempem',
      tracks: djSet,
      play: () => playAutoDj(tracks),
    });
  }

  const hourIds = playLog
    .filter(e => {
      const d = Math.abs(new Date(e.ts).getHours() - hour);
      return Math.min(d, 24 - d) <= 1 && byId.has(e.id);
    })
    .map(e => e.id);
  const hourMix = countBy(hourIds).slice(0, 30).map(([id]) => byId.get(id));
  if (hourMix.length >= 3) {
    mixes.push({ id: 'hour', icon: 'clock', name: timeOfDayName(hour), desc: `To, czego zwykle słuchasz około ${hour}:00`, tracks: hourMix });
  }

  const recentIds = playLog.filter(e => now - e.ts < 14 * DAY && byId.has(e.id)).map(e => e.id);
  const onRepeat = countBy(recentIds).slice(0, 25).map(([id]) => byId.get(id));
  if (onRepeat.length >= 2) {
    mixes.push({ id: 'repeat', icon: 'flame', name: 'Na repeat', desc: 'Twoje hity z ostatnich 2 tygodni', tracks: onRepeat });
  }

  const forgotten = tracks
    .filter(t => !t.lastPlayedAt || now - t.lastPlayedAt > 30 * DAY)
    .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  if (playLog.length > 0 && forgotten.length >= 3) {
    mixes.push({ id: 'forgotten', icon: 'gem', name: 'Zapomniane perełki', desc: 'Nie grane od miesiąca albo wcale', tracks: forgotten.slice(0, 40) });
  }

  const fresh = tracks.filter(t => now - (t.dateAdded || 0) < 14 * DAY).sort((a, b) => b.dateAdded - a.dateAdded);
  if (fresh.length >= 2 && fresh.length < tracks.length) {
    mixes.push({ id: 'fresh', icon: 'sparkles', name: 'Świeżynki', desc: 'Dodane w ciągu 2 tygodni', tracks: fresh });
  }

  const favs = tracks.filter(t => t.favorite);
  if (favs.length >= 3) {
    mixes.push({ id: 'favs', icon: 'heart', name: 'Serce na shuffle', desc: 'Ulubione w losowej kolejności', tracks: favs });
  }

  const quick = tracks.filter(t => t.duration && t.duration < 210);
  if (quick.length >= 3 && quick.length < tracks.length) {
    mixes.push({ id: 'quick', icon: 'zap', name: 'Szybkie strzały', desc: 'Wszystko poniżej 3:30', tracks: quick });
  }

  const long = tracks.filter(t => t.duration > 360);
  if (long.length >= 2 && long.length < tracks.length) {
    mixes.push({ id: 'long', icon: 'infinity', name: 'Długie odloty', desc: 'Kawałki powyżej 6 minut', tracks: long });
  }

  return mixes;
}

/** Plays a mix object (Auto-DJ keeps its own order) or a plain track array shuffled. */
export function playSmartMix(mix) {
  if (mix.play) mix.play();
  else playMix(mix.tracks);
}

export function playMix(mixTracks) {
  if (!mixTracks?.length) return;
  const queue = shuffled(mixTracks);
  usePlayerStore.getState().loadAndPlay(queue[0], queue, 0);
}
