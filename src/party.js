import { create } from 'zustand';
import { usePlayerStore, useLibraryStore, FX_PRESETS } from './store';
import { useUiStore } from './ui';
import { showToast } from './App';

/**
 * "Listen together" over WebRTC (PeerJS). The host streams exactly what it plays
 * (after EQ and Vibe FX) to every guest and pushes now-playing state over a data
 * channel; guests can suggest tracks from the host's library.
 *
 * Only signalling goes through the public PeerJS broker (0.peerjs.com); the audio
 * itself flows directly between browsers. Very strict NATs may block that without
 * a TURN server.
 */

const PREFIX = 'bysko-party-';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');

export const usePartyStore = create(() => ({
  role: null, // 'host' | 'guest'
  status: 'idle', // 'connecting' | 'live' | 'error'
  code: '',
  error: '',
  guests: [], // host: [{ id, name }]
  remote: null, // guest: last state from the host
  library: [], // guest: host's tracks [{ id, title, artist }]
  guestVolume: 1,
}));

let peer = null;
let hostConn = null;
let remoteAudio = null;
let stateTimer = null;
let unsubPlayer = null;
const conns = new Map();
const coverCache = new Map();

const loadPeer = async () => (await import('peerjs')).default;

function coverDataUrl(track) {
  if (!track?.coverUrl) return Promise.resolve(null);
  if (coverCache.has(track.id)) return Promise.resolve(coverCache.get(track.id));
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 240;
      c.getContext('2d').drawImage(img, 0, 0, 240, 240);
      const url = c.toDataURL('image/jpeg', 0.82);
      coverCache.set(track.id, url);
      resolve(url);
    };
    img.onerror = () => resolve(null);
    img.src = track.coverUrl;
  });
}

async function buildState() {
  const p = usePlayerStore.getState();
  const t = p.currentTrack;
  const fx = p.fxPreset === 'normal' ? null : (FX_PRESETS.find(x => x.id === p.fxPreset)?.name || 'Własne FX');
  return {
    type: 'state',
    track: t ? { id: t.id, title: t.title, artist: t.artist, album: t.album, cover: await coverDataUrl(t) } : null,
    isPlaying: p.isPlaying,
    currentTime: p.currentTime,
    duration: p.duration,
    rate: p.fx.speed,
    sentAt: Date.now(),
    fx,
    upNext: p.queue.slice(p.currentIndex + 1, p.currentIndex + 6).map(q => ({ title: q.title, artist: q.artist })),
  };
}

async function broadcast() {
  if (!conns.size) return;
  const state = await buildState();
  for (const c of conns.values()) if (c.open) c.send(state);
}

function libraryPayload() {
  return {
    type: 'library',
    tracks: useLibraryStore.getState().tracks.slice(0, 2000).map(t => ({ id: t.id, title: t.title, artist: t.artist })),
  };
}

// ── Host ──────────────────────────────────────────────────────
export async function startHosting() {
  const stream = usePlayerStore.getState().getBroadcastStream();
  if (!stream) {
    usePartyStore.setState({ status: 'error', error: 'Ta przeglądarka nie potrafi nadawać dźwięku (brak Web Audio).' });
    return;
  }
  const Peer = await loadPeer();
  const code = randomCode();
  usePartyStore.setState({ role: 'host', status: 'connecting', code, error: '', guests: [] });
  peer = new Peer(PREFIX + code);

  peer.on('open', () => usePartyStore.setState({ status: 'live' }));
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') { leaveParty(); startHosting(); return; } // code collision — roll a new one
    usePartyStore.setState({ status: 'error', error: `Błąd połączenia (${err.type}). Sprawdź internet i spróbuj ponownie.` });
  });

  peer.on('connection', (conn) => {
    const name = String(conn.metadata?.name || 'Gość').slice(0, 24);
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      usePartyStore.setState(s => ({ guests: [...s.guests.filter(g => g.id !== conn.peer), { id: conn.peer, name }] }));
      peer.call(conn.peer, usePlayerStore.getState().getBroadcastStream());
      conn.send(libraryPayload());
      broadcast();
      showToast(`Dołączył(a): ${name}`, 'success');
    });
    conn.on('data', (msg) => {
      if (msg?.type !== 'suggest') return;
      const track = useLibraryStore.getState().tracks.find(t => t.id === msg.trackId);
      if (!track) return;
      usePlayerStore.getState().playNext(track);
      showToast(`${name} dorzuca do kolejki: ${track.title}`, 'info');
      broadcast();
    });
    conn.on('close', () => {
      conns.delete(conn.peer);
      usePartyStore.setState(s => ({ guests: s.guests.filter(g => g.id !== conn.peer) }));
    });
  });

  stateTimer = setInterval(broadcast, 2000);
  unsubPlayer = usePlayerStore.subscribe((s, prev) => {
    if (s.currentTrack !== prev.currentTrack || s.isPlaying !== prev.isPlaying || s.queue !== prev.queue || s.fxPreset !== prev.fxPreset) broadcast();
  });
}

