import { create } from 'zustand';
import {
  saveTrack as dbSaveTrack, getAllTracks, deleteTrack as dbDeleteTrack, updateTrack as dbUpdateTrack,
  getAllPlaylists, savePlaylist as dbSavePlaylist, deletePlaylist as dbDeletePlaylist,
  getSetting, setSetting, getAllUsers, getUserByUsername, getUserByIdentifier, saveUser as dbSaveUser, deleteUser as dbDeleteUser,
} from './db';
import { withHashedPassword, verifyPassword } from './auth';
import { exportLibrary as packLibrary, parseBackupFile, unpackTrack } from './backup';
import { formatPlural } from './metadata';
import { analyzeAudio } from './analysis';
import { enrichTrack, needsEnrich, OfflineError, ENRICH_VERSION } from './enrich';
import { showToast } from './App';

const UNDO_GRACE_MS = 5000;
const PLAY_LOG_MAX = 5000;

// ── Color Extractor ───────────────────────────────────────────
async function extractDominantColor(imgUrl) {
  return new Promise((resolve) => {
    if (!imgUrl) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 16; canvas.height = 16;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 16, 16);
        const data = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          // Skip near-black and near-white pixels
          const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
          if (brightness > 20 && brightness < 235) {
            r += data[i]; g += data[i+1]; b += data[i+2]; count++;
          }
        }
        if (count === 0) { resolve(null); return; }
        // Boost saturation slightly
        const rr = Math.min(255, Math.round(r / count * 1.1));
        const gg = Math.min(255, Math.round(g / count * 1.1));
        const bb = Math.min(255, Math.round(b / count * 1.1));
        resolve(`rgb(${rr},${gg},${bb})`);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = imgUrl;
  });
}

// ── Vibe FX presets (speed / pitch / reverb / 8D / lo-fi / bass) ──
export const DEFAULT_FX = { speed: 1, preservePitch: true, reverb: 0, eightD: false, lofi: false, bass: 0 };
export const FX_PRESETS = [
  { id: 'normal', name: 'Czysty', desc: 'Oryginał, bez efektów', fx: DEFAULT_FX },
  { id: 'nightcore', name: 'Nightcore', desc: 'Szybciej i wyżej', fx: { ...DEFAULT_FX, speed: 1.25, preservePitch: false, reverb: 0.1, bass: 2 } },
  { id: 'slowed', name: 'Slowed + Reverb', desc: 'Wolno, nisko, z pogłosem', fx: { ...DEFAULT_FX, speed: 0.85, preservePitch: false, reverb: 0.45, bass: 3 } },
  { id: '8d', name: 'Audio 8D', desc: 'Dźwięk krąży wokół głowy — załóż słuchawki', fx: { ...DEFAULT_FX, reverb: 0.2, eightD: true } },
  { id: 'lofi', name: 'Lo-fi', desc: 'Stłumione, ciepłe, jak z kasety', fx: { ...DEFAULT_FX, speed: 0.95, preservePitch: false, reverb: 0.15, lofi: true, bass: 2 } },
  { id: 'bass', name: 'Bass Boost', desc: 'Dół na maksa', fx: { ...DEFAULT_FX, bass: 10 } },
  { id: 'hall', name: 'Sala koncertowa', desc: 'Przestrzeń jak na żywo', fx: { ...DEFAULT_FX, reverb: 0.6 } },
];

const sameFx = (a, b) => Object.keys(DEFAULT_FX).every(k => a[k] === b[k]);
export const findFxPreset = (fx) => FX_PRESETS.find(p => sameFx(p.fx, fx))?.id || 'custom';

// ── Web Audio API setup ──
// source → 5-band EQ → bass shelf → lo-fi lowpass → 8D panner ─┬─ dry ──────────┬→ crossfade gain → analyser → out
//                                                            └─ reverb → wet ─┘
export const EQ_FREQS = [60, 250, 1000, 4000, 12000];
let _audioCtx = null;
let _analyserNode = null;
let _sourceNode = null;
let _filterNodes = [];
let _gainNode = null;
let _fadingOut = false;
let _countedPlay = false;
let _streamDest = null;
let _volumeFade = null;
const fxNodes = {};

/** Stereo noise with an exponential tail — a cheap synthetic room for the reverb. */
function buildImpulse(ctx, seconds = 2.8, decay = 2.6) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buffer;
}

/** Speed/pitch live on the <audio> element, so they work even before Web Audio starts. */
function applySpeed(audio, fx) {
  audio.defaultPlaybackRate = fx.speed;
  audio.playbackRate = fx.speed;
  audio.preservesPitch = fx.preservePitch;
  audio.mozPreservesPitch = fx.preservePitch;
  audio.webkitPreservesPitch = fx.preservePitch;
}

function applyFxToGraph(fx) {
  if (!_audioCtx || !fxNodes.bass) return;
  const t = _audioCtx.currentTime;
  fxNodes.bass.gain.setTargetAtTime(fx.bass, t, 0.05);
  fxNodes.lofi.frequency.setTargetAtTime(fx.lofi ? 3200 : 20000, t, 0.05);
  fxNodes.lfoDepth.gain.setTargetAtTime(fx.eightD ? 0.85 : 0, t, 0.1);
  if (!fx.eightD) fxNodes.panner.pan.setTargetAtTime(0, t, 0.1);
  fxNodes.wet.gain.setTargetAtTime(fx.reverb * 0.9, t, 0.05);
  fxNodes.dry.gain.setTargetAtTime(1 - fx.reverb * 0.35, t, 0.05);
}

