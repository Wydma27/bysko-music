import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useLibraryStore, usePlayerStore } from '../store';
import { TrackRow } from './Library';
import { XIcon, ChevronUpIcon, ChevronDownIcon } from './Icons';
import { showToast } from '../App';

// Inline SVG icons
const PlusIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="1em" height="1em"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const EditIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em"><path d="M11,4H4A2,2,0,0,0,2,6V20a2,2,0,0,0,2,2H18a2,2,0,0,0,2-2V13"/><path d="M18.5,2.5a2.121,2.121,0,0,1,3,3L12,15l-4,1,1-4Z"/></svg>;
const TrashIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6"/><path d="M14,11v6"/><path d="M9,6V4h6v2"/></svg>;
const MusicIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em"><path d="M9,18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>;
const PlayIcon = () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><polygon points="5,3 19,12 5,21"/></svg>;
const GripIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em"><circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/></svg>;
const SearchIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const CheckIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="1em" height="1em"><polyline points="20 6 9 17 4 12"/></svg>;

// ── Create Playlist Modal ─────────────────────────────────────
export function CreatePlaylistModal({ onClose, initialTrackId, initialTrackIds }) {
  const { createPlaylist, addToPlaylist, setView, tracks } = useLibraryStore();
  const [name, setName] = useState('');
  const inputRef = useRef();
  useEffect(() => inputRef.current?.focus(), []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    const pl = await createPlaylist(name.trim());
    const idsToAdd = initialTrackIds?.length ? initialTrackIds : (initialTrackId ? [initialTrackId] : []);
    for (const id of idsToAdd) await addToPlaylist(pl.id, id);

    if (idsToAdd.length === 1) {
      const t = tracks.find(x => x.id === idsToAdd[0]);
      showToast(`Utworzono playlistę "${pl.name}" z utworem "${t?.title || ''}"`, 'success');
    } else if (idsToAdd.length > 1) {
      showToast(`Utworzono playlistę "${pl.name}" z ${idsToAdd.length} utworami`, 'success');
    } else {
      showToast(`Utworzono playlistę "${pl.name}"`, 'success');
    }
    setView(pl.id);
    onClose();
  };

  return (
    <div className="upload-overlay" onClick={onClose}>
      <div className="mini-modal" onClick={e => e.stopPropagation()}>
        <h3>Nowa playlista</h3>
        <input
          ref={inputRef}
          className="mini-input"
          placeholder="Podaj nazwę playlisty..."
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
        />
        <div className="mini-modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Anuluj</button>
          <button className="btn btn--primary" onClick={handleCreate} disabled={!name.trim()}>Utwórz playlistę</button>
        </div>
      </div>
    </div>
  );
}

// ── Rename Playlist Modal ─────────────────────────────────────
function RenameModal({ playlist, onClose }) {
  const { renamePlaylist } = useLibraryStore();
  const [name, setName] = useState(playlist.name);
  const inputRef = useRef();
  useEffect(() => inputRef.current?.focus(), []);

  const handleSave = async () => {
    if (!name.trim()) return;
    await renamePlaylist(playlist.id, name.trim());
    showToast(`Zmieniono nazwę na "${name.trim()}"`, 'info');
    onClose();
  };

  return (
    <div className="upload-overlay" onClick={onClose}>
      <div className="mini-modal" onClick={e => e.stopPropagation()}>
        <h3>Zmień nazwę playlisty</h3>
        <input
          ref={inputRef}
          className="mini-input"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSave()}
        />
        <div className="mini-modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Anuluj</button>
          <button className="btn btn--primary" onClick={handleSave}>Zapisz</button>
        </div>
      </div>
    </div>
  );
}

