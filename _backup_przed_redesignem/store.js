import { create } from 'zustand';
import {
  saveTrack as dbSaveTrack, getAllTracks, deleteTrack as dbDeleteTrack, updateTrack as dbUpdateTrack,
  getAllPlaylists, savePlaylist as dbSavePlaylist, deletePlaylist as dbDeletePlaylist,
  getSetting, setSetting, getAllUsers, getUserByUsername, getUserByIdentifier, saveUser as dbSaveUser, deleteUser as dbDeleteUser,
} from './db';
import { withHashedPassword, verifyPassword } from './auth';
import { exportLibrary as packLibrary, parseBackupFile, unpackTrack } from './backup';
import { formatPlural } from './metadata';
import { showToast } from './App';

const UNDO_GRACE_MS = 5000;

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

// ── Web Audio API setup (analyser + 5-band equalizer + crossfade gain) ──
export const EQ_FREQS = [60, 250, 1000, 4000, 12000];
let _audioCtx = null;
let _analyserNode = null;
let _sourceNode = null;
let _filterNodes = [];
let _gainNode = null;
let _fadingOut = false;

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

    _gainNode = _audioCtx.createGain();
    _gainNode.gain.value = 1;

    _analyserNode = _audioCtx.createAnalyser();
    _analyserNode.fftSize = 128;
    _analyserNode.smoothingTimeConstant = 0.8;

    let node = _sourceNode;
    for (const filter of _filterNodes) { node.connect(filter); node = filter; }
    node.connect(_gainNode);
    _gainNode.connect(_analyserNode);
    _analyserNode.connect(_audioCtx.destination);

    return _analyserNode;
  } catch (e) {
    console.warn('Web Audio API unavailable:', e);
    return null;
  }
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
      audio.currentTime = 0;
      audio.play().catch(() => {});
      if (crossfadeSeconds > 0) { resetGainImmediately(); fadeGain(1, crossfadeSeconds); }
    }
    else if (repeat === 'all' || currentIndex < queue.length - 1) get().next();
    else set({ isPlaying: false, currentTime: 0 });
  });

  audio.addEventListener('play', () => set({ isPlaying: true }));
  audio.addEventListener('pause', () => set({ isPlaying: false }));

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
      if (!minutes) { set({ sleepTimer: { active: false, remaining: 0, minutes: 0 }, _sleepIntervalId: null }); return; }

      const intervalId = setInterval(() => {
        const { sleepTimer } = get();
        const remaining = sleepTimer.remaining - 1;
        if (remaining <= 0) {
          clearInterval(intervalId);
          get().pause();
          set({ sleepTimer: { active: false, remaining: 0, minutes: 0 }, _sleepIntervalId: null });
        } else {
          set({ sleepTimer: { ...sleepTimer, remaining } });
        }
      }, 1000);

      set({ sleepTimer: { active: true, remaining: minutes * 60, minutes }, _sleepIntervalId: intervalId });
    },

    cancelSleepTimer() { get().setSleepTimer(0); },
  };
});

// ── Library Store ─────────────────────────────────────────────
export const useLibraryStore = create((set, get) => ({
  tracks: [],
  playlists: [],
  loading: true,
  view: 'all',
  searchQuery: '',

  async init() {
    const [tracks, playlists, volume, shuffle, repeat, eqBands, crossfadeSeconds] = await Promise.all([
      getAllTracks(), getAllPlaylists(), getSetting('volume'), getSetting('shuffle'), getSetting('repeat'),
      getSetting('eqBands'), getSetting('crossfadeSeconds'),
    ]);
    set({ tracks, playlists, loading: false });
    const ps = usePlayerStore.getState();
    if (volume !== undefined) { ps.audio.volume = volume; usePlayerStore.setState({ volume }); }
    if (repeat !== undefined) usePlayerStore.setState({ repeat: repeat || 'none' });
    if (shuffle !== undefined) usePlayerStore.setState({ shuffle: !!shuffle });
    if (Array.isArray(eqBands) && eqBands.length === 5) usePlayerStore.setState({ eqBands });
    if (typeof crossfadeSeconds === 'number') usePlayerStore.setState({ crossfadeSeconds });
  },

  async addTracks(newTracks) {
    for (const track of newTracks) await dbSaveTrack(track);
    set({ tracks: await getAllTracks() });
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
export const useAuthStore = create((set, get) => ({
  currentUser: null,
  users: [],
  loading: true,
  showAuthModal: false,

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
    set({ users, currentUser: user, loading: false });
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
    set({ currentUser: user, showAuthModal: false });
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
    set({ currentUser: user, showAuthModal: false });
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
    if (existing) {
      return { success: false, error: 'Konto z takim adresem email lub loginem już istnieje.' };
    }

    const newUser = await withHashedPassword({
      id: crypto.randomUUID(),
      username,
      email,
      displayName: displayName?.trim() || username,
      role: 'user',
      createdAt: Date.now(),
    }, password);
    await dbSaveUser(newUser);
    const users = await getAllUsers();
    localStorage.setItem('bysko-active-user-id', newUser.id);
    set({ users, currentUser: newUser, showAuthModal: false });
    return { success: true, user: newUser };
  },

  logout() {
    localStorage.removeItem('bysko-active-user-id');
    set({ currentUser: null });
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

