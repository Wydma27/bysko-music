import { persona } from './stats';

// Renders 1080×1920 story-format share images on a canvas: "Teraz słucham"
// for a track and "Mój miesiąc" for the last 30 days of listening.

const W = 1080;
const H = 1920;
const BG = '#0b0a12';

const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function loadImage(src) {
  return new Promise(resolve => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load('700 80px "Space Grotesk"'),
      document.fonts.load('600 40px "Plus Jakarta Sans"'),
      document.fonts.load('800 40px "Plus Jakarta Sans"'),
    ]);
  } catch {}
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

function fitText(ctx, text, maxWidth) {
  let t = String(text);
  if (ctx.measureText(t).width <= maxWidth) return t;
  while (ctx.measureText(`${t}…`).width > maxWidth && t.length) t = t.slice(0, -1);
  return `${t}…`;
}

function backdrop(ctx, accent, accent2, cover) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  if (cover) {
    ctx.save();
    ctx.filter = 'blur(70px) saturate(1.3)';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(cover, -300, -300, W + 600, W + 600);
    ctx.restore();
  }
  const glow = (x, y, r, color, alpha) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'transparent');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  };
  glow(150, 200, 900, accent, 0.45);
  glow(950, 1750, 900, accent2, 0.35);
  const fade = ctx.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, 'rgba(11,10,18,0.15)');
  fade.addColorStop(0.55, 'rgba(11,10,18,0.55)');
  fade.addColorStop(1, 'rgba(11,10,18,0.95)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, H);
}

function brand(ctx, accent, accent2, y) {
  const g = ctx.createLinearGradient(0, y, 72, y + 72);
  g.addColorStop(0, accent);
  g.addColorStop(1, accent2);
  const x = W / 2 - 190;
  ctx.fillStyle = g;
  roundedRect(ctx, x, y, 72, 72, 24);
  ctx.fill();
  ctx.fillStyle = BG;
  [[14, 30, 12], [25, 22, 28], [36, 14, 44], [47, 24, 24], [58, 30, 12]].forEach(([bx, by, bh]) => {
    roundedRect(ctx, x + bx - 3, y + by, 6, bh, 3);
    ctx.fill();
  });
  ctx.fillStyle = '#f4f1ff';
  ctx.font = '700 46px "Space Grotesk", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('BySko Music', x + 96, y + 38);
}

function kicker(ctx, text, y, color) {
  ctx.font = '800 30px "Plus Jakarta Sans", sans-serif';
  ctx.letterSpacing = '8px';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, W / 2, y);
  ctx.letterSpacing = '0px';
}

const toBlob = (canvas) => new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

export async function renderTrackCard(track) {
  await ensureFonts();
  const accent = cssVar('--accent', '#a78bfa');
  const accent2 = cssVar('--accent-2', '#ff6ba6');
  const cover = await loadImage(track.coverUrl);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  backdrop(ctx, accent, accent2, cover);

  kicker(ctx, 'TERAZ SŁUCHAM', 250, accent);

  const size = 760, cx = (W - size) / 2, cy = 330;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 90;
  ctx.shadowOffsetY = 40;
  roundedRect(ctx, cx, cy, size, size, 56);
  ctx.fillStyle = '#1b1828';
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundedRect(ctx, cx, cy, size, size, 56);
  ctx.clip();
  if (cover) ctx.drawImage(cover, cx, cy, size, size);
  else {
    const g = ctx.createLinearGradient(cx, cy, cx + size, cy + size);
    g.addColorStop(0, accent); g.addColorStop(1, accent2);
    ctx.fillStyle = g; ctx.fillRect(cx, cy, size, size);
  }
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 84px "Space Grotesk", sans-serif';
  const titleLines = wrapLines(ctx, track.title, 900, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, W / 2, 1230 + i * 96));
  const afterTitle = 1230 + (titleLines.length - 1) * 96;
  ctx.font = '600 46px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = '#cfc9ea';
  ctx.fillText(fitText(ctx, track.artist, 900), W / 2, afterTitle + 80);

  // Waveform strip (real loudness curve when the track has been analysed).
  const points = track.analysis?.waveform || Array.from({ length: 160 }, (_, i) => 35 + 30 * Math.abs(Math.sin(i / 7)));
  const bars = 64, bw = 9, gap = (900 - bars * bw) / (bars - 1), top = afterTitle + 180, hMax = 150;
  const grad = ctx.createLinearGradient(90, 0, 990, 0);
  grad.addColorStop(0, accent); grad.addColorStop(1, accent2);
  for (let i = 0; i < bars; i++) {
    const v = points[Math.floor((i / bars) * points.length)] / 100;
    const h = Math.max(10, v * hMax);
    ctx.fillStyle = i < bars * 0.42 ? grad : 'rgba(255,255,255,0.28)';
    roundedRect(ctx, 90 + i * (bw + gap), top + (hMax - h) / 2, bw, h, bw / 2);
    ctx.fill();
  }

  brand(ctx, accent, accent2, 1760);
  return toBlob(canvas);
}