function initAudioContext(audio) {
  if (_audioCtx) {
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _analyserNode;
  }
  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    _sourceNode = _audioCtx.createMediaElementSource(audio);

    const savedBands = usePlayerStore.getState().eqBands;
    _filterNodes = EQ_FREQS.map((freq, i) => {
      const filter = _audioCtx.createBiquadFilter();
      filter.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = freq;
      if (filter.type === 'peaking') filter.Q.value = 1;
      filter.gain.value = savedBands?.[i] || 0;
      return filter;
    });

    fxNodes.bass = _audioCtx.createBiquadFilter();
    fxNodes.bass.type = 'lowshelf';
    fxNodes.bass.frequency.value = 100;
    fxNodes.lofi = _audioCtx.createBiquadFilter();
    fxNodes.lofi.type = 'lowpass';
    fxNodes.lofi.frequency.value = 20000;
    fxNodes.panner = _audioCtx.createStereoPanner();
    fxNodes.lfo = _audioCtx.createOscillator();
    fxNodes.lfo.frequency.value = 0.14; // one full lap around the head every ~7s
    fxNodes.lfoDepth = _audioCtx.createGain();
    fxNodes.lfoDepth.gain.value = 0;
    fxNodes.lfo.connect(fxNodes.lfoDepth).connect(fxNodes.panner.pan);
    fxNodes.lfo.start();
    fxNodes.dry = _audioCtx.createGain();
    fxNodes.wet = _audioCtx.createGain();
    fxNodes.wet.gain.value = 0;
    fxNodes.reverb = _audioCtx.createConvolver();
    fxNodes.reverb.buffer = buildImpulse(_audioCtx);

    _gainNode = _audioCtx.createGain();
    _gainNode.gain.value = 1;

    _analyserNode = _audioCtx.createAnalyser();
    _analyserNode.fftSize = 128;
    _analyserNode.smoothingTimeConstant = 0.8;

    let node = _sourceNode;
    for (const filter of _filterNodes) { node.connect(filter); node = filter; }
    node.connect(fxNodes.bass).connect(fxNodes.lofi).connect(fxNodes.panner);
    fxNodes.panner.connect(fxNodes.dry).connect(_gainNode);
    fxNodes.panner.connect(fxNodes.reverb).connect(fxNodes.wet).connect(_gainNode);
    _gainNode.connect(_analyserNode);
    _analyserNode.connect(_audioCtx.destination);

    applyFxToGraph(usePlayerStore.getState().fx);
    return _analyserNode;
  } catch (e) {
    console.warn('Web Audio API unavailable:', e);
    return null;
  }
}

/**
 * Seconds between the <audio> element's clock and what actually leaves the speakers:
 * once playback runs through Web Audio, the graph and the output device each buffer a bit.
 */
export function getOutputLatency() {
  if (!_audioCtx || _audioCtx.state !== 'running') return 0;
  const latency = (_audioCtx.baseLatency || 0) + (_audioCtx.outputLatency || 0);
  return Math.min(Math.max(latency, 0), 0.5);
}

/** Smoothly ramps the shared gain node to `target` over `seconds` (crossfade). No-op without Web Audio. */
function fadeGain(target, seconds) {
  if (!_gainNode || !_audioCtx) return;
  const now = _audioCtx.currentTime;
  _gainNode.gain.cancelScheduledValues(now);
  _gainNode.gain.setValueAtTime(_gainNode.gain.value, now);
  _gainNode.gain.linearRampToValueAtTime(target, now + Math.max(0.05, seconds));
}

function resetGainImmediately() {
  _fadingOut = false;
  if (_gainNode && _audioCtx) {
    _gainNode.gain.cancelScheduledValues(_audioCtx.currentTime);
    _gainNode.gain.setValueAtTime(1, _audioCtx.currentTime);
  }
}

