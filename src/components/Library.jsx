import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { usePlayerStore, useLibraryStore, useAuthStore } from '../store';
import { parseID3, getAudioDuration, formatDuration, parseFromFilename, formatPlural } from '../metadata';
import { parseLyrics } from '../lyrics';
import { showToast } from '../App';
import { CreatePlaylistModal } from './Playlists';
import { VirtualTrackList } from './VirtualList';
import { HomeHero, SmartMixes } from './Discover';
import { artistRanks } from '../stats';
import {
  UploadIcon,
  MusicIcon,
  SearchIcon as SearchIconSVG,
  XIcon,
  CheckIcon,
  EditIcon,
  HeartIcon,
  TrashIcon,
  PlusIcon,
  ChevronRightIcon,
  ClockIcon,
  UserIcon,
  LibraryIcon,
  LockIcon,
  ShieldCheckIcon,
  ImageIcon,
  SparklesIcon,
  MicIcon,
  DiscIcon,
  ChevronLeftIcon
} from './Icons';

const DotsIcon = () => (<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>);
const PlayIcon = () => (<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><polygon points="5,3 19,12 5,21"/></svg>);
const PauseIcon = () => (<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>);
const ShuffleIcon = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em"><polyline points="16,3 21,3 21,8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21,16 21,21 16,21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>);
const VerifiedIcon = () => (<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.2l-3.8-3.8 1.4-1.4 2.4 2.4 5.9-5.9 1.4 1.4-7.3 7.3z"/></svg>);

/* ── Helper: Polish plural ── */
function plural(count, one, few, many) {
  if (count === 1) return one;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/* ── Upload Zone ─────────────────────────────────────────────── */
// Same name + size as a file already in the library → almost certainly the same file again.
const fileKey = (name, size) => `${(name || '').toLowerCase()}|${size}`;

/** One file in the upload list; once saved it follows the track as the cover and lyrics arrive. */
function UploadRow({ item }) {
  const track = useLibraryStore(s => (item.trackId ? s.tracks.find(t => t.id === item.trackId) : null));
  const paused = useLibraryStore(s => s.enrichPaused);
  const lyrics = useMemo(() => parseLyrics(track?.lyrics), [track?.lyrics]);
  const status = item.status === 'done' && track?.enrich?.status === 'pending' ? 'processing' : item.status;

  let meta = null;
  if (item.status === 'duplicate') meta = <span>Już jest w bibliotece — pominięto</span>;
  else if (item.status === 'error') meta = <span>Nie udało się odczytać pliku</span>;
  else if (track?.enrich?.status === 'pending') {
    meta = <span>{paused ? 'Czeka na internet — dokończy się samo' : 'Szukam okładki i tekstu…'}</span>;
  } else if (track) {
    meta = (
      <>
        <span className={track.coverUrl ? 'upload-badge--ok' : ''}>{track.coverUrl ? '✓ Okładka' : '✗ Brak okładki'}</span>
        <span className={lyrics ? 'upload-badge--ok' : ''}>
          {lyrics?.synced ? '✓ Tekst (karaoke)' : lyrics ? '✓ Tekst' : track.enrich?.instrumental ? 'Instrumentalny' : '✗ Brak tekstu'}
        </span>
        {track.enrich?.match === 'uncertain' && <span className="upload-badge--warn">Niepewne dopasowanie — sprawdź ręcznie</span>}
      </>
    );
  }

  return (
    <div className={`upload-item upload-item--${status}`}>
      {track?.coverUrl ? <img className="upload-item-cover" src={track.coverUrl} alt="" /> : <span className="upload-item-icon"><MusicIcon /></span>}
      <span className="upload-item-text">
        <span className="upload-item-name">{track ? `${track.artist} — ${track.title}` : item.name}</span>
        {meta && <span className="upload-item-meta">{meta}</span>}
      </span>
      <span className="upload-item-status">
        {status === 'done' ? <CheckIcon /> : status === 'error' ? <XIcon /> : status === 'processing' ? <span className="spinner-sm" /> : null}
      </span>
    </div>
  );
}

export function UploadZone({ onClose }) {
  const { addTracks } = useLibraryStore();
  const autoEnrich = useLibraryStore(s => s.autoEnrich);
  const { isAdmin, setShowAuthModal } = useAuthStore();
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState([]);
  const [done, setDone] = useState(false);
  const [customCoverBlob, setCustomCoverBlob] = useState(null);
  const [customCoverPreview, setCustomCoverPreview] = useState(null);
  const inputRef = useRef();
  const coverInputRef = useRef();

  const handleCoverSelect = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      if (customCoverPreview) URL.revokeObjectURL(customCoverPreview);
      setCustomCoverBlob(file);
      setCustomCoverPreview(URL.createObjectURL(file));
      showToast('Wybrano własną okładkę dla wgrywanych plików', 'info');
    }
  };

  const removeCustomCover = (e) => {
    e.stopPropagation();
    if (customCoverPreview) URL.revokeObjectURL(customCoverPreview);
    setCustomCoverBlob(null);
    setCustomCoverPreview(null);
  };

  const processFiles = useCallback(async (files) => {
    const allFiles = Array.from(files);
    // Check if user dropped an image file along with audio
    const droppedImg = allFiles.find(f => f.type.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(f.name));
    let batchCoverBlob = customCoverBlob;
    let batchCoverUrl = customCoverPreview;

    if (droppedImg && !batchCoverBlob) {
      batchCoverBlob = droppedImg;
      batchCoverUrl = URL.createObjectURL(droppedImg);
      setCustomCoverBlob(droppedImg);
      setCustomCoverPreview(batchCoverUrl);
    }

    const audioFiles = allFiles.filter(f =>
      f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(f.name)
    );
    if (!audioFiles.length) {
      if (droppedImg) showToast('Załadowano okładkę! Teraz upuść pliki audio.', 'info');
      return;
    }

    // Lyrics files dropped alongside are matched to audio by file name ("Song.lrc" ↔ "Song.mp3").
    const baseName = (name) => name.replace(/\.[^/.]+$/, '').toLowerCase();
    const lyricsByName = new Map();
    for (const f of allFiles.filter(f => /\.(lrc|txt)$/i.test(f.name))) {
      lyricsByName.set(baseName(f.name), await f.text());
    }

    const { tracks: library, autoEnrich: lookUp } = useLibraryStore.getState();
    const known = new Set(library.map(t => fileKey(t.fileName, t.audioBlob?.size)));
    const mark = (i, patch) => setProcessing(prev => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p));

    setDone(false);
    setProcessing(audioFiles.map(f => ({ name: f.name, status: 'pending' })));
    const newTracks = [];
    let duplicates = 0;

    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      const key = fileKey(file.name, file.size);
      if (known.has(key)) { duplicates++; mark(i, { status: 'duplicate' }); continue; }
      known.add(key);
      mark(i, { status: 'processing' });
      try {
        const meta = await parseID3(file);
        const duration = await getAudioDuration(file);
        let coverBlob = batchCoverBlob || null;
        let coverUrl = batchCoverUrl || null;

        // If no custom cover, fallback to ID3 embedded cover
        if (!coverBlob && meta.cover) {
          try {
            const resp = await fetch(meta.cover);
            coverBlob = await resp.blob();
            URL.revokeObjectURL(meta.cover);
            coverUrl = URL.createObjectURL(coverBlob);
          } catch {}
        }

        const fileLyrics = lyricsByName.get(baseName(file.name));
        const id = crypto.randomUUID();
        newTracks.push({
          id,
          title: meta.title || file.name.replace(/\.[^/.]+$/, ''),
          artist: meta.artist || 'Nieznany wykonawca',
          album: meta.album || 'Singiel',
          year: meta.year || '',
          duration, favorite: false, audioBlob: file,
          coverBlob, coverUrl, dateAdded: Date.now(), fileName: file.name,
          lyrics: fileLyrics || meta.lyrics || '',
          // Missing cover/lyrics get looked up online (enrich.js); lyrics supplied as a file are never replaced.
          enrich: { status: lookUp ? 'pending' : 'off', lyricsLocked: !!fileLyrics },
        });
        mark(i, { status: 'done', trackId: id });
      } catch {
        mark(i, { status: 'error' });
      }
    }
    await addTracks(newTracks);
    setDone(true);
    if (!newTracks.length) {
      showToast(duplicates ? 'Te pliki są już w bibliotece' : 'Nie udało się dodać plików', duplicates ? 'info' : 'error');
    } else {
      const skipped = duplicates ? ` (pominięto ${formatPlural(duplicates, 'duplikat', 'duplikaty', 'duplikatów')})` : '';
      showToast(`Dodano ${formatPlural(newTracks.length, 'utwór', 'utwory', 'utworów')}${skipped}`, 'success');
    }
    // Stay open while covers and lyrics arrive, or when nothing was added so the reasons stay visible.
    if (!lookUp && newTracks.length) setTimeout(() => onClose?.(), 1000);
  }, [addTracks, onClose, customCoverBlob, customCoverPreview]);

  const savedIds = processing.map(p => p.trackId).filter(Boolean);
  const stillSearching = useLibraryStore(s => s.tracks.reduce((n, t) => n + (t.enrich?.status === 'pending' && savedIds.includes(t.id) ? 1 : 0), 0));

  const handleDrop = (e) => { e.preventDefault(); setDragging(false); processFiles(e.dataTransfer.files); };

  if (!isAdmin()) {
    return (
      <div className="upload-overlay" onClick={onClose}>
        <div className="upload-modal" onClick={e => e.stopPropagation()} style={{ textAlign: 'center', padding: '36px 24px' }}>
          <div style={{ fontSize: '3rem', marginBottom: 12, color: 'var(--accent)', display: 'flex', justifyContent: 'center' }}>
            <LockIcon />
          </div>
          <h2 style={{ marginBottom: 8 }}>Wymagane uprawnienia Administratora</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: '0.92rem', lineHeight: 1.5, maxWidth: 420, margin: '0 auto 24px' }}>
            Wgrywanie nowej muzyki i przypisywanie okładek do serwisu wymaga roli Administratora. Zaloguj się na konto administratora, aby zarządzać biblioteką.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button className="btn btn--primary" onClick={() => { onClose(); setShowAuthModal(true); }}>
              <ShieldCheckIcon /> Zaloguj jako Administrator
            </button>
            <button className="btn btn--ghost" onClick={onClose}>Zamknij</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="upload-overlay" onClick={onClose}>
      <div className="upload-modal" onClick={e => e.stopPropagation()}>
        <div className="upload-modal-header">
          <div>
            <h2>Dodaj muzykę do serwisu</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>Panel Administratora · Wgrywanie utworów i okładek</p>
          </div>
          <button className="icon-btn" onClick={onClose}><XIcon /></button>
        </div>

        {/* ── Custom Cover / Icon Section ── */}
        <div className="upload-cover-box">
          <div className="upload-cover-thumb" onClick={() => coverInputRef.current?.click()} title="Wybierz plik okładki">
            {customCoverPreview ? (
              <img src={customCoverPreview} alt="Okładka" />
            ) : (
              <div className="upload-cover-placeholder">
                <ImageIcon />
              </div>
            )}
          </div>
          <div className="upload-cover-meta">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <p className="upload-cover-heading">Okładka dla wgrywanych utworów</p>
              {customCoverPreview && <span className="upload-cover-active-tag">Aktywna</span>}
            </div>
            <p className="upload-cover-sub">
              {customCoverPreview
                ? 'Wybrana grafika zostanie przypisana do wszystkich wgrywanych w tej sesji plików audio.'
                : `Opcjonalnie: wybierz plik graficzny (JPG, PNG, WEBP), lub upuść okładkę razem z plikami audio.${autoEnrich ? ' Bez tego okładka zostanie wyszukana automatycznie.' : ''}`}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => coverInputRef.current?.click()}>
                <ImageIcon /> {customCoverPreview ? 'Zmień grafikę' : 'Wybierz okładkę z dysku'}
              </button>
              {customCoverPreview && (
                <button type="button" className="btn btn--ghost btn--sm danger" onClick={removeCustomCover}>
                  <TrashIcon /> Usuń
                </button>
              )}
            </div>
            <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handleCoverSelect} />
          </div>
        </div>

        {/* ── Audio Drop Zone ── */}
        <div
          className={`drop-zone ${dragging ? 'drop-zone--active' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a,image/*,.lrc,.txt" multiple
            style={{ display: 'none' }} onChange={e => { const files = Array.from(e.target.files); e.target.value = ''; processFiles(files); }} />
          <span className="drop-zone-icon"><UploadIcon /></span>
          <p className="drop-zone-title">Przeciągnij pliki audio tutaj</p>
          <p className="drop-zone-sub">lub kliknij, żeby wybrać pliki z dysku</p>
          <p className="drop-zone-formats">MP3 · WAV · OGG · FLAC · AAC · M4A (oraz JPG/PNG okładki i teksty .lrc/.txt o tej samej nazwie co utwór)</p>
        </div>

        {processing.length > 0 && (
          <div className="upload-progress">
            {processing.map((p, i) => <UploadRow key={i} item={p} />)}
          </div>
        )}
        {done && savedIds.length > 0 && (autoEnrich ? (
          <div className="upload-footer">
            <span>
              {stillSearching
                ? `Szukam okładek i tekstów (${stillSearching})… Możesz zamknąć okno — dokończy się w tle.`
                : 'Gotowe — wszystko, co się dało, zostało uzupełnione.'}
            </span>
            <button className="btn btn--secondary btn--sm" onClick={onClose}>Zamknij</button>
          </div>
        ) : <p className="upload-success"><CheckIcon /> Pomyślnie dodano do biblioteki!</p>)}
      </div>
    </div>
  );
}

/* ── Edit Track Modal ────────────────────────────────────────── */
export function EditTrackModal({ track, onClose }) {
  const { updateTrack } = useLibraryStore();
  const [form, setForm] = useState({ title: track.title, artist: track.artist, album: track.album, lyrics: track.lyrics || '' });
  const [coverPreview, setCoverPreview] = useState(track.coverUrl || null);
  const [coverBlob, setCoverBlob] = useState(null);
  const coverInputRef = useRef();
  const lyricsInputRef = useRef();

  const handleLyricsFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) {
      const lyrics = await file.text();
      setForm(f => ({ ...f, lyrics }));
    }
  };

  const handleCoverChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (coverPreview && coverPreview !== track.coverUrl) URL.revokeObjectURL(coverPreview);
    setCoverPreview(URL.createObjectURL(file));
    setCoverBlob(file);
  };

  const handleAutoDetect = () => {
    const detected = parseFromFilename(track.fileName || form.title);
    setForm(f => ({
      ...f,
      title: detected.title || f.title,
      artist: detected.artist || f.artist || 'Nieznany wykonawca',
      album: detected.album || f.album || 'Singiel',
    }));
  };

  const handleSave = async () => {
    const changes = { ...form };
    if (form.lyrics !== (track.lyrics || '')) {
      changes.enrich = { ...track.enrich, lyricsLocked: !!form.lyrics.trim() };
      changes.lyricsOffset = 0; // a sync correction belonged to the old text
    }
    if (coverBlob) {
      if (track.coverUrl) URL.revokeObjectURL(track.coverUrl);
      changes.coverBlob = coverBlob;
      changes.coverUrl = URL.createObjectURL(coverBlob);
    }
    await updateTrack(track.id, changes);
    onClose();
  };

  return (
    <div className="upload-overlay" onClick={onClose}>
      <div className="edit-modal" onClick={e => e.stopPropagation()}>
        <div className="upload-modal-header">
          <h2>Edytuj utwór</h2>
          <button className="icon-btn" onClick={onClose}><XIcon /></button>
        </div>
        <div className="edit-modal-body">
          <div className="edit-cover-section">
            <div className="edit-cover-thumb" onClick={() => coverInputRef.current?.click()}
              style={{ backgroundImage: coverPreview ? `url(${coverPreview})` : 'none' }}>
              {!coverPreview && <MusicIcon />}
              <div className="edit-cover-overlay"><EditIcon /></div>
            </div>
            <input ref={coverInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverChange} />
            <p className="edit-cover-hint">Kliknij, żeby zmienić okładkę</p>
            <button type="button" className="btn btn--ghost btn--sm auto-detect-btn" onClick={handleAutoDetect} title="Rozpoznaj artystę i tytuł z nazwy pliku">
              <SparklesIcon /> Wykryj z nazwy pliku
            </button>
          </div>
          <div className="edit-fields">
            {[['title', 'Tytuł'], ['artist', 'Artysta / Wykonawca'], ['album', 'Album']].map(([key, label]) => (
              <label key={key} className="edit-field">
                <span>{label}</span>
                <input type="text" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              </label>
            ))}
            <label className="edit-field">
              <span className="edit-field-row">
                Tekst piosenki (.lrc lub zwykły)
                <button type="button" className="link-btn" onClick={() => lyricsInputRef.current?.click()}>Wczytaj z pliku</button>
              </span>
              <textarea
                className="edit-textarea"
                rows={5}
                placeholder={'[00:12.30] Pierwsza linijka\n[00:15.80] Druga linijka\n…albo zwykły tekst bez czasów'}
                value={form.lyrics}
                onChange={e => setForm(f => ({ ...f, lyrics: e.target.value }))}
              />
              <input ref={lyricsInputRef} type="file" accept=".lrc,.txt,text/plain" hidden onChange={handleLyricsFile} />
            </label>
          </div>
        </div>
        <div className="edit-modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Anuluj</button>
          <button className="btn btn--primary" onClick={handleSave}>Zapisz zmiany</button>
        </div>
      </div>
    </div>
  );
}

/* ── Track Row ───────────────────────────────────────────────── */
export function TrackRow({ track, index, queue, showIndex = false, onRemove }) {
  const { loadAndPlay, currentTrack, isPlaying, playNext } = usePlayerStore();
  const { toggleFavorite, deleteTrack, playlists, addToPlaylist, openArtist, openAlbum, selectedIds, toggleSelected } = useLibraryStore();
  const isSelected = selectedIds.includes(track.id);
  const { isAdmin } = useAuthStore();
  const [showMenu, setShowMenu] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const menuRef = useRef();
  const isActive = currentTrack?.id === track.id;

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) { setShowMenu(false); setShowPlaylistMenu(false); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handlePlay = () => loadAndPlay(track, queue || [track], queue ? queue.indexOf(track) : 0);

  const handleAddToPlaylist = async (plId, plName) => {
    const res = await addToPlaylist(plId, track.id);
    if (res.alreadyIn) {
      showToast(`Utwór "${track.title}" jest już w "${plName}"`, 'info');
    } else if (res.success) {
      showToast(`Dodano "${track.title}" do playlisty "${plName}"`, 'success');
    }
    setShowMenu(false);
    setShowPlaylistMenu(false);
  };

  const handleCreatePlaylistWithTrack = () => {
    setShowCreatePlaylist(true);
    setShowMenu(false);
    setShowPlaylistMenu(false);
  };

  return (
    <>
      <div
        className={`track-row ${isActive ? 'track-row--active' : ''} ${isSelected ? 'track-row--selected' : ''}`}
        onDoubleClick={handlePlay}
        draggable
        onDragStart={e => e.dataTransfer.setData('text/plain', track.id)}
        title="Kliknij dwukrotnie, aby odtworzyć (lub przeciągnij na playlistę)"
      >
        <div className="track-row-left">
          <input
            type="checkbox"
            className="track-select-checkbox"
            checked={isSelected}
            onChange={() => toggleSelected(track.id)}
            onClick={e => e.stopPropagation()}
            aria-label={`Zaznacz "${track.title}"`}
          />
          {showIndex && (
            <span className="track-index">
              {isActive && isPlaying ? <span className="equalizer"><span /><span /><span /></span> : index + 1}
            </span>
          )}
          <div className="track-cover-wrap">
            {track.coverUrl
              ? <img src={track.coverUrl} alt="cover" className="track-cover" />
              : <div className="track-cover track-cover--placeholder"><MusicIcon /></div>}
            <button className="track-play-btn" onClick={handlePlay}>
              {isActive && isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
          </div>
          <div className="track-info">
            <span className={`track-title ${isActive ? 'track-title--active' : ''}`} title={track.title}>{track.title}</span>
            <span className="track-artist player-link" onClick={(e) => { e.stopPropagation(); openArtist(track.artist); }} title={`Przejdź do: ${track.artist}`}>
              {track.artist}
            </span>
          </div>
        </div>
        <span className="track-album hide-sm player-link" onClick={(e) => { e.stopPropagation(); openAlbum(track.album); }} title={`Przejdź do albumu: ${track.album}`}>
          {track.album}
        </span>
        <div className="track-row-right">
          <button className={`icon-btn fav-btn ${track.favorite ? 'fav-btn--active' : ''}`}
            onClick={e => { e.stopPropagation(); toggleFavorite(track.id); }} title="Polub utwór">
            <HeartIcon filled={track.favorite} />
          </button>
          <span className="track-duration">{formatDuration(track.duration)}</span>
          <div className="track-menu-wrap" ref={menuRef}>
            <button className="icon-btn" onClick={e => { e.stopPropagation(); setShowMenu(!showMenu); }}>
              <DotsIcon />
            </button>
            {showMenu && (
              <div className="context-menu">
                <button onClick={() => { handlePlay(); setShowMenu(false); }}><PlayIcon /> Odtwórz</button>
                <button onClick={() => { playNext(track); showToast(`„${track.title}” zagra jako następny`, 'success'); setShowMenu(false); }}>
                  <ChevronRightIcon /> Zagraj jako następny
                </button>
                <button onClick={() => { openArtist(track.artist); setShowMenu(false); }}><UserIcon /> Przejdź do artysty</button>
                <button onClick={() => { openAlbum(track.album); setShowMenu(false); }}><LibraryIcon /> Przejdź do albumu</button>
                {isAdmin() && (
                  <button onClick={() => { setShowEdit(true); setShowMenu(false); }}><EditIcon /> Edytuj metadane</button>
                )}
                <button onClick={() => { toggleFavorite(track.id); setShowMenu(false); }}>
                  <HeartIcon filled={track.favorite} /> {track.favorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
                </button>
                <div className="menu-divider" />
                <div className="submenu-wrap">
                  <button onClick={() => setShowPlaylistMenu(!showPlaylistMenu)}>
                    <PlusIcon /> Dodaj do playlisty <ChevronRightIcon />
                  </button>
                  {showPlaylistMenu && (
                    <div className="submenu">
                      <button onClick={handleCreatePlaylistWithTrack} className="submenu-create-btn">
                        <PlusIcon /> Nowa playlista z tym utworem
                      </button>
                      {playlists.length > 0 && <div className="menu-divider" />}
                      {playlists.length === 0
                        ? <span className="submenu-empty">Brak playlist</span>
                        : playlists.map(pl => {
                          const alreadyIn = pl.trackIds.includes(track.id);
                          return (
                            <button
                              key={pl.id}
                              onClick={() => handleAddToPlaylist(pl.id, pl.name)}
                              className={alreadyIn ? 'submenu-already-in' : ''}
                            >
                              {alreadyIn && <CheckIcon />}
                              <span>{pl.name}</span>
                              {alreadyIn && <span className="submenu-tag">dodano</span>}
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>
                {onRemove && (
                  <>
                    <div className="menu-divider" />
                    <button onClick={() => { onRemove(); setShowMenu(false); }} className="menu-danger"><TrashIcon /> Usuń z playlisty</button>
                  </>
                )}
                {isAdmin() && (
                  <>
                    <div className="menu-divider" />
                    <button className="menu-danger" onClick={() => { deleteTrack(track.id); setShowMenu(false); }}><TrashIcon /> Usuń z biblioteki</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {showEdit && <EditTrackModal track={track} onClose={() => setShowEdit(false)} />}
      {showCreatePlaylist && <CreatePlaylistModal onClose={() => setShowCreatePlaylist(false)} initialTrackId={track.id} />}
    </>
  );
}

/* ── Recently Played ─────────────────────────────────────────── */
function RecentlyPlayed() {
  const { history, loadAndPlay } = usePlayerStore();
  const { openArtist } = useLibraryStore();
  if (!history.length) return null;
  const recent = history.slice(0, 6);
  return (
    <div className="recently-section">
      <div className="recently-header">
        <ClockIcon />
        <h2>Ostatnio odtwarzane</h2>
      </div>
      <div className="recently-grid">
        {recent.map((track) => (
          <div key={track.id} className="recently-card" onClick={() => loadAndPlay(track, history, history.indexOf(track))}>
            <div className="recently-cover">
              {track.coverUrl ? <img src={track.coverUrl} alt={track.title} /> : <MusicIcon />}
              <div className="recently-play"><PlayIcon /></div>
            </div>
            <p className="recently-title">{track.title}</p>
            <p className="recently-artist player-link" onClick={(e) => { e.stopPropagation(); openArtist(track.artist); }}>{track.artist}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── All Tracks View ─────────────────────────────────────────── */
export function AllTracksView() {
  const { tracks } = useLibraryStore();
  const [showUpload, setShowUpload] = useState(false);
  const [sort, setSort] = useState('dateAdded');

  const sorted = [...tracks].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'artist') return a.artist.localeCompare(b.artist);
    if (sort === 'album') return a.album.localeCompare(b.album);
    return b.dateAdded - a.dateAdded;
  });

  return (
    <div className="view-content">
      <HomeHero />
      <SmartMixes />
      <RecentlyPlayed />
      <div className="view-header">
        <h2 className="view-title view-title--sm">Wszystkie utwory</h2>
        <div className="view-actions">
          <select className="sort-select" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="dateAdded">Data dodania</option>
            <option value="title">Tytuł</option>
            <option value="artist">Artysta</option>
            <option value="album">Album</option>
          </select>
          <button className="btn btn--primary" onClick={() => setShowUpload(true)}>
            <UploadIcon /> Dodaj muzykę
          </button>
        </div>
      </div>
      {tracks.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon"><MusicIcon /></span>
          <h2>Twoja biblioteka jest pusta</h2>
          <p>Wgraj pliki audio, żeby zacząć słuchać muzyki</p>
          <button className="btn btn--primary btn--lg" onClick={() => setShowUpload(true)}>
            <UploadIcon /> Dodaj muzykę
          </button>
        </div>
      ) : (
        <VirtualTrackList
          items={sorted}
          header={<div className="tracks-header"><span>#</span><span>Tytuł</span><span className="hide-sm">Album</span><span></span></div>}
          renderItem={(track, i) => <TrackRow key={track.id} track={track} index={i} queue={sorted} showIndex />}
        />
      )}
      {showUpload && <UploadZone onClose={() => setShowUpload(false)} />}
    </div>
  );
}

/* ── Albums View ─────────────────────────────────────────────── */
export function AlbumsView() {
  const { tracks, selectedAlbum, clearSelectedAlbum, openArtist, openAlbum } = useLibraryStore();
  const { loadAndPlay, toggleShuffle } = usePlayerStore();
  const [filter, setFilter] = useState('');

  const albums = useMemo(() => {
    const map = {};
    tracks.forEach(t => {
      const key = `${t.album}|||${t.artist}`;
      if (!map[key]) {
        map[key] = {
          name: t.album,
          artist: t.artist,
          cover: null,
          tracks: [],
          year: t.year || ''
        };
      }
      if (!map[key].cover && t.coverUrl) map[key].cover = t.coverUrl;
      if (!map[key].year && t.year) map[key].year = t.year;
      map[key].tracks.push(t);
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [tracks]);

  // Single Album Detail View (Karta Albumu)
  if (selectedAlbum) {
    const album = albums.find(a => a.name.toLowerCase() === selectedAlbum.toLowerCase())
      || { name: selectedAlbum, artist: 'Nieznany wykonawca', cover: null, tracks: tracks.filter(t => t.album.toLowerCase() === selectedAlbum.toLowerCase()) };

    const totalSeconds = album.tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    const m = Math.floor(totalSeconds / 60);

    return (
      <div className="view-content">
        <button className="back-btn" onClick={clearSelectedAlbum}><ChevronLeftIcon /> Wszystkie albumy</button>
        <div className="album-hero">
          <div className="album-hero-cover">
            {album.cover ? <img src={album.cover} alt={album.name} /> : <DiscIcon />}
          </div>
          <div className="album-hero-info">
            <span className="album-badge">ALBUM</span>
            <h1 className="album-hero-title">{album.name}</h1>
            <div className="album-hero-sub">
              <span className="album-hero-artist player-link" onClick={() => openArtist(album.artist)}>
                {album.artist}
              </span>
              {album.year && <span className="album-dot">· {album.year}</span>}
              <span className="album-dot">·</span>
              <span className="album-hero-count">
                {album.tracks.length} {plural(album.tracks.length, 'utwór', 'utwory', 'utworów')}
              </span>
              <span className="album-dot">·</span>
              <span>{m} min</span>
            </div>
            <div className="album-hero-actions">
              <button className="btn btn--primary btn--lg" onClick={() => album.tracks.length > 0 && loadAndPlay(album.tracks[0], album.tracks, 0)}>
                <PlayIcon /> Odtwórz album
              </button>
              <button className="btn btn--ghost" onClick={() => {
                if (album.tracks.length > 0) {
                  usePlayerStore.setState({ shuffle: true });
                  const randIdx = Math.floor(Math.random() * album.tracks.length);
                  loadAndPlay(album.tracks[randIdx], album.tracks, randIdx);
                }
              }} title="Odtwarzaj losowo">
                <ShuffleIcon /> Losowo
              </button>
            </div>
          </div>
        </div>

        <div className="tracks-list">
          <div className="tracks-header">
            <span>#</span><span>Tytuł</span><span className="hide-sm">Album</span><span></span>
          </div>
          {album.tracks.map((t, i) => (
            <TrackRow key={t.id} track={t} index={i} queue={album.tracks} showIndex />
          ))}
        </div>
      </div>
    );
  }

  const filtered = filter
    ? albums.filter(a => a.name.toLowerCase().includes(filter.toLowerCase()) || a.artist.toLowerCase().includes(filter.toLowerCase()))
    : albums;

  return (
    <div className="view-content">
      <div className="view-header">
        <div>
          <h1 className="view-title">Albumy</h1>
          <p className="view-subtitle">{albums.length} {plural(albums.length, 'album', 'albumy', 'albumów')}</p>
        </div>
        {albums.length > 3 && (
          <div className="search-filter-mini">
            <SearchIconSVG />
            <input type="text" placeholder="Filtruj albumy..." value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon"><DiscIcon /></span>
          <h2>Brak albumów</h2>
          <p>Wgraj utwory z tagami albumu, a pojawią się one automatycznie tutaj.</p>
        </div>
      ) : (
        <div className="albums-grid">
          {filtered.map(album => (
            <div key={`${album.name}-${album.artist}`} className="album-card" onClick={() => openAlbum(album.name)}>
              <div className="album-card-cover">
                {album.cover ? <img src={album.cover} alt={album.name} /> : <DiscIcon />}
                <button className="album-play-btn" onClick={e => {
                  e.stopPropagation();
                  loadAndPlay(album.tracks[0], album.tracks, 0);
                }} title="Odtwórz">
                  <PlayIcon />
                </button>
              </div>
              <p className="album-card-name" title={album.name}>{album.name}</p>
              <p className="album-card-artist player-link" onClick={(e) => {
                e.stopPropagation();
                openArtist(album.artist);
              }} title={album.artist}>
                {album.artist}
              </p>
              <p className="album-card-count">
                {album.tracks.length} {plural(album.tracks.length, 'utwór', 'utwory', 'utworów')}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Artists View ────────────────────────────────────────────── */
export function ArtistsView() {
  const { tracks, playLog, selectedArtist, clearSelectedArtist, openArtist, openAlbum } = useLibraryStore();
  const ranks = useMemo(() => artistRanks(tracks, playLog), [tracks, playLog]);
  const { loadAndPlay } = usePlayerStore();
  const [filter, setFilter] = useState('');

  // Group all artists
  const artists = useMemo(() => {
    const map = {};
    tracks.forEach(t => {
      const artName = t.artist || 'Nieznany wykonawca';
      if (!map[artName]) {
        map[artName] = {
          name: artName,
          cover: null,
          tracks: [],
        };
      }
      if (!map[artName].cover && t.coverUrl) map[artName].cover = t.coverUrl;
      map[artName].tracks.push(t);
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [tracks]);

  // Single Artist Detail View (Karta Artysty)
  if (selectedArtist) {
    const artist = artists.find(a => a.name.toLowerCase() === selectedArtist.toLowerCase())
      || { name: selectedArtist, cover: null, tracks: tracks.filter(t => t.artist.toLowerCase() === selectedArtist.toLowerCase()) };

    const artistTracks = artist.tracks;
    const totalSeconds = artistTracks.reduce((sum, t) => sum + (t.duration || 0), 0);
    const m = Math.floor(totalSeconds / 60);

    // Group albums for this artist
    const artistAlbumsMap = {};
    artistTracks.forEach(t => {
      if (!artistAlbumsMap[t.album]) {
        artistAlbumsMap[t.album] = {
          name: t.album,
          cover: t.coverUrl,
          tracks: [],
          year: t.year || '',
        };
      }
      if (!artistAlbumsMap[t.album].cover && t.coverUrl) artistAlbumsMap[t.album].cover = t.coverUrl;
      artistAlbumsMap[t.album].tracks.push(t);
    });
    const artistAlbums = Object.values(artistAlbumsMap);

    return (
      <div className="view-content">
        <button className="back-btn" onClick={clearSelectedArtist}><ChevronLeftIcon /> Wszyscy artyści</button>

        {/* Hero Banner — Karta Artysty */}
        <div className="artist-hero">
          <div className={`artist-hero-avatar ${!artist.cover ? 'artist-hero-avatar--placeholder' : ''}`}>
            {artist.cover ? <img src={artist.cover} alt={artist.name} /> : artist.name ? <span>{artist.name[0]}</span> : <MicIcon />}
          </div>
          <div className="artist-hero-info">
            {ranks.get(artist.name) && (
              <div className="artist-badge">
                <VerifiedIcon />
                <span>
                  {ranks.get(artist.name).rank <= 5 ? `#${ranks.get(artist.name).rank} w Twoim topie · ` : ''}
                  {formatPlural(ranks.get(artist.name).count, 'odtworzenie', 'odtworzenia', 'odtworzeń')}
                </span>
              </div>
            )}
            <h1 className="artist-hero-name">{artist.name}</h1>
            <p className="artist-hero-count">
              {artistTracks.length} {plural(artistTracks.length, 'utwór', 'utwory', 'utworów')} · {artistAlbums.length} {plural(artistAlbums.length, 'album', 'albumy', 'albumów')} · Łącznie {m} min
            </p>
            <div className="artist-hero-actions">
              <button className="btn btn--primary btn--lg" onClick={() => artistTracks.length > 0 && loadAndPlay(artistTracks[0], artistTracks, 0)}>
                <PlayIcon /> Odtwórz wszystko
              </button>
              <button className="btn btn--ghost" onClick={() => {
                if (artistTracks.length > 0) {
                  usePlayerStore.setState({ shuffle: true });
                  const randIdx = Math.floor(Math.random() * artistTracks.length);
                  loadAndPlay(artistTracks[randIdx], artistTracks, randIdx);
                }
              }} title="Odtwarzaj losowo">
                <ShuffleIcon /> Losowo
              </button>
            </div>
          </div>
        </div>

        {/* Section 1: Albumy artysty */}
        {artistAlbums.length > 0 && (
          <div className="artist-section">
            <h2 className="section-title">Albumy i wydania</h2>
            <div className="albums-grid">
              {artistAlbums.map(alb => (
                <div key={alb.name} className="album-card" onClick={() => openAlbum(alb.name)}>
                  <div className="album-card-cover">
                    {alb.cover ? <img src={alb.cover} alt={alb.name} /> : <DiscIcon />}
                    <button className="album-play-btn" onClick={e => {
                      e.stopPropagation();
                      loadAndPlay(alb.tracks[0], alb.tracks, 0);
                    }}>
                      <PlayIcon />
                    </button>
                  </div>
                  <p className="album-card-name" title={alb.name}>{alb.name}</p>
                  <p className="album-card-artist">{alb.tracks.length} {plural(alb.tracks.length, 'utwór', 'utwory', 'utworów')}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section 2: Utwory artysty */}
        <div className="artist-section" style={{ marginTop: 32 }}>
          <h2 className="section-title">Wszystkie utwory</h2>
          <div className="tracks-list">
            <div className="tracks-header">
              <span>#</span><span>Tytuł</span><span className="hide-sm">Album</span><span></span>
            </div>
            {artistTracks.map((t, i) => (
              <TrackRow key={t.id} track={t} index={i} queue={artistTracks} showIndex />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const filtered = filter
    ? artists.filter(a => a.name.toLowerCase().includes(filter.toLowerCase()))
    : artists;

  return (
    <div className="view-content">
      <div className="view-header">
        <div>
          <h1 className="view-title">Artyści</h1>
          <p className="view-subtitle">{artists.length} {plural(artists.length, 'artysta', 'artystów', 'artystów')}</p>
        </div>
        {artists.length > 3 && (
          <div className="search-filter-mini">
            <SearchIconSVG />
            <input type="text" placeholder="Filtruj artystów..." value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon"><MicIcon /></span>
          <h2>Brak artystów</h2>
          <p>Wgraj utwory z tagami artystów lub nazwij pliki „Artysta - Tytuł.mp3”.</p>
        </div>
      ) : (
        <div className="artists-grid">
          {filtered.map(artist => (
            <div key={artist.name} className="artist-card" onClick={() => openArtist(artist.name)}>
              <div className={`artist-card-avatar ${!artist.cover ? 'artist-card-avatar--placeholder' : ''}`}>
                {artist.cover ? <img src={artist.cover} alt={artist.name} /> : artist.name ? <span>{artist.name[0]}</span> : <MicIcon />}
                <button className="artist-play-btn" onClick={e => {
                  e.stopPropagation();
                  loadAndPlay(artist.tracks[0], artist.tracks, 0);
                }} title={`Odtwórz ${artist.name}`}>
                  <PlayIcon />
                </button>
              </div>
              <p className="artist-card-name" title={artist.name}>{artist.name}</p>
              <p className="artist-card-badge">Wykonawca</p>
              <p className="artist-card-count">
                {artist.tracks.length} {plural(artist.tracks.length, 'utwór', 'utwory', 'utworów')}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Favorites View ──────────────────────────────────────────── */
export function FavoritesView() {
  const { tracks } = useLibraryStore();
  const favorites = tracks.filter(t => t.favorite);
  return (
    <div className="view-content">
      <div className="view-header">
        <div>
          <h1 className="view-title">Ulubione utwory</h1>
          <p className="view-subtitle">{favorites.length} {plural(favorites.length, 'polubiony utwór', 'polubione utwory', 'polubionych utworów')}</p>
        </div>
        <HeartIcon filled />
      </div>
      {favorites.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-icon"><HeartIcon filled /></span>
          <h2>Brak ulubionych</h2>
          <p>Kliknij serduszko przy dowolnym utworze, żeby zapisać go w Ulubionych.</p>
        </div>
      ) : (
        <VirtualTrackList
          items={favorites}
          header={<div className="tracks-header"><span>#</span><span>Tytuł</span><span className="hide-sm">Album</span><span></span></div>}
          renderItem={(t, i) => <TrackRow key={t.id} track={t} index={i} queue={favorites} showIndex />}
        />
      )}
    </div>
  );
}

/* ── Search View ─────────────────────────────────────────────── */
export function SearchView() {
  const { tracks, searchQuery, setSearchQuery, openArtist, openAlbum } = useLibraryStore();
  const inputRef = useRef();
  useEffect(() => { inputRef.current?.focus(); }, []);

  const q = searchQuery.trim().toLowerCase();

  const matchingTracks = q
    ? tracks.filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q))
    : [];

  const matchingArtists = useMemo(() => {
    if (!q) return [];
    const map = {};
    tracks.forEach(t => {
      if (t.artist.toLowerCase().includes(q)) {
        if (!map[t.artist]) map[t.artist] = { name: t.artist, cover: t.coverUrl, count: 0 };
        map[t.artist].count++;
      }
    });
    return Object.values(map);
  }, [tracks, q]);

  const matchingAlbums = useMemo(() => {
    if (!q) return [];
    const map = {};
    tracks.forEach(t => {
      if (t.album.toLowerCase().includes(q)) {
        if (!map[t.album]) map[t.album] = { name: t.album, artist: t.artist, cover: t.coverUrl, count: 0 };
        map[t.album].count++;
      }
    });
    return Object.values(map);
  }, [tracks, q]);

  return (
    <div className="view-content">
      <div className="view-header"><h1 className="view-title">Szukaj w bibliotece</h1></div>
      <div className="search-bar-wrap">
        <SearchIconSVG />
        <input ref={inputRef} className="search-bar-input" placeholder="Wyszukaj utwór, artystę lub album..."
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
        {searchQuery && <button className="icon-btn" onClick={() => setSearchQuery('')}><XIcon /></button>}
      </div>

      {searchQuery && matchingTracks.length === 0 && matchingArtists.length === 0 && (
        <div className="empty-state"><span className="empty-state-icon"><SearchIconSVG /></span><p>Brak wyników dla „{searchQuery}"</p></div>
      )}

      {/* Artyści */}
      {matchingArtists.length > 0 && (
        <div className="search-section">
          <h2 className="section-title">Artyści</h2>
          <div className="artists-grid">
            {matchingArtists.map(art => (
              <div key={art.name} className="artist-card" onClick={() => openArtist(art.name)}>
                <div className={`artist-card-avatar ${!art.cover ? 'artist-card-avatar--placeholder' : ''}`}>
                  {art.cover ? <img src={art.cover} alt={art.name} /> : <span>{art.name[0]}</span>}
                </div>
                <p className="artist-card-name">{art.name}</p>
                <p className="artist-card-badge">Wykonawca</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Albumy */}
      {matchingAlbums.length > 0 && (
        <div className="search-section">
          <h2 className="section-title">Albumy</h2>
          <div className="albums-grid">
            {matchingAlbums.map(alb => (
              <div key={alb.name} className="album-card" onClick={() => openAlbum(alb.name)}>
                <div className="album-card-cover">
                  {alb.cover ? <img src={alb.cover} alt={alb.name} /> : <DiscIcon />}
                </div>
                <p className="album-card-name">{alb.name}</p>
                <p className="album-card-artist">{alb.artist}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Utwory */}
      {matchingTracks.length > 0 && (
        <div className="search-section">
          <h2 className="section-title">Utwory</h2>
          <VirtualTrackList
            items={matchingTracks}
            header={<div className="tracks-header"><span>#</span><span>Tytuł</span><span className="hide-sm">Album</span><span></span></div>}
            renderItem={(t, i) => <TrackRow key={t.id} track={t} index={i} queue={matchingTracks} showIndex />}
          />
        </div>
      )}
    </div>
  );
}