export async function renderMonthCard(stats, userName) {
  await ensureFonts();
  const accent = cssVar('--accent', '#a78bfa');
  const accent2 = cssVar('--accent-2', '#ff6ba6');
  const covers = await Promise.all(stats.topTracks.map(t => loadImage(t.track.coverUrl)));
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  backdrop(ctx, accent, accent2, covers[0]);

  const month = new Date().toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
  kicker(ctx, userName ? `MÓJ MIESIĄC · ${userName.toUpperCase()}` : 'MÓJ MIESIĄC W MUZYCE', 200, accent);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#cfc9ea';
  ctx.font = '600 40px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(month.charAt(0).toUpperCase() + month.slice(1), W / 2, 262);

  const p = persona(stats);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 118px "Space Grotesk", sans-serif';
  ctx.fillText(p.time, W / 2, 420);
  ctx.fillStyle = '#cfc9ea';
  ctx.font = '600 36px "Plus Jakarta Sans", sans-serif';
  wrapLines(ctx, `Szczyt około ${stats.peakHour}:00 — ${p.style}`, 880, 2).forEach((l, i) => ctx.fillText(l, W / 2, 500 + i * 48));

  // Three big numbers
  const tiles = [[stats.plays, 'odtworzeń'], [stats.minutes, 'minut'], [stats.unique, 'utworów']];
  tiles.forEach(([value, label], i) => {
    const x = 90 + i * 310;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    roundedRect(ctx, x, 620, 280, 190, 36);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 80px "Space Grotesk", sans-serif';
    ctx.fillText(String(value), x + 140, 725);
    ctx.fillStyle = '#cfc9ea';
    ctx.font = '600 32px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(label, x + 140, 775);
  });

  kicker(ctx, 'TOP 5', 920, accent);
  stats.topTracks.forEach(({ track, count }, i) => {
    const y = 970 + i * 138;
    ctx.textAlign = 'left';
    ctx.fillStyle = accent;
    ctx.font = '700 52px "Space Grotesk", sans-serif';
    ctx.fillText(String(i + 1), 100, y + 72);
    ctx.save();
    roundedRect(ctx, 170, y, 110, 110, 22);
    ctx.clip();
    if (covers[i]) ctx.drawImage(covers[i], 170, y, 110, 110);
    else { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(170, y, 110, 110); }
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 44px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(fitText(ctx, track.title, 560), 310, y + 50);
    ctx.fillStyle = '#cfc9ea';
    ctx.font = '600 32px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(fitText(ctx, track.artist, 560), 310, y + 94);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 40px "Space Grotesk", sans-serif';
    ctx.fillText(`${count}×`, 980, y + 70);
  });

  brand(ctx, accent, accent2, 1760);
  return toBlob(canvas);
}
