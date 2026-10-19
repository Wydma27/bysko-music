import { create } from 'zustand';

// ── Accent palettes ───────────────────────────────────────────
// Each palette has a bright pair for the dark UI and a deeper pair for the
// light UI (so accent-colored text keeps enough contrast on white).
export const ACCENTS = [
  { id: 'nocturne', name: 'Nocturne', desc: 'Fiolet × róż', dark: ['#a78bfa', '#ff6ba6'], light: ['#6d4ae0', '#c2255c'] },
  { id: 'ember', name: 'Żar', desc: 'Pomarańcz × złoto', dark: ['#ff8a4c', '#ffc857'], light: ['#c2410c', '#a16207'] },
  { id: 'ocean', name: 'Głębia', desc: 'Błękit × indygo', dark: ['#4cc9f0', '#8b93ff'], light: ['#0369a1', '#4f46e5'] },
  { id: 'sakura', name: 'Sakura', desc: 'Róż × brzoskwinia', dark: ['#ff7eb6', '#ffb38a'], light: ['#be185d', '#c2410c'] },
  { id: 'aurora', name: 'Zorza', desc: 'Turkus × lawenda', dark: ['#5eead4', '#c4b5fd'], light: ['#0d7a70', '#7c3aed'] },
  { id: 'mono', name: 'Grafit', desc: 'Minimalizm bez koloru', dark: ['#e8e6f0', '#9d98b3'], light: ['#1a1726', '#585370'] },
  { id: 'dynamic', name: 'Kameleon', desc: 'Kolor bierze się z okładki grającego utworu', dynamic: true, dark: ['#a78bfa', '#ff6ba6'], light: ['#6d4ae0', '#c2255c'] },
];

// ── Color helpers ─────────────────────────────────────────────
export function parseColor(str) {
  if (!str) return null;
  const hex = str.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
  const rgb = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return null;
}

const toHex = (rgb) => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const shiftLightness = (hex, delta) => {
  const [h, s, l] = rgbToHsl(parseColor(hex));
  return toHex(hslToRgb([h, s, Math.max(0, Math.min(1, l + delta))]));
};

/** Turns a raw cover color into a usable accent pair for the given mode. */
export function accentPairFromCover(color, mode) {
  const rgb = parseColor(color);
  if (!rgb) return null;
  let [h, s, l] = rgbToHsl(rgb);
  s = Math.max(s, 0.55);
  l = mode === 'dark' ? Math.min(0.74, Math.max(0.62, l)) : Math.min(0.42, Math.max(0.34, l));
  return [toHex(hslToRgb([h, s, l])), toHex(hslToRgb([h + 40, s, l]))];
}

// ── Persisted UI preferences ──────────────────────────────────
const read = (key, fallback) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, value); } catch {}
};

export const useUiStore = create((set, get) => ({
  mode: read('bysko-theme', 'dark'),
  accentId: read('bysko-accent', 'nocturne'),
  ambient: read('bysko-ambient', 'on') !== 'off',
  reactiveGlow: read('bysko-reactive', 'on') !== 'off',
  visualizerStyle: read('bysko-viz', 'bars'), // 'bars' | 'wave' | 'mirror'
  dynamicColor: null,

  showPalette: false,
  showVibe: false,
  showAppearance: false,
  showFocus: false,
  showParty: false,
  showPassword: false,
  showLyrics: false,
  partyPrefill: '',
  share: null, // { kind: 'track', trackId } | { kind: 'month' }

  setMode(mode) { write('bysko-theme', mode); set({ mode }); applyTheme(); },
  toggleMode() { get().setMode(get().mode === 'dark' ? 'light' : 'dark'); },
  setAccent(accentId) { write('bysko-accent', accentId); set({ accentId }); applyTheme(); },
  setDynamicColor(dynamicColor) {
    if (!dynamicColor || dynamicColor === get().dynamicColor) return;
    set({ dynamicColor });
    if (get().accentId === 'dynamic') applyTheme();
  },
  toggleAmbient() { const v = !get().ambient; write('bysko-ambient', v ? 'on' : 'off'); set({ ambient: v }); },
  toggleReactiveGlow() { const v = !get().reactiveGlow; write('bysko-reactive', v ? 'on' : 'off'); set({ reactiveGlow: v }); },
  setVisualizerStyle(visualizerStyle) { write('bysko-viz', visualizerStyle); set({ visualizerStyle }); },
  cycleVisualizer() {
    const order = ['bars', 'wave', 'mirror'];
    get().setVisualizerStyle(order[(order.indexOf(get().visualizerStyle) + 1) % order.length]);
  },

  setShowPalette(showPalette) { set({ showPalette }); },
  setShowVibe(showVibe) { set({ showVibe }); },
  setShowAppearance(showAppearance) { set({ showAppearance }); },
  setShowFocus(showFocus) { set({ showFocus }); },
  setShowParty(showParty, partyPrefill = '') { set({ showParty, partyPrefill }); },
  setShowPassword(showPassword) { set({ showPassword }); },
  setShowLyrics(showLyrics) { set({ showLyrics }); },
  setShare(share) { set({ share }); },
}));

// ── Applying the theme ────────────────────────────────────────
// Besides the main document, a Picture-in-Picture mini player registers its own
// document here so it follows palette changes live.
const themeTargets = new Set();

export function addThemeTarget(doc) {
  themeTargets.add(doc);
  applyTheme();
  return () => themeTargets.delete(doc);
}

export function computeThemeVars() {
  const { mode, accentId, dynamicColor } = useUiStore.getState();
  const palette = ACCENTS.find(a => a.id === accentId) || ACCENTS[0];
  const pair = (palette.dynamic && accentPairFromCover(dynamicColor, mode)) || palette[mode] || palette.dark;
  const [accent, accent2] = pair;
  const rgb = parseColor(accent);
  return {
    '--accent': accent,
    '--accent-2': accent2,
    '--accent-rgb': rgb.join(', '),
    '--accent-hover': shiftLightness(accent, mode === 'dark' ? 0.07 : -0.06),
    '--accent-contrast': luminance(rgb) > 0.36 ? '#0b0a12' : '#ffffff',
  };
}

export function applyTheme() {
  if (typeof document === 'undefined') return;
  const { mode } = useUiStore.getState();
  const vars = computeThemeVars();
  const docs = [document, ...themeTargets];
  for (const doc of docs) {
    const root = doc.documentElement;
    root.setAttribute('data-theme', mode);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#0b0a12' : '#efedf6');
}

// Apply saved preferences as soon as the module loads, before the first paint.
applyTheme();
