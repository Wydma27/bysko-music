import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayerStore, useLibraryStore, useAuthStore, FX_PRESETS } from '../store';
import { useUiStore, ACCENTS } from '../ui';
import { buildSmartMixes, playMix, playAutoDj } from '../mixes';
import { useFocusStore } from '../focus';
import { openMiniPlayer, pipSupported } from './MiniPlayer';
import {
  SearchIcon, MusicIcon, UserIcon, DiscIcon, WandIcon, PaletteIcon, DiceIcon, MoonIcon, SunIcon,
  PipIcon, ClockIcon, HomeIcon, LibraryIcon, HeartIcon, ActivityIcon, ShieldCheckIcon, ChevronRightIcon,
  WaveIcon, TargetIcon, RadioIcon, ShareIcon, LyricsIcon,
} from './Icons';

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
const matches = (q, ...fields) => {
  const hay = norm(fields.join(' '));
  return norm(q).split(/\s+/).filter(Boolean).every(w => hay.includes(w));
};

function buildCommands() {
  const player = usePlayerStore.getState();
  const library = useLibraryStore.getState();
  const ui = useUiStore.getState();
  const isAdmin = useAuthStore.getState().isAdmin();
  const go = (view) => () => library.setView(view);

  const cmds = [
    { id: 'toggle', group: 'Odtwarzanie', label: 'Odtwórz / Pauza', icon: MusicIcon, hint: 'Spacja', run: player.togglePlay },
    { id: 'next', group: 'Odtwarzanie', label: 'Następny utwór', icon: ChevronRightIcon, hint: 'Shift →', run: player.next },
    { id: 'surprise', group: 'Odtwarzanie', label: 'Zaskocz mnie — losowy miks', keywords: 'random shuffle', icon: DiceIcon,
      run: () => { const l = useLibraryStore.getState(); playMix(buildSmartMixes(l.tracks, l.playLog)[0]?.tracks); } },
    { id: 'autodj', group: 'Odtwarzanie', label: 'Auto-DJ — set z rampą energii', keywords: 'dj bpm tempo mix', icon: WaveIcon,
      run: () => playAutoDj(useLibraryStore.getState().tracks) },
    ...(player.currentTrack ? [
      { id: 'lyrics', group: 'Odtwarzanie', label: 'Pokaż tekst piosenki', keywords: 'karaoke lrc slowa', icon: LyricsIcon, hint: 'T',
        run: () => { player.setShowNowPlaying(true); ui.setShowLyrics(true); } },
      { id: 'share-track', group: 'Udostępnij', label: 'Karta „Teraz słucham”', keywords: 'story instagram obrazek', icon: ShareIcon,
        run: () => ui.setShare({ kind: 'track', trackId: player.currentTrack.id }) },
    ] : []),
    { id: 'share-month', group: 'Udostępnij', label: 'Karta „Mój miesiąc”', keywords: 'story instagram wrapped statystyki', icon: ShareIcon, run: () => ui.setShare({ kind: 'month' }) },
    { id: 'focus', group: 'Narzędzia', label: useFocusStore.getState().phase === 'idle' ? 'Tryb Focus (Pomodoro)' : 'Tryb Focus — trwa sesja', keywords: 'pomodoro praca nauka skupienie', icon: TargetIcon, run: () => ui.setShowFocus(true) },
    { id: 'party', group: 'Narzędzia', label: 'Wspólne słuchanie', keywords: 'party znajomi razem pokoj', icon: RadioIcon, run: () => ui.setShowParty(true) },
    { id: 'vibe', group: 'Narzędzia', label: 'Otwórz Vibe Studio', keywords: 'efekty fx dzwiek', icon: WandIcon, hint: 'V', run: () => ui.setShowVibe(true) },
    { id: 'look', group: 'Narzędzia', label: 'Wygląd i palety', keywords: 'motyw kolor theme', icon: PaletteIcon, run: () => ui.setShowAppearance(true) },
    { id: 'mode', group: 'Narzędzia', label: ui.mode === 'dark' ? 'Włącz tryb jasny' : 'Włącz tryb ciemny', keywords: 'motyw theme', icon: ui.mode === 'dark' ? SunIcon : MoonIcon, run: ui.toggleMode },
    ...(pipSupported() ? [{ id: 'pip', group: 'Narzędzia', label: 'Mini-odtwarzacz w osobnym oknie', keywords: 'pip picture', icon: PipIcon, run: openMiniPlayer }] : []),
    ...[15, 30, 60].map(m => ({ id: `sleep${m}`, group: 'Narzędzia', label: `Sleep timer: ${m} min`, keywords: 'wylacz spanie', icon: ClockIcon, run: () => player.setSleepTimer(m) })),
    { id: 'go-home', group: 'Przejdź do', label: 'Strona główna', icon: HomeIcon, hint: '1', run: go('all') },
    { id: 'go-albums', group: 'Przejdź do', label: 'Albumy', icon: LibraryIcon, hint: '2', run: go('albums') },
    { id: 'go-artists', group: 'Przejdź do', label: 'Artyści', icon: UserIcon, hint: '3', run: go('artists') },
    { id: 'go-favs', group: 'Przejdź do', label: 'Ulubione', icon: HeartIcon, hint: '4', run: go('favorites') },
    { id: 'go-stats', group: 'Przejdź do', label: 'Twój puls — statystyki', keywords: 'wrapped top', icon: ActivityIcon, hint: '6', run: go('stats') },
    ...(isAdmin ? [{ id: 'go-admin', group: 'Przejdź do', label: 'Panel Admina', icon: ShieldCheckIcon, hint: '0', run: go('admin') }] : []),
    ...library.playlists.map(pl => ({ id: `pl-${pl.id}`, group: 'Przejdź do', label: `Playlista: ${pl.name}`, icon: MusicIcon, run: go(pl.id) })),
    ...FX_PRESETS.map(p => ({ id: `fx-${p.id}`, group: 'Vibe FX', label: `Efekt: ${p.name}`, keywords: p.desc, icon: WandIcon, run: () => usePlayerStore.getState().applyFxPreset(p.id) })),
    ...ACCENTS.map(a => ({ id: `accent-${a.id}`, group: 'Palety', label: `Paleta: ${a.name}`, keywords: `motyw kolor ${a.desc}`, icon: PaletteIcon, run: () => ui.setAccent(a.id) })),
  ];
  return cmds;
}

