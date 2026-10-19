import React, { useEffect, useState, useRef } from 'react';
import { useLibraryStore, usePlayerStore, useAuthStore } from './store';
import { PlayerBar, NowPlayingModal, QueuePanel } from './components/Player';
import { AllTracksView, AlbumsView, ArtistsView, FavoritesView, SearchView } from './components/Library';
import { PlaylistView, PlaylistsSidebar, CreatePlaylistModal } from './components/Playlists';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthModal } from './components/AuthModal';
import { StatsView } from './components/Discover';
import { CommandPalette } from './components/CommandPalette';
import { VibeStudioModal, AppearanceModal, AmbientBackground } from './components/Studio';
import { MiniPlayerHost } from './components/MiniPlayer';
import { ShareModal } from './components/Share';
import { FocusModal, FocusPill } from './components/Focus';
import { PartyModal, PartyPill, PartyGuestView } from './components/Party';
import { openInviteFromUrl } from './party';
import { ChangePasswordModal, DefaultPasswordBanner } from './components/Account';
import { useUiStore, applyTheme } from './ui';
import {
  TargetIcon,
  RadioIcon,
  WandIcon,
  PaletteIcon,
  CommandIcon,
  ActivityIcon,
  LogoIcon,
  HomeIcon,
  SearchIcon,
  LibraryIcon,
  MusicIcon,
  HeartIcon,
  ShieldIcon,
  ShieldCheckIcon,
  UserIcon,
  LogOutIcon,
  KeyIcon,
  KeyboardIcon,
  SunIcon,
  MoonIcon,
  MenuIcon,
  XIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  InfoIcon,
  AlertTriangleIcon,
  PlusIcon,
  TrashIcon
} from './components/Icons';

const TOAST_ICONS = { success: CheckIcon, error: AlertTriangleIcon, info: InfoIcon };

