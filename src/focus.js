import { create } from 'zustand';
import { usePlayerStore, useLibraryStore } from './store';
import { playMix, shuffled } from './mixes';
import { showToast } from './App';

// Pomodoro-style Focus mode: music during focus blocks, a soft fade-out and
// pause for breaks, then back in. Finished blocks land in "Twój puls".

export const FOCUS_PRESETS = [
  { id: 'classic', name: 'Klasyk', focus: 25, rest: 5, desc: '25 min pracy · 5 min przerwy' },
  { id: 'deep', name: 'Głęboka praca', focus: 50, rest: 10, desc: '50 min · 10 min' },
  { id: 'flow', name: 'Flow', focus: 90, rest: 15, desc: '90 min · 15 min' },
];

let timer = null;

function notify(title, body) {
  showToast(`${title} — ${body}`, 'info', { duration: 5000 });
  try {
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/icons/icon-192.png', silent: true });
    }
  } catch {}
}

/** Calm tracks first when the library has been analysed, otherwise a random mix. */
function startFocusMusic() {
  const player = usePlayerStore.getState();
  if (player.currentTrack) { if (!player.isPlaying) player.playFadeIn(1500); return; }
  const { tracks } = useLibraryStore.getState();
  const analysed = tracks.filter(t => typeof t.analysis?.energy === 'number');
  if (analysed.length >= 6) {
    const calm = [...analysed].sort((a, b) => a.analysis.energy - b.analysis.energy).slice(0, Math.ceil(analysed.length / 2));
    playMix(shuffled(calm));
  } else if (tracks.length) {
    playMix(tracks);
  }
}

export const useFocusStore = create((set, get) => ({
  phase: 'idle', // 'idle' | 'focus' | 'break'
  presetId: 'classic',
  endsAt: 0,
  remaining: 0,
  total: 0,
  round: 0,

  start(presetId = get().presetId) {
    const preset = FOCUS_PRESETS.find(p => p.id === presetId) || FOCUS_PRESETS[0];
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
    set({ presetId: preset.id, round: 1 });
    get()._enter('focus');
    startFocusMusic();
  },

  stop() {
    clearInterval(timer);
    timer = null;
    set({ phase: 'idle', endsAt: 0, remaining: 0, total: 0, round: 0 });
  },

  /** Jumps straight to the next phase (counts a skipped focus block only for the time spent). */
  skip() {
    const { phase, total, remaining } = get();
    if (phase === 'focus') {
      const spent = Math.floor((total - remaining) / 60);
      if (spent >= 1) useLibraryStore.getState().recordFocus(spent);
    }
    get()._advance(false);
  },

  _enter(phase) {
    const preset = FOCUS_PRESETS.find(p => p.id === get().presetId) || FOCUS_PRESETS[0];
    const seconds = (phase === 'focus' ? preset.focus : preset.rest) * 60;
    set({ phase, total: seconds, remaining: seconds, endsAt: Date.now() + seconds * 1000 });
    clearInterval(timer);
    timer = setInterval(() => {
      const remaining = Math.max(0, Math.round((get().endsAt - Date.now()) / 1000));
      set({ remaining });
      if (remaining === 0) get()._advance(true);
    }, 1000);
  },

  _advance(completed) {
    const { phase, presetId, round } = get();
    const preset = FOCUS_PRESETS.find(p => p.id === presetId) || FOCUS_PRESETS[0];
    const player = usePlayerStore.getState();
    if (phase === 'focus') {
      if (completed) useLibraryStore.getState().recordFocus(preset.focus);
      if (player.isPlaying) player.fadeOutPause(4000);
      notify('Przerwa', `${preset.rest} min oddechu. Muzyka wróci sama.`);
      get()._enter('break');
    } else {
      set({ round: round + 1 });
      notify('Wracamy do pracy', `Blok ${round + 1} — ${preset.focus} min skupienia.`);
      get()._enter('focus');
      startFocusMusic();
    }
  },
}));

export const formatClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