// ── Guest ─────────────────────────────────────────────────────
export async function joinParty(rawCode, name) {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) {
    usePartyStore.setState({ status: 'error', error: 'Kod pokoju ma 6 znaków.' });
    return;
  }
  usePlayerStore.getState().pause(); // two sources at once would just be noise
  const Peer = await loadPeer();
  usePartyStore.setState({ role: 'guest', status: 'connecting', code, error: '', remote: null, library: [] });

  remoteAudio = new Audio();
  remoteAudio.autoplay = true;
  remoteAudio.volume = usePartyStore.getState().guestVolume;

  peer = new Peer();
  peer.on('open', () => {
    hostConn = peer.connect(PREFIX + code, { metadata: { name: name?.trim() || 'Gość' }, reliable: true });
    hostConn.on('open', () => usePartyStore.setState({ status: 'live' }));
    hostConn.on('data', (msg) => {
      if (msg?.type === 'state') usePartyStore.setState({ remote: msg });
      else if (msg?.type === 'library') usePartyStore.setState({ library: msg.tracks || [] });
    });
    hostConn.on('close', () => {
      if (usePartyStore.getState().role !== 'guest') return;
      showToast('Gospodarz zakończył wspólne słuchanie', 'info');
      leaveParty();
    });
  });
  peer.on('call', (call) => {
    call.answer();
    call.on('stream', (stream) => {
      remoteAudio.srcObject = stream;
      remoteAudio.play().catch(() => {});
    });
  });
  peer.on('error', (err) => {
    const error = err.type === 'peer-unavailable'
      ? 'Nie ma pokoju o tym kodzie (albo gospodarz go zamknął).'
      : `Błąd połączenia (${err.type}). Sprawdź internet i spróbuj ponownie.`;
    usePartyStore.setState({ status: 'error', error });
  });
}

export function suggestTrack(trackId) {
  if (hostConn?.open) hostConn.send({ type: 'suggest', trackId });
}

export function setGuestVolume(v) {
  if (remoteAudio) remoteAudio.volume = v;
  usePartyStore.setState({ guestVolume: v });
}

export function leaveParty() {
  // Reset first so our own close events don't read as "the host left".
  usePartyStore.setState({ role: null, status: 'idle', code: '', error: '', guests: [], remote: null, library: [] });
  clearInterval(stateTimer);
  stateTimer = null;
  unsubPlayer?.();
  unsubPlayer = null;
  for (const c of conns.values()) { try { c.close(); } catch {} }
  conns.clear();
  try { hostConn?.close(); } catch {}
  hostConn = null;
  if (remoteAudio) { remoteAudio.pause(); remoteAudio.srcObject = null; remoteAudio = null; }
  try { peer?.destroy(); } catch {}
  peer = null;
}

export const partyLink = (code) => `${location.origin}${location.pathname}?party=${code}`;

/** Called once on app start: an invite link (?party=CODE) opens the join dialog prefilled. */
export function openInviteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('party');
  if (!code) return;
  params.delete('party');
  const qs = params.toString();
  window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : ''));
  useUiStore.getState().setShowParty(true, code.toUpperCase());
}
