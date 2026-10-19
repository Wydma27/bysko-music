/**
 * Parses lyrics text. Understands LRC ("[01:23.45] line", several stamps per
 * line, [offset:±ms]) and falls back to plain, unsynchronised text.
 * Returns { synced: boolean, lines: [{ time: number|null, text }] } or null.
 */
export function parseLyrics(text) {
  if (!text || !text.trim()) return null;
  const timed = [];
  const plain = [];
  let offset = 0;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const off = line.match(/^\[offset:\s*([+-]?\d+)\s*\]$/i);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    if (/^\[[a-z]+:[^\]]*\]$/i.test(line)) continue; // [ar:…] [ti:…] metadata tags

    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    // Drop line stamps and enhanced-LRC word stamps (<01:23.45>) alike.
    const content = line.replace(/\[[^\]]*\]|<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').replace(/\s{2,}/g, ' ').trim();
    if (stamps.length) {
      for (const s of stamps) timed.push({ time: Number(s[1]) * 60 + parseFloat(s[2].replace(':', '.')), text: content });
    } else {
      plain.push({ time: null, text: content });
    }
  }

  if (timed.length) {
    return {
      synced: true,
      lines: timed.map(l => ({ ...l, time: Math.max(0, l.time - offset) })).sort((a, b) => a.time - b.time),
    };
  }
  // Collapse runs of blank lines into a single stanza break.
  const lines = plain.filter((l, i) => l.text || (i > 0 && plain[i - 1].text));
  return lines.length ? { synced: false, lines } : null;
}

/** Index of the line that should be highlighted at `time` (binary search), or -1 before the first line. */
export function activeLineIndex(lines, time) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= time) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