// ── Player Store ──────────────────────────────────────────────
export const usePlayerStore = create((set, get) => {
  const audio = new Audio();
  audio.volume = 0.8;

  const updateMediaSession = (track) => {
    if (!track || !('mediaSession' in navigator)) return;
    const meta = { title: track.title || 'Unknown', artist: track.artist || 'Unknown', album: track.album || 'Unknown' };
    if (track.coverUrl) meta.artwork = [{ src: track.coverUrl, sizes: '512x512', type: 'image/jpeg' }];
    navigator.mediaSession.metadata = new MediaMetadata(meta);
    navigator.mediaSession.setActionHandler('play', () => get().play());
    navigator.mediaSession.setActionHandler('pause', () => get().pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => get().next());
    navigator.mediaSession.setActionHandler('previoustrack', () => get().prev());
    navigator.mediaSession.setActionHandler('seekto', (d) => { if (d.seekTime !== undefined) get().seek(d.seekTime); });
  };

  audio.addEventListener('timeupdate', () => {
    set({ currentTime: audio.currentTime, duration: audio.duration || 0 });

    // A play "counts" for stats once 30s (or half of a short track) has been heard.
    if (!_countedPlay && audio.duration && audio.currentTime >= Math.min(30, audio.duration * 0.5)) {
      _countedPlay = true;
      const track = get().currentTrack;
      if (track) useLibraryStore.getState().recordPlay(track.id);
    }
    // Update media session position
    if ('mediaSession' in navigator && audio.duration) {
      try {
        navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: 1, position: audio.currentTime });
      } catch {}
    }

    // Crossfade: start fading out shortly before the track ends, so the next
    // track's fade-in (triggered from loadAndPlay/ended) overlaps smoothly.
    const { crossfadeSeconds, queue, currentIndex, repeat } = get();
    if (crossfadeSeconds > 0 && audio.duration && !_fadingOut) {
      const remaining = audio.duration - audio.currentTime;
      const hasNext = repeat === 'all' || repeat === 'one' || currentIndex < queue.length - 1;
      if (hasNext && remaining <= crossfadeSeconds && remaining > 0) {
        _fadingOut = true;
        fadeGain(0, remaining);
      }
    }
  });

  audio.addEventListener('ended', () => {
    const { repeat, queue, currentIndex, crossfadeSeconds } = get();
    if (repeat === 'one') {
      _countedPlay = false;
      audio.currentTime = 0;
      audio.play().catch(() => {});
      if (crossfadeSeconds > 0) { resetGainImmediately(); fadeGain(1, crossfadeSeconds); }
    }
    else if (repeat === 'all' || currentIndex < queue.length - 1) get().next();
    else set({ isPlaying: false, currentTime: 0 });
  });

  audio.addEventListener('play', () => set({ isPlaying: true }));
  audio.addEventListener('pause', () => set({ isPlaying: false }));

  /** Ramps the element volume (not the saved volume setting) — used by sleep timer and Focus breaks. */
  const fadeElementVolume = (to, ms, done) => {
    clearInterval(_volumeFade);
    const from = audio.volume;
    const steps = Math.max(1, Math.round(ms / 50));
    let i = 0;
    _volumeFade = setInterval(() => {
      i++;
      audio.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps)));
      if (i >= steps) { clearInterval(_volumeFade); _volumeFade = null; done?.(); }
    }, 50);
  };

  return {
    audio,
    currentTrack: null,
    currentIndex: -1,
    queue: [],
    originalQueue: [],
    history: [],          // recently played
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    prevVolume: 0.8,
    shuffle: false,
    repeat: 'none',       // 'none' | 'all' | 'one'
    showQueue: false,
    showNowPlaying: false,
    analyser: null,
    dominantColor: null,
    sleepTimer: { active: false, remaining: 0, minutes: 0 },
    _sleepIntervalId: null,
    eqBands: [0, 0, 0, 0, 0],
    crossfadeSeconds: 0, // 0 = off
    fx: DEFAULT_FX,
    fxPreset: 'normal',

    setFx(changes) {
      const fx = { ...get().fx, ...changes };
      applySpeed(audio, fx);
      applyFxToGraph(fx);
      set({ fx, fxPreset: findFxPreset(fx) });
      setSetting('fx', fx);
    },

    applyFxPreset(id) {
      const preset = FX_PRESETS.find(p => p.id === id);
      if (preset) get().setFx(preset.fx);
    },

    /** Starts Web Audio if needed (must run inside a user gesture). */
    ensureAudio() {
      const analyser = initAudioContext(audio);
      if (analyser && !get().analyser) set({ analyser });
      return analyser;
    },

    /** Live stream of exactly what this device plays (after EQ + FX) — fed to "listen together" guests. */
    getBroadcastStream() {
      if (!get().ensureAudio() || !_audioCtx.createMediaStreamDestination) return null;
      if (!_streamDest) {
        _streamDest = _audioCtx.createMediaStreamDestination();
        _analyserNode.connect(_streamDest);
      }
      return _streamDest.stream;
    },

    fadeOutPause(ms = 3000) {
      fadeElementVolume(0, ms, () => { audio.pause(); audio.volume = get().volume; });
    },

    playFadeIn(ms = 3000) {
      audio.volume = 0;
      audio.play().catch(() => {});
      fadeElementVolume(get().volume, ms);
    },

    playNext(track) {
      const { queue, originalQueue, currentIndex, currentTrack } = get();
      if (!currentTrack) { get().loadAndPlay(track, [track], 0); return; }
      const q = [...queue];
      q.splice(currentIndex + 1, 0, track);
      const o = [...originalQueue];
      const at = o.findIndex(t => t.id === currentTrack.id);
      o.splice(at + 1, 0, track);
      set({ queue: q, originalQueue: o });
    },

    /** Reorders the upcoming part of the queue (the current and past tracks stay put). */
    moveInQueue(from, to) {
      const { queue, currentIndex } = get();
      if (from === to || from <= currentIndex || to <= currentIndex || to >= queue.length) return;
      const q = [...queue];
      const [item] = q.splice(from, 1);
      q.splice(to, 0, item);
      set({ queue: q });
    },

    setEqBand(index, gainDb) {
      if (_filterNodes[index]) _filterNodes[index].gain.value = gainDb;
      set(s => {
        const eqBands = [...s.eqBands];
        eqBands[index] = gainDb;
        setSetting('eqBands', eqBands);
        return { eqBands };
      });
    },

    resetEq() {
      _filterNodes.forEach(f => { f.gain.value = 0; });
      set({ eqBands: [0, 0, 0, 0, 0] });
      setSetting('eqBands', [0, 0, 0, 0, 0]);
    },

    setCrossfadeSeconds(seconds) {
      set({ crossfadeSeconds: seconds });
      setSetting('crossfadeSeconds', seconds);
      if (seconds === 0) resetGainImmediately();
    },

    loadAndPlay(track, queue = [], index = 0) {
      const state = get();

      if (state.currentTrack?.id === track.id && state.isPlaying) {
        set({ showNowPlaying: true }); return;
      }

      // Revoke old blob URL
      if (audio.src?.startsWith('blob:')) URL.revokeObjectURL(audio.src);

      // Init Web Audio API on first play (requires user gesture)
      let analyser = state.analyser;
      if (!analyser) {
        analyser = initAudioContext(audio);
        if (analyser) set({ analyser });
      }

      const url = URL.createObjectURL(track.audioBlob);
      audio.src = url;
      audio.load();
      applySpeed(audio, state.fx);
      _countedPlay = false;

      const shuffle = state.shuffle;
      let finalQueue = [...queue];
      let finalIndex = index;

      if (shuffle) {
        const rest = finalQueue.filter((_, i) => i !== index);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        finalQueue = [track, ...rest];
        finalIndex = 0;
      }

      // Add to history
      const history = [track, ...state.history.filter(t => t.id !== track.id)].slice(0, 50);

      set({ currentTrack: track, queue: finalQueue, originalQueue: queue, currentIndex: finalIndex, currentTime: 0, duration: 0, history, dominantColor: null });

      const { crossfadeSeconds } = state;
      if (crossfadeSeconds > 0 && _gainNode && _audioCtx) {
        _fadingOut = false;
        _gainNode.gain.cancelScheduledValues(_audioCtx.currentTime);
        _gainNode.gain.setValueAtTime(0, _audioCtx.currentTime);
        audio.play().catch(() => {});
        fadeGain(1, crossfadeSeconds);
      } else {
        resetGainImmediately();
        audio.play().catch(() => {});
      }
      updateMediaSession(track);

      // Extract dominant color from cover art
      if (track.coverUrl) {
        extractDominantColor(track.coverUrl).then(color => {
          if (color && get().currentTrack?.id === track.id) set({ dominantColor: color });
        });
      }
    },

    play() { audio.play().catch(() => {}); },
    pause() { audio.pause(); },
    togglePlay() { audio.paused ? audio.play().catch(() => {}) : audio.pause(); },

    next() {
      const { queue, currentIndex, repeat } = get();
      if (!queue.length) return;
      let next = currentIndex + 1;
      if (next >= queue.length) { if (repeat === 'all') next = 0; else return; }
      get().loadAndPlay(queue[next], queue, next);
    },

    prev() {
      const { currentTime, queue, currentIndex } = get();
      if (currentTime > 3) { audio.currentTime = 0; resetGainImmediately(); return; }
      if (!queue.length) return;
      const prev = Math.max(0, currentIndex - 1);
      get().loadAndPlay(queue[prev], queue, prev);
    },

    seek(time) {
      audio.currentTime = time;
      set({ currentTime: time });
      if (_fadingOut) resetGainImmediately();
    },

    setVolume(v) {
      audio.volume = v;
      set({ volume: v, prevVolume: v > 0 ? v : get().prevVolume });
      setSetting('volume', v);
    },

    toggleMute() {
      const { volume, prevVolume } = get();
      if (volume > 0) { audio.volume = 0; set({ volume: 0 }); }
      else { const v = prevVolume || 0.7; audio.volume = v; set({ volume: v }); }
    },

    toggleShuffle() {
      const { shuffle, queue, currentIndex, originalQueue, currentTrack } = get();
      const newShuffle = !shuffle;
      if (newShuffle) {
        const rest = queue.filter((_, i) => i !== currentIndex);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        set({ shuffle: true, queue: [currentTrack, ...rest], currentIndex: 0 });
      } else {
        const origIdx = originalQueue.findIndex(t => t.id === currentTrack?.id);
        set({ shuffle: false, queue: originalQueue, currentIndex: Math.max(0, origIdx) });
      }
      setSetting('shuffle', newShuffle);
    },

    toggleRepeat() {
      const next = get().repeat === 'none' ? 'all' : get().repeat === 'all' ? 'one' : 'none';
      set({ repeat: next });
      setSetting('repeat', next);
    },

    setShowQueue(v) { set({ showQueue: v }); },
    setShowNowPlaying(v) { set({ showNowPlaying: v }); },

    playFromQueue(index) {
      const { queue } = get();
      if (queue[index]) get().loadAndPlay(queue[index], queue, index);
    },

    removeFromQueue(index) {
      const { queue, currentIndex } = get();
      const newQueue = queue.filter((_, i) => i !== index);
      let newIndex = currentIndex;
      if (index < currentIndex) newIndex--;
      else if (index === currentIndex && newQueue.length > 0) {
        if (newIndex >= newQueue.length) newIndex = newQueue.length - 1;
        get().loadAndPlay(newQueue[newIndex], newQueue, newIndex); return;
      }
      set({ queue: newQueue, currentIndex: newIndex });
    },

    // Sleep timer
    setSleepTimer(minutes) {
      const { _sleepIntervalId } = get();
      if (_sleepIntervalId) clearInterval(_sleepIntervalId);
      audio.volume = get().volume; // undo a fade that was in progress
      if (!minutes) { set({ sleepTimer: { active: false, remaining: 0, minutes: 0 }, _sleepIntervalId: null }); return; }

      const intervalId = setInterval(() => {
        const { sleepTimer, volume } = get();
        const remaining = sleepTimer.remaining - 1;
        if (remaining <= 0) {
          clearInterval(intervalId);
          get().pause();
          audio.volume = volume;
          set({ sleepTimer: { active: false, remaining: 0, minutes: 0 }, _sleepIntervalId: null });
        } else {
          // Fade out gently over the last minute instead of cutting mid-phrase.
          if (remaining <= 60) audio.volume = volume * (remaining / 60);
          set({ sleepTimer: { ...sleepTimer, remaining } });
        }
      }, 1000);

      set({ sleepTimer: { active: true, remaining: minutes * 60, minutes }, _sleepIntervalId: intervalId });
    },

    cancelSleepTimer() { get().setSleepTimer(0); },
  };
});