// ── Playlist View ─────────────────────────────────────────────
export function PlaylistView({ playlistId }) {
  const { tracks, playlists, addToPlaylist, removeFromPlaylist, reorderPlaylist, deletePlaylist, setView } = useLibraryStore();
  const { loadAndPlay } = usePlayerStore();

  const playlist = playlists.find(p => p.id === playlistId);
  const [showRename, setShowRename] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [addSearch, setAddSearch] = useState('');

  useEffect(() => {
    if (!playlist) setView('all');
  }, [playlist, setView]);

  // Search & suggestions for adding tracks to this playlist (must run before any early return — rules of hooks)
  const searchResults = useMemo(() => {
    if (!playlist) return [];
    const query = addSearch.trim().toLowerCase();
    if (!query) {
      // Return top tracks from library not yet in this playlist
      return tracks.filter(t => !playlist.trackIds.includes(t.id)).slice(0, 8);
    }
    return tracks.filter(t =>
      t.title.toLowerCase().includes(query) ||
      t.artist.toLowerCase().includes(query) ||
      t.album.toLowerCase().includes(query)
    );
  }, [tracks, playlist, addSearch]);

  if (!playlist) {
    return null;
  }

  const playlistTracks = playlist.trackIds
    .map(id => tracks.find(t => t.id === id))
    .filter(Boolean);

  const handleDelete = () => {
    deletePlaylist(playlistId);
    setView('all');
  };

  const handleDragStart = (e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    setOverIdx(idx);
  };

  const handleDrop = async (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setOverIdx(null); return; }
    const newIds = [...playlist.trackIds];
    const [removed] = newIds.splice(dragIdx, 1);
    newIds.splice(idx, 0, removed);
    await reorderPlaylist(playlistId, newIds);
    setDragIdx(null);
    setOverIdx(null);
  };

  const moveTrack = (from, to) => {
    if (to < 0 || to >= playlist.trackIds.length) return;
    const newIds = [...playlist.trackIds];
    const [removed] = newIds.splice(from, 1);
    newIds.splice(to, 0, removed);
    reorderPlaylist(playlistId, newIds);
  };

  const handleAddTrack = async (track) => {
    const res = await addToPlaylist(playlistId, track.id);
    if (res.alreadyIn) {
      showToast(`Utwór "${track.title}" jest już w tej playliście`, 'info');
    } else if (res.success) {
      showToast(`Dodano "${track.title}" do playlisty`, 'success');
    }
  };

  const coverTrack = playlistTracks.find(t => t?.coverUrl);

  return (
    <div className="view-content">
      {/* Hero Banner */}
      <div className="playlist-hero">
        <div className="playlist-hero-cover">
          {coverTrack?.coverUrl
            ? <img src={coverTrack.coverUrl} alt={playlist.name} />
            : <MusicIcon />
          }
        </div>
        <div className="playlist-hero-info">
          <p className="playlist-hero-type">PLAYLISTA</p>
          <h1 className="playlist-hero-title">{playlist.name}</h1>
          <p className="playlist-hero-count">
            {playlistTracks.length} {playlistTracks.length === 1 ? 'utwór' : 'utworów'}
          </p>
          <div className="playlist-hero-actions">
            {playlistTracks.length > 0 && (
              <button className="btn btn--primary btn--lg" onClick={() => loadAndPlay(playlistTracks[0], playlistTracks, 0)}>
                <PlayIcon /> Odtwórz playlistę
              </button>
            )}
            <button className="icon-btn-lg" onClick={() => setShowRename(true)} title="Zmień nazwę playlisty">
              <EditIcon />
            </button>
            <button className="icon-btn-lg danger" onClick={handleDelete} title="Usuń playlistę">
              <TrashIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Playlist Tracks List */}
      {playlistTracks.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 16px' }}>
          <span className="empty-state-icon"><MusicIcon /></span>
          <h2>Playlista jest pusta</h2>
          <p>Wyszukaj i dodaj utwory poniżej lub przeciągnij je z biblioteki!</p>
        </div>
      ) : (
        <div className="tracks-list">
          <div className="tracks-header">
            <span>#</span><span>Tytuł</span><span className="hide-sm">Album</span><span></span>
          </div>
          {playlistTracks.map((track, i) => (
            <div
              key={track.id}
              className={`draggable-row ${overIdx === i && dragIdx !== i ? 'drag-over' : ''}`}
              draggable
              onDragStart={e => handleDragStart(e, i)}
              onDragOver={e => handleDragOver(e, i)}
              onDrop={e => handleDrop(e, i)}
              onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
            >
              <span className="drag-handle" title="Przeciągnij, aby zmienić kolejność"><GripIcon /></span>
              <div className="reorder-buttons">
                <button
                  className="icon-btn reorder-btn"
                  disabled={i === 0}
                  onClick={() => moveTrack(i, i - 1)}
                  aria-label={`Przesuń "${track.title}" w górę`}
                  title="Przesuń w górę"
                >
                  <ChevronUpIcon />
                </button>
                <button
                  className="icon-btn reorder-btn"
                  disabled={i === playlistTracks.length - 1}
                  onClick={() => moveTrack(i, i + 1)}
                  aria-label={`Przesuń "${track.title}" w dół`}
                  title="Przesuń w dół"
                >
                  <ChevronDownIcon />
                </button>
              </div>
              <TrackRow
                track={track}
                index={i}
                queue={playlistTracks}
                showIndex
                onRemove={() => removeFromPlaylist(playlistId, track.id)}
              />
            </div>
          ))}
        </div>
      )}

      {/* ── Section: "Dodaj utwory do tej playlisty" (Find & Add Songs) ── */}
      <div className="playlist-add-section">
        <div className="playlist-add-header">
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>Dodaj muzykę do tej playlisty</h2>
            <p className="playlist-add-desc">Wyszukaj w bibliotece lub wybierz z proponowanych utworów</p>
          </div>
          <div className="search-bar-wrap" style={{ maxWidth: 320, margin: 0 }}>
            <SearchIcon />
            <input
              type="text"
              className="search-bar-input"
              placeholder="Szukaj utworu do dodania..."
              value={addSearch}
              onChange={e => setAddSearch(e.target.value)}
            />
            {addSearch && <button className="icon-btn" onClick={() => setAddSearch('')}><XIcon /></button>}
          </div>
        </div>

        {searchResults.length === 0 ? (
          <p className="playlist-empty-search">Brak pasujących utworów w Twojej bibliotece.</p>
        ) : (
          <div className="playlist-candidates-list">
            {searchResults.map((t) => {
              const alreadyIn = playlist.trackIds.includes(t.id);
              return (
                <div key={t.id} className="candidate-row">
                  <div className="candidate-cover">
                    {t.coverUrl ? <img src={t.coverUrl} alt={t.title} /> : <MusicIcon />}
                  </div>
                  <div className="candidate-info">
                    <span className="candidate-title">{t.title}</span>
                    <span className="candidate-artist">{t.artist} · {t.album}</span>
                  </div>
                  <button
                    className={`btn btn--sm ${alreadyIn ? 'btn--ghost' : 'btn--secondary'} candidate-add-btn`}
                    onClick={() => handleAddTrack(t)}
                    disabled={alreadyIn}
                  >
                    {alreadyIn ? (
                      <>
                        <CheckIcon /> Dodano
                      </>
                    ) : (
                      <>
                        <PlusIcon /> Dodaj do playlisty
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showRename && <RenameModal playlist={playlist} onClose={() => setShowRename(false)} />}
    </div>
  );
}

// ── Playlists Sidebar Section ─────────────────────────────────
export function PlaylistsSidebar() {
  const { playlists, view, setView, addToPlaylist } = useLibraryStore();
  const [showCreate, setShowCreate] = useState(false);

  const handleDropOnPlaylist = async (e, pl) => {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const trackId = e.dataTransfer.getData('text/plain');
    if (trackId) {
      const res = await addToPlaylist(pl.id, trackId);
      if (res.alreadyIn) {
        showToast(`Utwór jest już w playliście "${pl.name}"`, 'info');
      } else if (res.success) {
        showToast(`Dodano do playlisty "${pl.name}"`, 'success');
      }
    }
  };

  return (
    <div className="sidebar-playlists">
      <div className="sidebar-section-header">
        <span>Playlisty</span>
        <button className="icon-btn" onClick={() => setShowCreate(true)} title="Utwórz nową playlistę">
          <PlusIcon />
        </button>
      </div>
      <div className="sidebar-playlist-list">
        {playlists.length === 0 && (
          <p className="sidebar-empty">Brak playlist. Kliknij +, żeby utworzyć.</p>
        )}
        {playlists.map(pl => (
          <button
            key={pl.id}
            className={`sidebar-playlist-item ${view === pl.id ? 'active' : ''}`}
            onClick={() => setView(pl.id)}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
            onDragLeave={(e) => { e.currentTarget.classList.remove('drag-over'); }}
            onDrop={(e) => handleDropOnPlaylist(e, pl)}
            title={`Playlista: ${pl.name} (możesz upuścić utwór tutaj)`}
          >
            <MusicIcon />
            <span>{pl.name}</span>
          </button>
        ))}
      </div>
      {showCreate && <CreatePlaylistModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