function PaletteDialog({ onClose }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const tracks = useLibraryStore(s => s.tracks);
  const commands = useMemo(() => buildCommands(), []);

  const items = useMemo(() => {
    const query = q.trim();
    if (!query) return commands.filter(c => c.group !== 'Vibe FX' && c.group !== 'Palety');

    const out = commands.filter(c => matches(query, c.label, c.keywords, c.group)).slice(0, 8);
    const { loadAndPlay } = usePlayerStore.getState();
    const { openArtist, openAlbum } = useLibraryStore.getState();

    const hitTracks = tracks.filter(t => matches(query, t.title, t.artist, t.album)).slice(0, 8);
    out.push(...hitTracks.map(t => ({
      id: `t-${t.id}`, group: 'Utwory', label: t.title, sub: t.artist, cover: t.coverUrl, icon: MusicIcon,
      run: () => loadAndPlay(t, hitTracks, hitTracks.indexOf(t)),
    })));

    const artists = [...new Set(tracks.map(t => t.artist))].filter(a => matches(query, a)).slice(0, 4);
    out.push(...artists.map(a => ({ id: `a-${a}`, group: 'Artyści', label: a, icon: UserIcon, run: () => openArtist(a) })));

    const albums = [...new Set(tracks.map(t => t.album))].filter(a => matches(query, a)).slice(0, 4);
    out.push(...albums.map(a => ({ id: `al-${a}`, group: 'Albumy', label: a, icon: DiscIcon, run: () => openAlbum(a) })));
    return out;
  }, [q, tracks, commands]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (item) => { onClose(); item?.run?.(); };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()} role="dialog" aria-label="Paleta komend">
        <div className="palette-input-wrap">
          <SearchIcon />
          <input
            autoFocus
            className="palette-input"
            placeholder="Szukaj utworu, artysty albo wpisz komendę…"
            value={q}
            onChange={e => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
          />
          <kbd className="kbd-inline">Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="palette-empty">Brak wyników dla „{q}”</div>}
          {items.map((item, i) => {
            const header = item.group !== items[i - 1]?.group ? <div className="palette-group">{item.group}</div> : null;
            const Icon = item.icon;
            return (
              <React.Fragment key={item.id}>
                {header}
                <button
                  className={`palette-item ${i === active ? 'palette-item--active' : ''}`}
                  data-active={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(item)}
                >
                  <span className="palette-item-icon">{item.cover ? <img src={item.cover} alt="" /> : <Icon />}</span>
                  <span className="palette-item-text">
                    <span className="palette-item-label">{item.label}</span>
                    {item.sub && <span className="palette-item-sub">{item.sub}</span>}
                  </span>
                  {item.hint && <kbd className="kbd-inline">{item.hint}</kbd>}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="palette-footer">
          <span><kbd className="kbd-inline">↑↓</kbd> wybierz</span>
          <span><kbd className="kbd-inline">Enter</kbd> uruchom</span>
          <span>spróbuj: „8d”, „slowed”, „jasny”, nazwa artysty</span>
        </div>
      </div>
    </div>
  );
}

export function CommandPalette() {
  const { showPalette, setShowPalette } = useUiStore();
  if (!showPalette) return null;
  return <PaletteDialog onClose={() => setShowPalette(false)} />;
}