// ── Library Store ─────────────────────────────────────────────
// Enrichment needs the network: when it drops (or iTunes rate-limits us) the
// queue pauses and picks up again once we're back online, or after a minute.
let _enrichRetry = null;
function retryEnrichLater() {
  if (_enrichRetry) return;
  const run = () => {
    clearTimeout(_enrichRetry?.timer);
    window.removeEventListener('online', run);
    _enrichRetry = null;
    useLibraryStore.setState({ enrichPaused: false });
    useLibraryStore.getState().enrichLibrary();
  };
  window.addEventListener('online', run);
  _enrichRetry = { timer: setTimeout(run, 60000) };
  useLibraryStore.setState({ enrichPaused: true });
}

export const useLibraryStore = create((set, get) => ({
  tracks: [],
  playlists: [],
  loading: true,
  view: 'all',
  searchQuery: '',
  playLog: [], // [{ id, ts }] — one entry per counted play, feeds stats + smart mixes
  focusLog: [], // [{ ts, minutes }] — finished Focus sessions
  analysisProgress: null, // { done, total } while the background analysis runs
  autoEnrich: true, // look up missing covers/lyrics online for new uploads
  enrichProgress: null, // { done, total } while the enrichment queue runs
  enrichPaused: false, // queue waiting for the network

  async init() {
    const [tracks, playlists, volume, shuffle, repeat, eqBands, crossfadeSeconds, playLog, fx, focusLog, autoEnrich] = await Promise.all([
      getAllTracks(), getAllPlaylists(), getSetting('volume'), getSetting('shuffle'), getSetting('repeat'),
      getSetting('eqBands'), getSetting('crossfadeSeconds'), getSetting('playLog'), getSetting('fx'), getSetting('focusLog'),
      getSetting('autoEnrich'),
    ]);
    set({
      tracks, playlists, loading: false,
      playLog: Array.isArray(playLog) ? playLog : [],
      focusLog: Array.isArray(focusLog) ? focusLog : [],
      autoEnrich: autoEnrich !== false,
    });
    // Give the first paint a head start before decoding audio in the background.
    setTimeout(() => get().analyzeLibrary(), 2500);
    // Finish lookups an earlier session queued but couldn't complete (e.g. uploaded offline).
    setTimeout(() => get().enrichLibrary(), 3500);
    const ps = usePlayerStore.getState();
    if (volume !== undefined) { ps.audio.volume = volume; usePlayerStore.setState({ volume }); }
    if (repeat !== undefined) usePlayerStore.setState({ repeat: repeat || 'none' });
    if (shuffle !== undefined) usePlayerStore.setState({ shuffle: !!shuffle });
    if (Array.isArray(eqBands) && eqBands.length === 5) usePlayerStore.setState({ eqBands });
    if (typeof crossfadeSeconds === 'number') usePlayerStore.setState({ crossfadeSeconds });
    if (fx && typeof fx === 'object') ps.setFx({ ...DEFAULT_FX, ...fx });
  },

  async recordPlay(id) {
    const track = get().tracks.find(t => t.id === id);
    if (!track) return;
    const playCount = (track.playCount || 0) + 1;
    const lastPlayedAt = Date.now();
    set(s => ({
      tracks: s.tracks.map(t => t.id === id ? { ...t, playCount, lastPlayedAt } : t),
      playLog: [...s.playLog, { id, ts: lastPlayedAt }].slice(-PLAY_LOG_MAX),
    }));
    setSetting('playLog', get().playLog);
    try { await dbUpdateTrack(id, { playCount, lastPlayedAt }); } catch {}
  },

  recordFocus(minutes) {
    set(s => ({ focusLog: [...s.focusLog, { ts: Date.now(), minutes }].slice(-2000) }));
    setSetting('focusLog', get().focusLog);
  },

  /**
   * Decodes every not-yet-analysed track once (waveform, BPM, energy) and stores
   * the result with it. Runs one track at a time in the background.
   */
  async analyzeLibrary() {
    if (get().analysisProgress) return;
    const pending = () => get().tracks.filter(t => !t.analysis && t.audioBlob);
    const total = pending().length;
    if (!total) return;
    let done = 0;
    set({ analysisProgress: { done, total } });
    try {
      for (let next = pending()[0]; next; next = pending()[0]) {
        let analysis;
        try { analysis = await analyzeAudio(next.audioBlob); } catch { analysis = { failed: true }; }
        done++;
        set(s => ({
          tracks: s.tracks.map(t => (t.id === next.id ? { ...t, analysis } : t)),
          analysisProgress: { done, total: Math.max(total, done) },
        }));
        try { await dbUpdateTrack(next.id, { analysis }); } catch {} // track may have been deleted meanwhile
        await new Promise(r => setTimeout(r, 40));
      }
    } finally {
      set({ analysisProgress: null });
    }
  },

  async addTracks(newTracks) {
    if (!newTracks.length) return;
    for (const track of newTracks) await dbSaveTrack(track);
    set({ tracks: await getAllTracks() });
    get().analyzeLibrary();
    get().enrichLibrary();
    // Ask the browser not to evict the library when the disk fills up (Firefox asks the user, Chrome decides itself).
    navigator.storage?.persisted?.().then(p => p || navigator.storage.persist()).catch(() => {});
  },

  setAutoEnrich(on) {
    set({ autoEnrich: on });
    setSetting('autoEnrich', on);
  },

  /** Queues every track that still lacks a cover, artist or synced lyrics (the admin "fill in" button). */
  async queueMissingForEnrich() {
    const targets = get().tracks.filter(t => needsEnrich(t) && t.enrich?.status !== 'pending');
    if (!targets.length) return 0;
    const ids = new Set(targets.map(t => t.id));
    set(s => ({ tracks: s.tracks.map(t => (ids.has(t.id) ? { ...t, enrich: { ...t.enrich, status: 'pending' } } : t)) }));
    for (const t of targets) {
      try { await dbUpdateTrack(t.id, { enrich: { ...t.enrich, status: 'pending' } }); } catch {}
    }
    get().enrichLibrary();
    return targets.length;
  },

  /**
   * Works through tracks marked enrich.status === 'pending' one at a time: cover,
   * album details and lyrics from the internet (see enrich.js). Network trouble
   * leaves the rest queued for retryEnrichLater.
   */
  async enrichLibrary() {
    if (get().enrichProgress) return;
    const pending = () => get().tracks.filter(t => t.enrich?.status === 'pending');
    if (!pending().length) return;
    if (!navigator.onLine) { retryEnrichLater(); return; }
    let done = 0;
    set({ enrichProgress: { done, total: pending().length } });
    try {
      for (let next = pending()[0]; next; next = pending()[0]) {
        let result;
        try {
          result = await enrichTrack(next);
        } catch (e) {
          if (e instanceof OfflineError) { retryEnrichLater(); break; }
          result = { changes: {}, report: { match: 'error' } };
        }
        const changes = { ...result.changes, enrich: { ...next.enrich, ...result.report, status: 'done', v: ENRICH_VERSION, at: Date.now() } };
        done++;
        set(s => ({ tracks: s.tracks.map(t => (t.id === next.id ? { ...t, ...changes } : t)) }));
        set({ enrichProgress: { done, total: done + pending().length } });
        try { await dbUpdateTrack(next.id, changes); } catch {} // track may have been deleted meanwhile

        // A cover just found for the playing track should tint the UI like any other.
        if (changes.coverUrl && usePlayerStore.getState().currentTrack?.id === next.id) {
          extractDominantColor(changes.coverUrl).then(color => {
            if (color && usePlayerStore.getState().currentTrack?.id === next.id) usePlayerStore.setState({ dominantColor: color });
          });
        }
      }
    } finally {
      set({ enrichProgress: null });
    }
  },

  deleteTrack(id) {
    const { tracks, playlists } = get();
    const track = tracks.find(t => t.id === id);
    if (!track) return;
    const affectedPlaylists = playlists.filter(pl => pl.trackIds.includes(id));

    // Optimistic removal — the real DB delete happens after the undo window closes.
    set({
      tracks: tracks.filter(t => t.id !== id),
      playlists: playlists.map(pl => pl.trackIds.includes(id) ? { ...pl, trackIds: pl.trackIds.filter(tid => tid !== id) } : pl),
    });

    const timeoutId = setTimeout(async () => {
      if (track.coverUrl) URL.revokeObjectURL(track.coverUrl);
      await dbDeleteTrack(id);
      for (const pl of affectedPlaylists) {
        await dbSavePlaylist({ ...pl, trackIds: pl.trackIds.filter(tid => tid !== id) });
      }
    }, UNDO_GRACE_MS);

    showToast(`Usunięto "${track.title}" z biblioteki`, 'info', {
      actionLabel: 'Cofnij',
      duration: UNDO_GRACE_MS,
      onAction: () => {
        clearTimeout(timeoutId);
        set(s => ({
          tracks: [...s.tracks, track],
          playlists: s.playlists.map(pl => affectedPlaylists.find(a => a.id === pl.id) || pl),
        }));
      },
    });
  },

  async updateTrack(id, changes) {
    const updated = await dbUpdateTrack(id, changes);
    set(s => ({ tracks: s.tracks.map(t => t.id === id ? { ...t, ...changes } : t) }));
    return updated;
  },

  async toggleFavorite(id) {
    const track = get().tracks.find(t => t.id === id);
    if (!track) return;
    const newFav = !track.favorite;
    await dbUpdateTrack(id, { favorite: newFav });
    set(s => ({ tracks: s.tracks.map(t => t.id === id ? { ...t, favorite: newFav } : t) }));
  },

  async createPlaylist(name) {
    const pl = { id: crypto.randomUUID(), name, trackIds: [], createdAt: Date.now() };
    await dbSavePlaylist(pl);
    set(s => ({ playlists: [...s.playlists, pl] }));
    return pl;
  },

  deletePlaylist(id) {
    const pl = get().playlists.find(p => p.id === id);
    if (!pl) return;
    set(s => ({ playlists: s.playlists.filter(p => p.id !== id) }));

    const timeoutId = setTimeout(() => { dbDeletePlaylist(id); }, UNDO_GRACE_MS);

    showToast(`Usunięto playlistę "${pl.name}"`, 'info', {
      actionLabel: 'Cofnij',
      duration: UNDO_GRACE_MS,
      onAction: () => {
        clearTimeout(timeoutId);
        set(s => ({ playlists: [...s.playlists, pl] }));
      },
    });
  },

  async renamePlaylist(id, name) {
    const pl = get().playlists.find(p => p.id === id);
    if (!pl) return;
    const updated = { ...pl, name };
    await dbSavePlaylist(updated);
    set(s => ({ playlists: s.playlists.map(p => p.id === id ? updated : p) }));
  },

  async addToPlaylist(playlistId, trackId) {
    const pl = get().playlists.find(p => p.id === playlistId);
    if (!pl) return { success: false, reason: 'not_found' };
    if (pl.trackIds.includes(trackId)) {
      return { success: false, alreadyIn: true, playlistName: pl.name };
    }
    const updated = { ...pl, trackIds: [...pl.trackIds, trackId] };
    await dbSavePlaylist(updated);
    set(s => ({ playlists: s.playlists.map(p => p.id === playlistId ? updated : p) }));
    return { success: true, playlistName: pl.name };
  },

  async createPlaylistWithTrack(name, trackId) {
    const pl = { id: crypto.randomUUID(), name, trackIds: trackId ? [trackId] : [], createdAt: Date.now() };
    await dbSavePlaylist(pl);
    set(s => ({ playlists: [...s.playlists, pl] }));
    return pl;
  },

  removeFromPlaylist(playlistId, trackId) {
    const pl = get().playlists.find(p => p.id === playlistId);
    if (!pl || !pl.trackIds.includes(trackId)) return;
    const track = get().tracks.find(t => t.id === trackId);
    const updated = { ...pl, trackIds: pl.trackIds.filter(id => id !== trackId) };
    set(s => ({ playlists: s.playlists.map(p => p.id === playlistId ? updated : p) }));

    const timeoutId = setTimeout(() => { dbSavePlaylist(updated); }, UNDO_GRACE_MS);

    showToast(`Usunięto "${track?.title || 'utwór'}" z playlisty`, 'info', {
      actionLabel: 'Cofnij',
      duration: UNDO_GRACE_MS,
      onAction: () => {
        clearTimeout(timeoutId);
        set(s => ({ playlists: s.playlists.map(p => p.id === playlistId ? pl : p) }));
      },
    });
  },

  async reorderPlaylist(playlistId, trackIds) {
    const pl = get().playlists.find(p => p.id === playlistId);
    if (!pl) return;
    const updated = { ...pl, trackIds };
    await dbSavePlaylist(updated);
    set(s => ({ playlists: s.playlists.map(p => p.id === playlistId ? updated : p) }));
  },

  async exportLibrary(onProgress) {
    const { tracks, playlists } = get();
    return packLibrary(tracks, playlists, onProgress);
  },

  async importLibrary(file, onProgress) {
    const payload = await parseBackupFile(file);
    const existingTrackIds = new Set(get().tracks.map(t => t.id));
    const existingPlaylistIds = new Set(get().playlists.map(p => p.id));

    let imported = 0, skipped = 0;
    const total = payload.tracks.length || 1;
    for (let i = 0; i < payload.tracks.length; i++) {
      const packed = payload.tracks[i];
      if (existingTrackIds.has(packed.id)) { skipped++; } else {
        const track = await unpackTrack(packed);
        await dbSaveTrack(track);
        imported++;
      }
      onProgress?.(i + 1, total);
    }

    let playlistsImported = 0;
    for (const pl of payload.playlists || []) {
      if (existingPlaylistIds.has(pl.id)) continue;
      await dbSavePlaylist(pl);
      playlistsImported++;
    }

    const [tracks, playlists] = await Promise.all([getAllTracks(), getAllPlaylists()]);
    set({ tracks, playlists });
    get().analyzeLibrary();
    return { imported, skipped, playlistsImported };
  },

  selectedArtist: null,
  selectedAlbum: null,

  openArtist(artistName) {
    set({ view: 'artists', selectedArtist: artistName, searchQuery: '' });
  },
  openAlbum(albumName) {
    set({ view: 'albums', selectedAlbum: albumName, searchQuery: '' });
  },
  clearSelectedArtist() {
    set({ selectedArtist: null });
  },
  clearSelectedAlbum() {
    set({ selectedAlbum: null });
  },

  setView(view) {
    set({
      view,
      searchQuery: '',
      selectedIds: [],
      ...(view !== 'artists' ? { selectedArtist: null } : {}),
      ...(view !== 'albums' ? { selectedAlbum: null } : {}),
    });
  },
  setSearchQuery(q) { set({ searchQuery: q }); },

  // ── Multi-select + bulk actions ────────────────────────────
  selectedIds: [],
  toggleSelected(id) {
    set(s => ({
      selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter(x => x !== id) : [...s.selectedIds, id],
    }));
  },
  clearSelected() { set({ selectedIds: [] }); },

  bulkDeleteTracks(ids) {
    const { tracks, playlists } = get();
    const idSet = new Set(ids);
    const removedTracks = tracks.filter(t => idSet.has(t.id));
    if (!removedTracks.length) return;
    const affectedPlaylists = playlists.filter(pl => pl.trackIds.some(id => idSet.has(id)));

    set({
      tracks: tracks.filter(t => !idSet.has(t.id)),
      playlists: playlists.map(pl => pl.trackIds.some(id => idSet.has(id)) ? { ...pl, trackIds: pl.trackIds.filter(id => !idSet.has(id)) } : pl),
      selectedIds: [],
    });

    const timeoutId = setTimeout(async () => {
      for (const t of removedTracks) {
        if (t.coverUrl) URL.revokeObjectURL(t.coverUrl);
        await dbDeleteTrack(t.id);
      }
      for (const pl of affectedPlaylists) {
        await dbSavePlaylist({ ...pl, trackIds: pl.trackIds.filter(id => !idSet.has(id)) });
      }
    }, UNDO_GRACE_MS);

    showToast(`Usunięto ${formatPlural(removedTracks.length, 'utwór', 'utwory', 'utworów')} z biblioteki`, 'info', {
      actionLabel: 'Cofnij',
      duration: UNDO_GRACE_MS,
      onAction: () => {
        clearTimeout(timeoutId);
        set(s => ({
          tracks: [...s.tracks, ...removedTracks],
          playlists: s.playlists.map(pl => affectedPlaylists.find(a => a.id === pl.id) || pl),
        }));
      },
    });
  },

  async bulkAddToFavorites(ids) {
    const { tracks } = get();
    const toMark = ids.filter(id => !tracks.find(t => t.id === id)?.favorite);
    for (const id of toMark) await dbUpdateTrack(id, { favorite: true });
    set(s => ({
      tracks: s.tracks.map(t => ids.includes(t.id) ? { ...t, favorite: true } : t),
      selectedIds: [],
    }));
    showToast(`Dodano ${formatPlural(ids.length, 'utwór', 'utwory', 'utworów')} do ulubionych`, 'success');
  },

  async bulkAddToPlaylist(playlistId, ids) {
    const pl = get().playlists.find(p => p.id === playlistId);
    if (!pl) return;
    let added = 0;
    for (const id of ids) {
      const res = await get().addToPlaylist(playlistId, id);
      if (res.success) added++;
    }
    set({ selectedIds: [] });
    showToast(`Dodano ${formatPlural(added, 'utwór', 'utwory', 'utworów')} do playlisty "${pl.name}"`, 'success');
  },
}));

