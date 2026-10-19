/**
 * analysis.js — one-off offline analysis of a track, stored with it in IndexedDB.
 *   waveform: 160 loudness points (0–100) for the seek bar and share cards
 *   bpm:      tempo estimate from onset autocorrelation (folded into 85–175)
 *   energy:   0–1 mix of loudness and "punch" (how hard the onsets hit)
 * Everything is heuristic — good enough to order an Auto-DJ set, not a DJ tool.
 */

export const ANALYSIS_VERSION = 1;
const WAVE_POINTS = 160;
const MAX_SECONDS = 20 * 60; // decoding longer files would need hundreds of MB of RAM

let decodeCtx = null;
function decoder() {
  if (!decodeCtx) decodeCtx = new OfflineAudioContext(1, 1, 44100);
  return decodeCtx;
}

function decode(arrayBuffer) {
  // Older Safari only has the callback form.
  return new Promise((resolve, reject) => {
    const p = decoder().decodeAudioData(arrayBuffer, resolve, reject);
    if (p?.then) p.then(resolve, reject);
  });
}

function mono(buffer) {
  const a = buffer.getChannelData(0);
  if (buffer.numberOfChannels < 2) return a;
  const b = buffer.getChannelData(1);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) * 0.5;
  return out;
}

function waveform(samples) {
  const bucket = Math.max(1, Math.floor(samples.length / WAVE_POINTS));
  const rms = new Array(WAVE_POINTS).fill(0);
  for (let p = 0; p < WAVE_POINTS; p++) {
    const start = p * bucket;
    const end = Math.min(samples.length, start + bucket);
    let sum = 0, n = 0;
    for (let i = start; i < end; i += 8) { sum += samples[i] * samples[i]; n++; }
    rms[p] = n ? Math.sqrt(sum / n) : 0;
  }
  const max = Math.max(...rms, 1e-6);
  // Gentle curve so quiet intros stay visible next to a loud chorus.
  return { points: rms.map(v => Math.round(Math.pow(v / max, 0.7) * 100)), loudness: rms.reduce((s, v) => s + v, 0) / WAVE_POINTS };
}

function tempo(samples, sampleRate) {
  // Analyse up to 60 s from the middle of the track — intros and outros lie about the groove.
  const span = Math.min(samples.length, sampleRate * 60);
  const from = Math.max(0, Math.floor((samples.length - span) / 2));
  const hop = 512;
  const frames = Math.floor(span / hop);
  if (frames < 200) return { bpm: null, punch: 0 };

  // Low-passed frame energy emphasises kick and bass.
  const a = 1 - Math.exp((-2 * Math.PI * 150) / sampleRate);
  let lp = 0;
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const base = from + f * hop;
    for (let i = 0; i < hop; i++) {
      lp += a * (samples[base + i] - lp);
      e += lp * lp;
    }
    env[f] = Math.log1p(e * 1000);
  }

  const onset = new Float32Array(frames);
  let onsetSum = 0, envSum = 0;
  for (let f = 1; f < frames; f++) {
    onset[f] = Math.max(0, env[f] - env[f - 1]);
    onsetSum += onset[f];
    envSum += env[f];
  }

  const fps = sampleRate / hop;
  const minLag = Math.floor((60 / 180) * fps);
  const maxLag = Math.ceil((60 / 70) * fps);
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let f = 0; f + lag < frames; f++) s += onset[f] * onset[f + lag];
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2); // mild pull towards ~120 against octave errors
    scores.push(s * prior);
  }
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  // Parabolic refinement between neighbouring lags.
  const l = scores[best - 1] ?? scores[best], c = scores[best], r = scores[best + 1] ?? scores[best];
  const shift = (l - r) / (2 * (l - 2 * c + r) || 1);
  let bpm = (60 * fps) / (minLag + best + (Number.isFinite(shift) ? Math.max(-0.5, Math.min(0.5, shift)) : 0));
  while (bpm < 85) bpm *= 2;
  while (bpm > 175) bpm /= 2;

  const punch = envSum ? onsetSum / envSum : 0;
  return { bpm: Math.round(bpm), punch };
}

export async function analyzeAudio(blob) {
  const buffer = await decode(await blob.arrayBuffer());
  if (buffer.duration > MAX_SECONDS) return { v: ANALYSIS_VERSION, skipped: true };
  const samples = mono(buffer);
  const wave = waveform(samples);
  const { bpm, punch } = tempo(samples, buffer.sampleRate);
  const loud = Math.min(1, Math.max(0, (wave.loudness - 0.04) / 0.22));
  const hit = Math.min(1, punch * 6);
  return {
    v: ANALYSIS_VERSION,
    waveform: wave.points,
    bpm,
    energy: Math.round((0.65 * loud + 0.35 * hit) * 100) / 100,
  };
}