// ── Keyboard Shortcuts ─────────────────────────────────────────
function useKeyboardShortcuts() {
  const player = usePlayerStore;
  const library = useLibraryStore;
  const auth = useAuthStore;

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const ui = useUiStore.getState();
        ui.setShowPalette(!ui.showPalette);
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      const { togglePlay, next, prev, toggleMute, toggleShuffle, toggleRepeat, setShowNowPlaying, setShowQueue, showNowPlaying, showQueue } = player.getState();
      const { toggleFavorite, setView } = library.getState();
      const { isAdmin } = auth.getState();

      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break;
        case 'ArrowRight': if (e.shiftKey) { e.preventDefault(); next(); } break;
        case 'ArrowLeft': if (e.shiftKey) { e.preventDefault(); prev(); } break;
        case 'm': case 'M': toggleMute(); break;
        case 's': case 'S': if (!e.ctrlKey && !e.metaKey) toggleShuffle(); break;
        case 'r': case 'R': toggleRepeat(); break;
        case 'f': case 'F': setShowNowPlaying(!showNowPlaying); break;
        case 'q': case 'Q': setShowQueue(!showQueue); break;
        case 'l': case 'L': { const t = player.getState().currentTrack; if (t) toggleFavorite(t.id); break; }
        case '1': setView('all'); break;
        case '2': setView('albums'); break;
        case '3': setView('artists'); break;
        case '4': setView('favorites'); break;
        case '5': setView('search'); break;
        case '6': setView('stats'); break;
        case '0': if (isAdmin()) setView('admin'); break;
        case 'v': case 'V': if (!e.ctrlKey && !e.metaKey) useUiStore.getState().setShowVibe(true); break;
        case 't': case 'T': {
          const ui = useUiStore.getState();
          if (!player.getState().currentTrack) break;
          if (!showNowPlaying) { setShowNowPlaying(true); ui.setShowLyrics(true); }
          else ui.setShowLyrics(!ui.showLyrics);
          break;
        }
        case 'Escape': {
          const ui = useUiStore.getState();
          if (ui.share) ui.setShare(null);
          else if (ui.showVibe) ui.setShowVibe(false);
          else if (ui.showAppearance) ui.setShowAppearance(false);
          else if (ui.showFocus) ui.setShowFocus(false);
          else if (ui.showParty) ui.setShowParty(false);
          else if (ui.showPassword) ui.setShowPassword(false);
          else if (showNowPlaying) setShowNowPlaying(false);
          else if (showQueue) setShowQueue(false);
          break;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}

// ── Browser History Sync (makes the back/forward buttons real) ─
function useHistorySync() {
  const isRestoring = useRef(false);
  const { view, selectedArtist, selectedAlbum } = useLibraryStore();

  useEffect(() => {
    window.history.replaceState({ view: 'all', selectedArtist: null, selectedAlbum: null }, '');
    const onPopState = (e) => {
      const state = e.state || { view: 'all', selectedArtist: null, selectedAlbum: null };
      isRestoring.current = true;
      useLibraryStore.setState({
        view: state.view,
        selectedArtist: state.selectedArtist || null,
        selectedAlbum: state.selectedAlbum || null,
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (isRestoring.current) { isRestoring.current = false; return; }
    window.history.pushState({ view, selectedArtist, selectedAlbum }, '');
  }, [view, selectedArtist, selectedAlbum]);
}

// ── Keyboard Help Modal ────────────────────────────────────────
function ShortcutsHelp({ onClose }) {
  const rows = [
    ['Spacja', 'Play / Pause'], ['Shift + →', 'Następny'], ['Shift + ←', 'Poprzedni'],
    ['M', 'Wycisz'], ['S', 'Losowo'], ['R', 'Powtarzaj'], ['L', 'Polub'],
    ['F', 'Teraz odtwarzane'], ['T', 'Tekst piosenki'], ['Q', 'Kolejka'], ['V', 'Vibe Studio (efekty)'], ['Ctrl + K', 'Paleta komend'],
    ['1–6', 'Widoki (6 = Twój puls)'], ['0', 'Panel Admina (jeśli admin)'], ['Esc', 'Zamknij'],
  ];
  return (
    <div className="upload-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={e => e.stopPropagation()}>
        <div className="upload-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <KeyboardIcon />
            <h2>Skróty klawiszowe</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Zamknij"><XIcon /></button>
        </div>
        <div className="shortcuts-list">
          {rows.map(([key, desc]) => (
            <div key={key} className="shortcut-row">
              <kbd className="kbd">{key}</kbd>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Toast System ───────────────────────────────────────────────
let _toastId = 0;
const _listeners = new Set();
export function showToast(msg, type = 'info', options = {}) {
  const id = ++_toastId;
  const { actionLabel, onAction, duration = 3000 } = options;
  _listeners.forEach(fn => fn({ id, msg, type, actionLabel, onAction }));
  setTimeout(() => _listeners.forEach(fn => fn({ id, remove: true })), duration);
  return id;
}

function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    const h = (t) => t.remove
      ? setToasts(p => p.filter(x => x.id !== t.id))
      : setToasts(p => [...p, t]);
    _listeners.add(h);
    return () => _listeners.delete(h);
  }, []);
  return (
    <div className="toast-container">
      {toasts.map(t => {
        const Icon = TOAST_ICONS[t.type] || InfoIcon;
        return (
          <div key={t.id} className={`toast toast--${t.type}`}>
            <Icon />
            <span>{t.msg}</span>
            {t.actionLabel && (
              <button
                className="toast-action"
                onClick={() => { t.onAction?.(); setToasts(p => p.filter(x => x.id !== t.id)); }}
              >
                {t.actionLabel}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Bulk Selection Bar ───────────────────────────────────────────
function SelectionBar() {
  const { selectedIds, playlists, clearSelected, bulkDeleteTracks, bulkAddToFavorites, bulkAddToPlaylist } = useLibraryStore();
  const [showPlaylistMenu, setShowPlaylistMenu] = useState(false);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowPlaylistMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (selectedIds.length === 0) return null;

  return (
    <>
      <div className="selection-bar">
        <button className="icon-btn" onClick={clearSelected} aria-label="Anuluj zaznaczenie"><XIcon /></button>
        <span className="selection-count">{selectedIds.length} zaznaczonych</span>
        <div className="selection-actions">
          <button className="btn btn--ghost btn--sm" onClick={() => bulkAddToFavorites(selectedIds)}>
            <HeartIcon /> Do ulubionych
          </button>
          <div className="submenu-wrap" ref={menuRef}>
            <button className="btn btn--ghost btn--sm" onClick={() => setShowPlaylistMenu(v => !v)}>
              <PlusIcon /> Dodaj do playlisty
            </button>
            {showPlaylistMenu && (
              <div className="submenu selection-playlist-menu">
                <button className="submenu-create-btn" onClick={() => { setShowCreatePlaylist(true); setShowPlaylistMenu(false); }}>
                  <PlusIcon /> Nowa playlista
                </button>
                {playlists.length > 0 && <div className="menu-divider" />}
                {playlists.map(pl => (
                  <button key={pl.id} onClick={() => { bulkAddToPlaylist(pl.id, selectedIds); setShowPlaylistMenu(false); }}>
                    <span>{pl.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn--ghost btn--sm danger" onClick={() => bulkDeleteTracks(selectedIds)}>
            <TrashIcon /> Usuń
          </button>
        </div>
      </div>
      {showCreatePlaylist && <CreatePlaylistModal onClose={() => setShowCreatePlaylist(false)} initialTrackIds={selectedIds} />}
    </>
  );
}

// ── Topbar ─────────────────────────────────────────────────────
function Topbar({ onOpenAuth }) {
  const { view, setView, clearSelectedArtist, clearSelectedAlbum, tracks } = useLibraryStore();
  const { currentUser, isAdmin, logout } = useAuthStore();
  const { setShowPalette, setShowPassword } = useUiStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const total = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const artists = new Set(tracks.map(t => t.artist)).size;
  const albums = new Set(tracks.map(t => t.album)).size;
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60);
  const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;

  return (
    <header className="topbar">
      <div className="topbar-left">
        {/* Navigation arrows */}
        <div className="topbar-nav-arrows">
          <button className="topbar-nav-btn" onClick={() => window.history.back()} title="Wstecz">
            <ChevronLeftIcon />
          </button>
          <button className="topbar-nav-btn" onClick={() => window.history.forward()} title="Dalej">
            <ChevronRightIcon />
          </button>
        </div>

        {/* Minimal stats pills inside topbar */}
        {tracks.length > 0 && (
          <div className="topbar-stats">
            <button className={`topbar-stat-pill ${view === 'all' ? 'topbar-stat-pill--active' : ''}`} onClick={() => setView('all')} title="Wszystkie utwory">
              <strong>{tracks.length}</strong> utw.
            </button>
            <button className={`topbar-stat-pill ${view === 'artists' ? 'topbar-stat-pill--active' : ''}`} onClick={() => { clearSelectedArtist(); setView('artists'); }} title="Artyści">
              <strong>{artists}</strong> art.
            </button>
            <button className={`topbar-stat-pill ${view === 'albums' ? 'topbar-stat-pill--active' : ''}`} onClick={() => { clearSelectedAlbum(); setView('albums'); }} title="Albumy">
              <strong>{albums}</strong> alb.
            </button>
            <span className="topbar-stat-pill topbar-stat-pill--time" title="Łączny czas">
              {timeStr}
            </span>
          </div>
        )}
      </div>

      <button className="command-trigger" onClick={() => setShowPalette(true)} title="Paleta komend (Ctrl+K)">
        <SearchIcon />
        <span className="command-trigger-text">Szukaj lub wpisz komendę…</span>
        <kbd className="kbd-inline">Ctrl K</kbd>
      </button>

      <div className="topbar-right" ref={dropdownRef}>
        <FocusPill />
        <PartyPill />
        {currentUser ? (
          <div className="topbar-user-wrap">
            <button
              className={`topbar-user-btn ${dropdownOpen ? 'topbar-user-btn--active' : ''}`}
              onClick={() => setDropdownOpen(!dropdownOpen)}
              aria-label="Menu profilu"
            >
              <div className={`topbar-avatar ${isAdmin() ? 'topbar-avatar--admin' : ''}`}>
                {isAdmin() ? <ShieldCheckIcon /> : <UserIcon />}
              </div>
              <span className="topbar-username">
                {currentUser.displayName || currentUser.username}
              </span>
              <ChevronDownIcon />
            </button>

            {dropdownOpen && (
              <div className="topbar-dropdown">
                <div className="dropdown-user-header">
                  <div className="dropdown-user-name">{currentUser.displayName || currentUser.username}</div>
                  <div className={`dropdown-role-badge ${isAdmin() ? 'dropdown-role-badge--admin' : ''}`}>
                    {isAdmin() ? 'Administrator' : 'Słuchacz'}
                  </div>
                </div>
                <div className="dropdown-divider" />
                {isAdmin() && (
                  <button
                    className="dropdown-item"
                    onClick={() => { setView('admin'); setDropdownOpen(false); }}
                  >
                    <ShieldCheckIcon />
                    <span>Panel Administratora</span>
                  </button>
                )}
                <button
                  className="dropdown-item"
                  onClick={() => { setShowPassword(true); setDropdownOpen(false); }}
                >
                  <KeyIcon />
                  <span>Zmień hasło</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => { onOpenAuth(); setDropdownOpen(false); }}
                >
                  <UserIcon />
                  <span>Zmień konto / Zaloguj</span>
                </button>
                <div className="dropdown-divider" />
                <button
                  className="dropdown-item dropdown-item--danger"
                  onClick={() => { logout(); setDropdownOpen(false); showToast('Wylogowano pomyślnie', 'info'); }}
                >
                  <LogOutIcon />
                  <span>Wyloguj</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className="topbar-login-btn" onClick={onOpenAuth}>
            <UserIcon />
            <span>Zaloguj się</span>
          </button>
        )}
      </div>
    </header>
  );
}

// ── Sidebar ────────────────────────────────────────────────────
function Sidebar({ open, setOpen, onShortcuts }) {
  const { view, setView } = useLibraryStore();
  const { isAdmin } = useAuthStore();
  const { mode, toggleMode, setShowVibe, setShowAppearance, setShowPalette, setShowFocus, setShowParty } = useUiStore();

  const nav = [
    { id: 'all', icon: <HomeIcon />, label: 'Strona główna', key: '1' },
    { id: 'search', icon: <SearchIcon />, label: 'Szukaj', key: '5' },
    { id: 'albums', icon: <LibraryIcon />, label: 'Albumy', key: '2' },
    { id: 'artists', icon: <MusicIcon />, label: 'Artyści', key: '3' },
    { id: 'favorites', icon: <HeartIcon />, label: 'Ulubione', key: '4' },
    { id: 'stats', icon: <ActivityIcon />, label: 'Twój puls', key: '6' },
  ];

  if (isAdmin()) {
    nav.push({ id: 'admin', icon: <ShieldCheckIcon />, label: 'Panel Admina', key: '0' });
  }

  const go = (id) => { setView(id); if (window.innerWidth < 768) setOpen(false); };

  return (
    <>
      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'sidebar--open' : ''}`}>
        <div className="sidebar-logo">
          <div className="logo-icon"><LogoIcon size={26} /></div>
          <span className="logo-text">BySko Music</span>
          <button className="icon-btn sidebar-close-btn" onClick={() => setOpen(false)}><XIcon /></button>
        </div>
        <nav className="sidebar-nav">
          {nav.map(item => (
            <button key={item.id} className={`sidebar-nav-item ${view === item.id ? 'active' : ''}`} onClick={() => go(item.id)}>
              {item.icon}<span>{item.label}</span><kbd className="sidebar-kbd">{item.key}</kbd>
            </button>
          ))}
        </nav>
        
        <PlaylistsSidebar />

        <div className="sidebar-tools">
          <button className="sidebar-tool sidebar-tool--vibe" onClick={() => setShowVibe(true)}>
            <WandIcon /><span>Vibe Studio</span><kbd className="sidebar-kbd">V</kbd>
          </button>
          <button className="sidebar-tool" onClick={() => setShowFocus(true)}>
            <TargetIcon /><span>Tryb Focus</span>
          </button>
          <button className="sidebar-tool" onClick={() => setShowParty(true)}>
            <RadioIcon /><span>Wspólne słuchanie</span>
          </button>
          <button className="sidebar-tool" onClick={() => setShowPalette(true)}>
            <CommandIcon /><span>Komendy</span><kbd className="sidebar-kbd">Ctrl K</kbd>
          </button>
        </div>

        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={() => setShowAppearance(true)}>
            <PaletteIcon />
            <span>Wygląd i palety</span>
          </button>
          <div className="sidebar-footer-row">
            <button className="theme-toggle" onClick={toggleMode} title={mode === 'dark' ? 'Tryb jasny' : 'Tryb ciemny'}>
              {mode === 'dark' ? <SunIcon /> : <MoonIcon />}
              <span>{mode === 'dark' ? 'Jasny' : 'Ciemny'}</span>
            </button>
            <button className="theme-toggle" onClick={onShortcuts} title="Skróty klawiszowe">
              <KeyboardIcon />
              <span>Skróty</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ── Main Content ───────────────────────────────────────────────
function MainContent() {
  const { view } = useLibraryStore();
  switch (view) {
    case 'all': return <AllTracksView />;
    case 'albums': return <AlbumsView />;
    case 'artists': return <ArtistsView />;
    case 'favorites': return <FavoritesView />;
    case 'search': return <SearchView />;
    case 'stats': return <StatsView />;
    case 'admin': return <AdminDashboard />;
    default: return <PlaylistView playlistId={view} />;
  }
}

// ── App Root ───────────────────────────────────────────────────
export default function App() {
  const { init, loading } = useLibraryStore();
  const { showNowPlaying, showQueue, dominantColor } = usePlayerStore();
  const { initAuth, isAdmin } = useAuthStore();
  const {
    showVibe, showAppearance, showFocus, showPassword,
    setShowVibe, setShowAppearance, setShowFocus, setShowPassword, setDynamicColor,
  } = useUiStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useKeyboardShortcuts();
  useHistorySync();

  useEffect(() => {
    applyTheme();
    openInviteFromUrl();
    init();
    initAuth();
  }, []);

  // Kameleon palette: the accent follows the cover of whatever is playing.
  useEffect(() => { setDynamicColor(dominantColor); }, [dominantColor, setDynamicColor]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-logo"><LogoIcon size={44} /></div>
        <p>BySko Music</p>
        <div className="loading-bar"><div /></div>
      </div>
    );
  }

  return (
    <>
    <AmbientBackground />
    <div className="app-layout">
      <div className="mobile-topbar">
        <button className="icon-btn" onClick={() => setSidebarOpen(true)}><MenuIcon /></button>
        <div className="logo-mobile">
          <LogoIcon size={20} />
          <span>BySko Music</span>
        </div>
        <button className="mobile-user-badge" onClick={() => setShowAuthModal(true)} title="Profil / Logowanie">
          {isAdmin() ? <ShieldCheckIcon /> : <UserIcon />}
        </button>
      </div>

      <Sidebar
        open={sidebarOpen}
        setOpen={setSidebarOpen}
        onShortcuts={() => setShowShortcuts(true)}
      />

      <div className="content-area">
        <Topbar onOpenAuth={() => setShowAuthModal(true)} />
        <DefaultPasswordBanner />
        <MainContent />
      </div>

      {showQueue && <QueuePanel />}
      {showNowPlaying && <NowPlayingModal />}
      {showShortcuts && <ShortcutsHelp onClose={() => setShowShortcuts(false)} />}
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {showVibe && <VibeStudioModal onClose={() => setShowVibe(false)} />}
      {showAppearance && <AppearanceModal onClose={() => setShowAppearance(false)} />}
      {showFocus && <FocusModal onClose={() => setShowFocus(false)} />}
      {showPassword && <ChangePasswordModal onClose={() => setShowPassword(false)} />}
      <ShareModal />
      <PartyModal />
      <PartyGuestView />
      <CommandPalette />
      <MiniPlayerHost />

      <SelectionBar />
      <PlayerBar />
      <ToastContainer />
    </div>
    </>
  );
}