// ── Auth Store ────────────────────────────────────────────────
// Passwords older installs were seeded with. An account still using one gets a
// "change your password" warning, because these are public knowledge.
const SEEDED_PASSWORDS = { admin: ['admin123', 'admin'], sluchacz: ['123'] };
async function usesSeededPassword(user) {
  for (const p of SEEDED_PASSWORDS[user?.username] || []) {
    if (await verifyPassword(p, user)) return true;
  }
  return false;
}

export const useAuthStore = create((set, get) => ({
  currentUser: null,
  users: [],
  loading: true,
  showAuthModal: false,
  weakDefaultPassword: false,

  async changePassword(currentPassword, newPassword) {
    const { currentUser } = get();
    if (!currentUser) return { success: false, error: 'Zaloguj się, aby zmienić hasło.' };
    if (!newPassword || newPassword.length < 6) return { success: false, error: 'Nowe hasło musi mieć co najmniej 6 znaków.' };
    const stored = (await getAllUsers()).find(u => u.id === currentUser.id);
    if (!(await verifyPassword(currentPassword, stored))) return { success: false, error: 'Obecne hasło jest nieprawidłowe.' };
    const updated = await withHashedPassword(stored, newPassword);
    await dbSaveUser(updated);
    set(s => ({ currentUser: updated, users: s.users.map(u => (u.id === updated.id ? updated : u)), weakDefaultPassword: false }));
    return { success: true };
  },

  setShowAuthModal(show) { set({ showAuthModal: show }); },

  async initAuth() {
    const rawUsers = await getAllUsers();
    // One-time transparent migration: any account still holding a plaintext password
    // (older installs, or the seeded default accounts) gets hashed in place.
    const users = await Promise.all(rawUsers.map(async (u) => {
      if (u.passwordHash || !u.password) return u;
      const upgraded = await withHashedPassword(u, u.password);
      await dbSaveUser(upgraded);
      return upgraded;
    }));

    // No auto-login: a saved session is restored, otherwise you start logged out.
    const savedUserId = localStorage.getItem('bysko-active-user-id');
    const user = users.find(u => u.id === savedUserId) || null;
    if (!user) localStorage.removeItem('bysko-active-user-id');
    set({ users, currentUser: user, loading: false, weakDefaultPassword: await usesSeededPassword(user) });
  },

  async login(identifier, password) {
    if (!identifier || !password) {
      return { success: false, error: 'Wpisz email/login oraz hasło.' };
    }
    const user = await getUserByIdentifier(identifier);
    if (!user || !(await verifyPassword(password, user))) {
      return { success: false, error: 'Nieprawidłowy adres email/login lub hasło.' };
    }
    localStorage.setItem('bysko-active-user-id', user.id);
    set({ currentUser: user, showAuthModal: false, weakDefaultPassword: await usesSeededPassword(user) });
    return { success: true, user };
  },

  async loginAdmin(login, password) {
    const clean = (login || '').toLowerCase().trim();
    const cleanPass = (password || '').trim();
    if (!clean || !cleanPass) {
      return { success: false, error: 'Wpisz login i hasło administratora.' };
    }

    const user = await getUserByIdentifier(clean);
    if (!user || user.role !== 'admin') {
      return { success: false, error: 'Konto nie posiada uprawnień Administratora.' };
    }
    if (!(await verifyPassword(cleanPass, user))) {
      return { success: false, error: 'Nieprawidłowe hasło administratora.' };
    }
    localStorage.setItem('bysko-active-user-id', user.id);
    set({ currentUser: user, showAuthModal: false, weakDefaultPassword: await usesSeededPassword(user) });
    return { success: true, user };
  },

  async register(emailOrLogin, password, displayName) {
    const raw = (emailOrLogin || '').trim();
    if (!raw || raw.length < 3) {
      return { success: false, error: 'Wpisz poprawny adres e-mail lub login.' };
    }
    if (!password || password.length < 4) {
      return { success: false, error: 'Hasło musi mieć co najmniej 4 znaki.' };
    }

    const isEmail = raw.includes('@');
    const email = isEmail ? raw.toLowerCase() : `${raw.toLowerCase()}@bysko.user`;
    const username = isEmail ? raw.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'user_' + Math.floor(Math.random() * 1000) : raw.toLowerCase();

    const existing = await getUserByIdentifier(raw);
    // No admin on this device yet (fresh install) → the first account runs it.
    const firstOnDevice = !(await getAllUsers()).some(u => u.role === 'admin');
    if (existing) {
      return { success: false, error: 'Konto z takim adresem email lub loginem już istnieje.' };
    }

    const newUser = await withHashedPassword({
      id: crypto.randomUUID(),
      username,
      email,
      displayName: displayName?.trim() || username,
      role: firstOnDevice ? 'admin' : 'user',
      createdAt: Date.now(),
    }, password);
    await dbSaveUser(newUser);
    const users = await getAllUsers();
    localStorage.setItem('bysko-active-user-id', newUser.id);
    set({ users, currentUser: newUser, showAuthModal: false, weakDefaultPassword: false });
    return { success: true, user: newUser };
  },

  logout() {
    localStorage.removeItem('bysko-active-user-id');
    set({ currentUser: null, weakDefaultPassword: false });
  },

  async updateUserRole(userId, newRole) {
    const { users, currentUser } = get();
    const user = users.find(u => u.id === userId);
    if (!user) return;
    const updated = { ...user, role: newRole };
    await dbSaveUser(updated);
    const newUsers = users.map(u => u.id === userId ? updated : u);
    set({
      users: newUsers,
      currentUser: currentUser?.id === userId ? updated : currentUser
    });
  },

  async deleteUserAccount(userId) {
    const { users, currentUser } = get();
    await dbDeleteUser(userId);
    const newUsers = users.filter(u => u.id !== userId);
    set({
      users: newUsers,
      currentUser: currentUser?.id === userId ? null : currentUser
    });
  },

  async createUserByAdmin(username, password, displayName, role) {
    const cleanUser = username.toLowerCase().trim();
    const existing = await getUserByUsername(cleanUser);
    if (existing) {
      return { success: false, error: 'Użytkownik o takiej nazwie już istnieje.' };
    }
    const newUser = await withHashedPassword({
      id: crypto.randomUUID(),
      username: cleanUser,
      displayName: displayName?.trim() || cleanUser,
      role: role || 'user',
      createdAt: Date.now(),
    }, password);
    await dbSaveUser(newUser);
    const users = await getAllUsers();
    set({ users });
    return { success: true, user: newUser };
  },

  isAdmin() {
    const { currentUser } = get();
    return currentUser?.role === 'admin';
  }
}));

