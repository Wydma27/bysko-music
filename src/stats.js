// Listening statistics shared by "Twój puls", the share cards and artist pages.

const DAY = 86400000;
const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

export function computeStats(tracks, playLog, { sinceDays } = {}) {
  const byId = new Map(tracks.map(t => [t.id, t]));
  const since = sinceDays ? Date.now() - sinceDays * DAY : 0;
  const entries = playLog.filter(e => e.ts >= since && byId.has(e.id));
  const hours = Array(24).fill(0);
  const weekdays = Array(7).fill(0);
  const trackCounts = new Map();
  const artistCounts = new Map();
  let seconds = 0;

  for (const e of entries) {
    const t = byId.get(e.id);
    const d = new Date(e.ts);
    hours[d.getHours()]++;
    weekdays[d.getDay()]++;
    trackCounts.set(e.id, (trackCounts.get(e.id) || 0) + 1);
    artistCounts.set(t.artist, (artistCounts.get(t.artist) || 0) + 1);
    seconds += t.duration || 0;
  }

  const days = new Set(entries.map(e => dayKey(e.ts)));
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }

  const topTracks = [...trackCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, count]) => ({ track: byId.get(id), count }));
  const topArtists = [...artistCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({
    name, count, cover: tracks.find(t => t.artist === name && t.coverUrl)?.coverUrl,
  }));

  const peakHour = hours.indexOf(Math.max(...hours));
  const variety = entries.length ? trackCounts.size / entries.length : 0;
  return { plays: entries.length, minutes: Math.round(seconds / 60), unique: trackCounts.size, streak, hours, weekdays, topTracks, topArtists, peakHour, variety };
}

export function persona({ peakHour, variety }) {
  const time = peakHour >= 22 || peakHour < 5 ? 'Nocny marek'
    : peakHour < 11 ? 'Ranny ptaszek'
    : peakHour < 17 ? 'Dzienny zawodnik'
    : 'Wieczorny marzyciel';
  const style = variety > 0.7 ? 'odkrywca, który rzadko wraca do tego samego'
    : variety < 0.35 ? 'wierny fan swoich hitów'
    : 'balans między ulubionymi a nowościami';
  return { time, style };
}

/** Rank (1-based) and play count of every artist in the log, for the artist page badge. */
export function artistRanks(tracks, playLog) {
  const byId = new Map(tracks.map(t => [t.id, t]));
  const counts = new Map();
  for (const e of playLog) {
    const t = byId.get(e.id);
    if (t) counts.set(t.artist, (counts.get(t.artist) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return new Map(ranked.map(([name, count], i) => [name, { rank: i + 1, count }]));
}

/** Focus minutes in the last `days` days. */
export function focusMinutes(focusLog, days = 7) {
  const since = Date.now() - days * DAY;
  return focusLog.filter(f => f.ts >= since).reduce((s, f) => s + f.minutes, 0);
}
