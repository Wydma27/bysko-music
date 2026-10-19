import React, { useRef, useEffect, useState } from 'react';
import { usePlayerStore, useLibraryStore, EQ_FREQS } from '../store';
import { formatDuration } from '../metadata';
import { Visualizer } from './Visualizer';
import { MusicIcon, LibraryIcon, MoonIcon, DiscIcon } from './Icons';

const EQ_LABELS = ['60', '250', '1k', '4k', '12k'];

// ── Inline SVG icons (zamiast lucide - gwarancja renderowania) ─
const Icons = {
  Play: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em">
      <polygon points="5,3 19,12 5,21" />
    </svg>
  ),
  Pause: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em">
      <rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>
    </svg>
  ),
  SkipBack: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <polygon points="19,20 9,12 19,4"/><line x1="5" y1="19" x2="5" y2="5"/>
    </svg>
  ),
  SkipForward: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <polygon points="5,4 15,12 5,20"/><line x1="19" y1="5" x2="19" y2="19"/>
    </svg>
  ),
  Shuffle: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <polyline points="16,3 21,3 21,8"/><line x1="4" y1="20" x2="21" y2="3"/>
      <polyline points="21,16 21,21 16,21"/><line x1="15" y1="15" x2="21" y2="21"/>
      <line x1="4" y1="4" x2="9" y2="9"/>
    </svg>
  ),
  Repeat: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <polyline points="17,1 21,5 17,9"/><path d="M3,11V9a4,4,0,0,1,4-4h14"/>
      <polyline points="7,23 3,19 7,15"/><path d="M21,13v2a4,4,0,0,1-4,4H3"/>
    </svg>
  ),
  Repeat1: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <polyline points="17,1 21,5 17,9"/><path d="M3,11V9a4,4,0,0,1,4-4h14"/>
      <polyline points="7,23 3,19 7,15"/><path d="M21,13v2a4,4,0,0,1-4,4H3"/>
      <line x1="12" y1="9" x2="12" y2="15"/>
    </svg>
  ),
  Heart: ({ filled }) => (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <path d="M20.84,4.61a5.5,5.5,0,0,0-7.78,0L12,5.67l-1.06-1.06a5.5,5.5,0,0,0-7.78,7.78l1.06,1.06L12,21.23l7.78-7.78,1.06-1.06A5.5,5.5,0,0,0,20.84,4.61Z"/>
    </svg>
  ),
  Volume2: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M19.07,4.93a10,10,0,0,1,0,14.14"/>
      <path d="M15.54,8.46a5,5,0,0,1,0,7.07"/>
    </svg>
  ),
  Volume1: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54,8.46a5,5,0,0,1,0,7.07"/>
    </svg>
  ),
  VolumeX: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/>
      <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
    </svg>
  ),
  ListMusic: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
      <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
      <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  ),
  Maximize2: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/>
      <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
    </svg>
  ),
  Music: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <path d="M9,18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
    </svg>
  ),
  X: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="1em" height="1em">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Moon: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <path d="M21,12.79A9,9,0,1,1,11.21,3,7,7,0,0,0,21,12.79Z"/>
    </svg>
  ),
  Timer: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <path d="M10,2h4"/><path d="M12,14l4-4"/><circle cx="12" cy="14" r="8"/>
    </svg>
  ),
  Sliders: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="1em" height="1em">
      <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
      <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
      <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
    </svg>
  ),
  ChevronDown: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="1em" height="1em">
      <polyline points="6,9 12,15 18,9"/>
    </svg>
  ),
  Clock: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/>
    </svg>
  ),
  Disc: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  User: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em">
      <path d="M20,21v-2a4,4,0,0,0-4-4H8a4,4,0,0,0-4,4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  ),
};

// ── Volume icon helper ─────────────────────────────────────
function VolumeIcon({ volume }) {
  if (volume === 0) return <Icons.VolumeX />;
  if (volume < 0.4) return <Icons.Volume1 />;
  return <Icons.Volume2 />;
}

// ── Sleep Timer Modal ──────────────────────────────────────
function SleepTimerModal({ onClose }) {
  const { sleepTimer, setSleepTimer, cancelSleepTimer } = usePlayerStore();
  const presets = [5, 10, 15, 30, 45, 60, 90];
  const formatRemaining = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="upload-overlay" onClick={onClose}>
      <div className="mini-modal sleep-modal" onClick={e => e.stopPropagation()}>
        <div className="sleep-modal-header">
          <span className="sleep-icon"><MoonIcon /></span>
          <h3>Sleep Timer</h3>
          <button className="icon-btn" onClick={onClose}><Icons.X /></button>
        </div>
        {sleepTimer.active ? (
          <div className="sleep-active">
            <div className="sleep-countdown">{formatRemaining(sleepTimer.remaining)}</div>
            <p className="sleep-active-text">Muzyka wyłączy się za</p>
            <button className="btn btn--ghost btn--sm" onClick={() => { cancelSleepTimer(); onClose(); }}>Anuluj timer</button>
          </div>
        ) : (
          <div className="sleep-presets">
            <p className="sleep-hint">Wyłącz muzykę po:</p>
            <div className="sleep-grid">
              {presets.map(m => (
                <button key={m} className="sleep-preset-btn" onClick={() => { setSleepTimer(m); onClose(); }}>
                  {m >= 60 ? `${m / 60}h` : `${m}m`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Equalizer Modal ─────────────────────────────────────────
function EqualizerModal({ onClose }) {
  const { eqBands, setEqBand, resetEq, crossfadeSeconds, setCrossfadeSeconds } = usePlayerStore();

  return (
    <div className="upload-overlay" onClick={onClose}>
      <div className="mini-modal eq-modal" onClick={e => e.stopPropagation()}>
        <div className="sleep-modal-header">
          <span className="sleep-icon"><Icons.Sliders /></span>
          <h3>Korektor dźwięku</h3>
          <button className="icon-btn" onClick={onClose}><Icons.X /></button>
        </div>

        <div className="eq-bands">
          {EQ_FREQS.map((freq, i) => (
            <div key={freq} className="eq-band">
              <span className="eq-band-value">{eqBands[i] > 0 ? `+${eqBands[i]}` : eqBands[i]}</span>
              <input
                type="range"
                className="eq-slider"
                min="-12"
                max="12"
                step="1"
                value={eqBands[i]}
                onChange={e => setEqBand(i, parseInt(e.target.value, 10))}
              />
              <span className="eq-band-label">{EQ_LABELS[i]}</span>
            </div>
          ))}
        </div>
        <button className="btn btn--ghost btn--sm eq-reset-btn" onClick={resetEq}>Wyzeruj korektor</button>

        <div className="eq-crossfade">
          <div className="eq-crossfade-header">
            <span>Crossfade między utworami</span>
            <span className="eq-crossfade-value">{crossfadeSeconds === 0 ? 'Wyłączony' : `${crossfadeSeconds}s`}</span>
          </div>
          <input
            type="range"
            min="0"
            max="12"
            step="1"
            value={crossfadeSeconds}
            onChange={e => setCrossfadeSeconds(parseInt(e.target.value, 10))}
            className="volume-slider"
          />
        </div>
      </div>
    </div>
  );
}

// ── Progress Bar ───────────────────────────────────────────
function ProgressBar({ currentTime, duration, onSeek, large = false }) {
  const barRef = useRef();
  const [dragging, setDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);

  const calcTime = (e) => {
    if (!barRef.current || !duration) return 0;
    const rect = barRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
  };

  const handleMouseDown = (e) => { setDragging(true); setDragTime(calcTime(e)); };

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => setDragTime(calcTime(e));
    const up = (e) => { onSeek(calcTime(e)); setDragging(false); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [dragging, duration]);

  const displayTime = dragging ? dragTime : currentTime;
  const pct = duration > 0 ? (displayTime / duration) * 100 : 0;

  return (
    <div className={`progress-wrap ${large ? 'progress-wrap--large' : ''}`}>
      <span className="progress-time">{formatDuration(displayTime)}</span>
      <div ref={barRef} className={`progress-bar ${large ? 'progress-bar--large' : ''}`} onMouseDown={handleMouseDown}>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
          <div className="progress-thumb" style={{ left: `${pct}%` }} />
        </div>
      </div>
      <span className="progress-time">{formatDuration(duration)}</span>
    </div>
  );
}

// ── Bottom Player Bar ──────────────────────────────────────
export function PlayerBar() {
  const {
    currentTrack, isPlaying, currentTime, duration, volume, shuffle, repeat,
    togglePlay, next, prev, seek, setVolume, toggleShuffle, toggleRepeat,
    toggleMute, setShowQueue, showQueue, setShowNowPlaying, sleepTimer
  } = usePlayerStore();
  const { toggleFavorite, openArtist, openAlbum } = useLibraryStore();
  const [showSleepTimer, setShowSleepTimer] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);

  if (!currentTrack) {
    return (
      <div className="player-bar player-bar--empty">
        <div className="player-empty-msg">
          <MusicIcon />
          <span>Wybierz utwór, żeby zacząć słuchać</span>
        </div>
      </div>
    );
  }

  const goToArtist = (e) => {
    e.stopPropagation();
    openArtist(currentTrack.artist);
  };

  const goToAlbum = (e) => {
    e.stopPropagation();
    openAlbum(currentTrack.album);
  };

  return (
    <>
      <div className="player-bar">
        {/* ── Left: track info ── */}
        <div className="player-track-info">
          <div className="player-cover" onClick={() => setShowNowPlaying(true)} style={{ cursor: 'pointer' }}>
            {currentTrack.coverUrl
              ? <img src={currentTrack.coverUrl} alt="cover" className={isPlaying ? 'cover-active' : ''} />
              : <MusicIcon />}
          </div>
          <div className="player-meta">
            <span className="player-title" onClick={() => setShowNowPlaying(true)} style={{ cursor: 'pointer' }} title={currentTrack.title}>
              {currentTrack.title}
            </span>
            <div className="player-meta-sub">
              <span className="player-artist player-link" onClick={goToArtist} title={currentTrack.artist}>
                {currentTrack.artist}
              </span>
              <span className="player-meta-dot">·</span>
              <span className="player-album player-link" onClick={goToAlbum} title={currentTrack.album}>
                {currentTrack.album}
              </span>
            </div>
          </div>
          <button
            className={`icon-btn fav-btn ${currentTrack.favorite ? 'fav-btn--active' : ''}`}
            onClick={() => toggleFavorite(currentTrack.id)}
            title="Polub (L)"
          >
            <Icons.Heart filled={currentTrack.favorite} />
          </button>
        </div>

        {/* ── Center: controls + progress ── */}
        <div className="player-center">
          <div className="player-controls">
            <button className={`icon-btn ctrl-btn ${shuffle ? 'ctrl-btn--active' : ''}`} onClick={toggleShuffle} title="Losowo (S)">
              <Icons.Shuffle />
            </button>
            <button className="icon-btn ctrl-btn" onClick={prev} title="Poprzedni (Shift+←)">
              <Icons.SkipBack />
            </button>
            <button className="icon-btn ctrl-btn play-pause-btn" onClick={togglePlay} title="Play/Pause (Spacja)">
              {isPlaying ? <Icons.Pause /> : <Icons.Play />}
            </button>
            <button className="icon-btn ctrl-btn" onClick={next} title="Następny (Shift+→)">
              <Icons.SkipForward />
            </button>
            <button className={`icon-btn ctrl-btn ${repeat !== 'none' ? 'ctrl-btn--active' : ''}`} onClick={toggleRepeat} title="Powtarzaj (R)">
              {repeat === 'one' ? <Icons.Repeat1 /> : <Icons.Repeat />}
            </button>
          </div>
          <ProgressBar currentTime={currentTime} duration={duration} onSeek={seek} />
        </div>

        {/* ── Right: volume + extras ── */}
        <div className="player-right">
          {sleepTimer.active && (
            <div className="sleep-indicator" onClick={() => setShowSleepTimer(true)} title="Sleep timer aktywny">
              <MoonIcon />
              <span>{Math.ceil(sleepTimer.remaining / 60)}m</span>
            </div>
          )}
          <button className={`icon-btn ctrl-btn ${sleepTimer.active ? 'ctrl-btn--active' : ''}`}
            onClick={() => setShowSleepTimer(true)} title="Sleep Timer">
            <Icons.Timer />
          </button>
          <button className="icon-btn ctrl-btn" onClick={() => setShowEqualizer(true)} title="Korektor dźwięku">
            <Icons.Sliders />
          </button>
          <button className={`icon-btn ctrl-btn ${showQueue ? 'ctrl-btn--active' : ''}`}
            onClick={() => setShowQueue(!showQueue)} title="Kolejka (Q)">
            <Icons.ListMusic />
          </button>
          <button className="icon-btn ctrl-btn" onClick={() => setShowNowPlaying(true)} title="Teraz odtwarzane (F)">
            <Icons.Maximize2 />
          </button>
          <div className="volume-wrap">
            <button className="icon-btn" onClick={toggleMute} title="Wycisz (M)">
              <VolumeIcon volume={volume} />
            </button>
            <input type="range" className="volume-slider" min="0" max="1" step="0.01"
              value={volume} onChange={e => setVolume(parseFloat(e.target.value))} />
          </div>
        </div>
      </div>

      {showSleepTimer && <SleepTimerModal onClose={() => setShowSleepTimer(false)} />}
      {showEqualizer && <EqualizerModal onClose={() => setShowEqualizer(false)} />}
    </>
  );
}

// ── Now Playing Fullscreen ─────────────────────────────────
export function NowPlayingModal() {
  const {
    currentTrack, isPlaying, currentTime, duration, volume, shuffle, repeat, dominantColor,
    togglePlay, next, prev, seek, setVolume, toggleShuffle, toggleRepeat, toggleMute, setShowNowPlaying, analyser
  } = usePlayerStore();
  const { toggleFavorite, tracks, openArtist, openAlbum } = useLibraryStore();
  const [showSleepTimer, setShowSleepTimer] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);

  const track = currentTrack ? (tracks.find(t => t.id === currentTrack.id) || currentTrack) : null;
  if (!track) return null;

  const bgColor = dominantColor || '#1a1a1a';
  const bgStyle = { background: `linear-gradient(145deg, ${bgColor}88 0%, #0d0d0d 55%)` };

  const goToArtist = () => { openArtist(track.artist); setShowNowPlaying(false); };
  const goToAlbum = () => { openAlbum(track.album); setShowNowPlaying(false); };

  return (
    <div className="now-playing-overlay" style={bgStyle} onClick={() => setShowNowPlaying(false)}>
      <div className="now-playing-modal" onClick={e => e.stopPropagation()}>
        <button className="now-playing-close" onClick={() => setShowNowPlaying(false)}>
          <Icons.ChevronDown />
        </button>

        {/* Cover */}
        <div className={`now-playing-cover ${isPlaying ? 'now-playing-cover--playing' : ''}`}>
          {track.coverUrl
            ? <img src={track.coverUrl} alt="cover" />
            : <div className="now-playing-cover-placeholder"><MusicIcon /></div>}
          {isPlaying && <div className="vinyl-ring" />}
        </div>

        {/* Info */}
        <div className="now-playing-info">
          <div className="now-playing-title-row">
            <div style={{ minWidth: 0 }}>
              <h2 className="now-playing-title">{track.title}</h2>
              <p className="now-playing-artist player-link" onClick={goToArtist}>{track.artist}</p>
              <p className="now-playing-album player-link" onClick={goToAlbum}>{track.album}</p>
            </div>
            <button className={`icon-btn fav-btn fav-btn--lg ${track.favorite ? 'fav-btn--active' : ''}`}
              onClick={() => toggleFavorite(track.id)}>
              <Icons.Heart filled={track.favorite} />
            </button>
          </div>

          {/* Visualizer */}
          {analyser && <div className="now-playing-visualizer"><Visualizer size="large" color={dominantColor || '#1DB954'} /></div>}

          <ProgressBar currentTime={currentTime} duration={duration} onSeek={seek} large />

          {/* Controls */}
          <div className="now-playing-controls">
            <button className={`icon-btn ctrl-btn ${shuffle ? 'ctrl-btn--active' : ''}`} onClick={toggleShuffle}>
              <Icons.Shuffle />
            </button>
            <button className="icon-btn ctrl-btn" onClick={prev}><Icons.SkipBack /></button>
            <button className="icon-btn ctrl-btn play-pause-btn play-pause-btn--lg" onClick={togglePlay}>
              {isPlaying ? <Icons.Pause /> : <Icons.Play />}
            </button>
            <button className="icon-btn ctrl-btn" onClick={next}><Icons.SkipForward /></button>
            <button className={`icon-btn ctrl-btn ${repeat !== 'none' ? 'ctrl-btn--active' : ''}`} onClick={toggleRepeat}>
              {repeat === 'one' ? <Icons.Repeat1 /> : <Icons.Repeat />}
            </button>
          </div>

          {/* Volume + sleep */}
          <div className="now-playing-bottom">
            <div className="now-playing-volume">
              <button className="icon-btn" onClick={toggleMute}><VolumeIcon volume={volume} /></button>
              <input type="range" className="volume-slider" min="0" max="1" step="0.01"
                value={volume} onChange={e => setVolume(parseFloat(e.target.value))} />
              <Icons.Volume2 />
            </div>
            <button className="icon-btn ctrl-btn" onClick={() => setShowSleepTimer(true)} title="Sleep Timer">
              <Icons.Timer />
            </button>
            <button className="icon-btn ctrl-btn" onClick={() => setShowEqualizer(true)} title="Korektor dźwięku">
              <Icons.Sliders />
            </button>
          </div>

          {/* Artist + Album cards below controls */}
          <div className="np-cards">
            <div className="np-card" onClick={goToArtist}>
              <div className={`np-card-avatar ${!track.coverUrl ? 'np-card-avatar--placeholder' : ''}`}>
                {track.coverUrl ? <img src={track.coverUrl} alt={track.artist} /> : track.artist?.[0] || '?'}
              </div>
              <div className="np-card-info">
                <span className="np-card-label">Artysta</span>
                <span className="np-card-name">{track.artist}</span>
              </div>
              <span className="np-card-arrow">›</span>
            </div>
            <div className="np-card" onClick={goToAlbum}>
              <div className="np-card-avatar np-card-avatar--album">
                {track.coverUrl ? <img src={track.coverUrl} alt={track.album} /> : <DiscIcon />}
              </div>
              <div className="np-card-info">
                <span className="np-card-label">Album</span>
                <span className="np-card-name">{track.album}</span>
              </div>
              <span className="np-card-arrow">›</span>
            </div>
          </div>
        </div>
      </div>
      {showSleepTimer && <SleepTimerModal onClose={() => setShowSleepTimer(false)} />}
      {showEqualizer && <EqualizerModal onClose={() => setShowEqualizer(false)} />}
    </div>
  );
}

// ── Queue Panel ────────────────────────────────────────────
export function QueuePanel() {
  const { queue, currentIndex, currentTrack, playFromQueue, removeFromQueue, setShowQueue } = usePlayerStore();
  const upcoming = queue.slice(currentIndex + 1);

  return (
    <div className="queue-panel">
      <div className="queue-header">
        <h3>Kolejka odtwarzania</h3>
        <button className="icon-btn" onClick={() => setShowQueue(false)}><Icons.X /></button>
      </div>
      <div className="queue-scroll">
        {currentTrack && (
          <div className="queue-section">
            <p className="queue-section-title">Teraz odtwarzane</p>
            <div className="queue-item queue-item--active">
              <div className="queue-item-cover">
                {currentTrack.coverUrl ? <img src={currentTrack.coverUrl} alt="cover" /> : <MusicIcon />}
              </div>
              <div className="queue-item-info">
                <span className="queue-item-title">{currentTrack.title}</span>
                <span className="queue-item-artist">{currentTrack.artist}</span>
              </div>
            </div>
          </div>
        )}
        {upcoming.length > 0 && (
          <div className="queue-section">
            <p className="queue-section-title">Następne ({upcoming.length})</p>
            {upcoming.map((track, i) => {
              const qIdx = currentIndex + 1 + i;
              return (
                <div key={`${track.id}-${qIdx}`} className="queue-item" onDoubleClick={() => playFromQueue(qIdx)}>
                  <div className="queue-item-cover">
                    {track.coverUrl ? <img src={track.coverUrl} alt="cover" /> : <MusicIcon />}
                  </div>
                  <div className="queue-item-info">
                    <span className="queue-item-title">{track.title}</span>
                    <span className="queue-item-artist">{track.artist}</span>
                  </div>
                  <button className="icon-btn queue-remove" onClick={() => removeFromQueue(qIdx)}><Icons.X /></button>
                </div>
              );
            })}
          </div>
        )}
        {!currentTrack && upcoming.length === 0 && (
          <div className="queue-empty"><span style={{ fontSize: '2.5rem' }}><MusicIcon /></span><p>Kolejka jest pusta</p></div>
        )}
      </div>
    </div>
  );
}
