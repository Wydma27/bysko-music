import React, { useMemo } from 'react';
import { useLibraryStore, useAuthStore } from '../store';
import { useUiStore } from '../ui';
import { buildSmartMixes, playMix, playSmartMix, timeOfDayName } from '../mixes';
import { computeStats, persona, focusMinutes } from '../stats';
import { formatPlural } from '../metadata';
import {
  MusicIcon, DiceIcon, ClockIcon, FlameIcon, GemIcon, SparklesIcon, HeartIcon, ZapIcon, InfinityIcon,
  ActivityIcon, CommandIcon, WaveIcon, ShareIcon,
} from './Icons';

const MIX_ICONS = {
  dice: DiceIcon, clock: ClockIcon, flame: FlameIcon, gem: GemIcon, sparkles: SparklesIcon,
  heart: () => <HeartIcon />, zap: ZapIcon, infinity: InfinityIcon, wave: WaveIcon,
};

const PlayGlyph = () => (<svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><polygon points="6,3 20,12 6,21" /></svg>);

function greeting(hour) {
  if (hour >= 5 && hour < 11) return 'Dzień dobry';
  if (hour >= 11 && hour < 18) return 'Cześć';
  if (hour >= 18 && hour < 22) return 'Dobry wieczór';
  return 'Dobrej nocy';
}

// ── Home hero ─────────────────────────────────────────────────
export function HomeHero() {
  const { currentUser } = useAuthStore();
  const { tracks, playLog } = useLibraryStore();
  const setShowPalette = useUiStore(s => s.setShowPalette);
  const hour = new Date().getHours();
  const name = currentUser?.displayName || currentUser?.username;

  const surprise = () => playMix(buildSmartMixes(tracks, playLog)[0]?.tracks);

  return (
    <section className="home-hero">
      <div>
        <p className="home-hero-kicker">{timeOfDayName(hour)}</p>
        <h1 className="home-hero-title">{greeting(hour)}{name ? `, ${name}` : ''}</h1>
        <p className="home-hero-sub">
          {tracks.length
            ? `${formatPlural(tracks.length, 'utwór', 'utwory', 'utworów')} w bibliotece · ${formatPlural(playLog.length, 'odtworzenie', 'odtworzenia', 'odtworzeń')} w historii`
            : 'Wgraj pierwsze pliki, a reszta ułoży się sama.'}
        </p>
      </div>
      <div className="home-hero-actions">
        {tracks.length > 0 && (
          <button className="btn btn--primary" onClick={surprise}><DiceIcon /> Zaskocz mnie</button>
        )}
        <button className="btn btn--ghost" onClick={() => setShowPalette(true)}>
          <CommandIcon /> Szybkie komendy <kbd className="kbd-inline">Ctrl K</kbd>
        </button>
      </div>
    </section>
  );
}

// ── Smart mixes row ───────────────────────────────────────────
export function SmartMixes() {
  const { tracks, playLog, analysisProgress } = useLibraryStore();
  // Rebuilt when the library or the log changes; the "surprise" pick re-rolls then too.
  const mixes = useMemo(() => buildSmartMixes(tracks, playLog), [tracks, playLog]);
  if (!mixes.length) return null;

  return (
    <section className="mixes-section">
      <div className="section-head">
        <h2 className="section-title">Mixy dla Ciebie</h2>
        <span className="section-hint">Układają się same z Twojej biblioteki i historii słuchania</span>
        {analysisProgress && (
          <span className="analysis-chip" title="Liczę falę, tempo i energię każdego utworu — raz, potem zostaje w bazie">
            <span className="spinner-sm" /> Analizuję brzmienie {analysisProgress.done}/{analysisProgress.total}
          </span>
        )}
      </div>
      <div className="mixes-row">
        {mixes.map((mix, i) => {
          const Icon = MIX_ICONS[mix.icon] || MusicIcon;
          const covers = [...new Set(mix.tracks.map(t => t.coverUrl).filter(Boolean))].slice(0, 4);
          return (
            <button key={mix.id} className="mix-card" style={{ '--mix-tilt': `${(i * 37) % 360}deg` }} onClick={() => playSmartMix(mix)}>
              <div className="mix-art">
                {covers.length >= 4
                  ? covers.map(c => <img key={c} src={c} alt="" />)
                  : <span className="mix-art-icon"><Icon /></span>}
                <span className="mix-play"><PlayGlyph /></span>
              </div>
              <span className="mix-name"><Icon /> {mix.name}</span>
              <span className="mix-desc">{mix.desc}</span>
              <span className="mix-count">{formatPlural(mix.tracks.length, 'utwór', 'utwory', 'utworów')}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── Stats ("Twój puls") ───────────────────────────────────────
const DAY_NAMES = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
function RankList({ title, rows }) {
  const max = Math.max(...rows.map(r => r.count), 1);
  return (
    <div className="stats-card">
      <h3 className="stats-card-title">{title}</h3>
      <ol className="rank-list">
        {rows.map((r, i) => (
          <li key={r.key} className="rank-row">
            <span className="rank-pos">{i + 1}</span>
            <span className={`rank-cover ${r.round ? 'rank-cover--round' : ''}`}>{r.cover ? <img src={r.cover} alt="" /> : <MusicIcon />}</span>
            <span className="rank-main">
              <span className="rank-label">{r.label}</span>
              {r.sub && <span className="rank-sub">{r.sub}</span>}
              <span className="rank-bar"><span style={{ width: `${(r.count / max) * 100}%` }} /></span>
            </span>
            <span className="rank-count">{r.count}×</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ColumnChart({ title, values, labels, tip, tickEvery = 1, highlight }) {
  const max = Math.max(...values, 1);
  return (
    <div className="stats-card">
      <h3 className="stats-card-title">{title}</h3>
      <div className="col-chart" role="img" aria-label={`${title}: ${values.map((v, i) => `${labels[i]} ${v}`).join(', ')}`}>
        {values.map((v, i) => (
          <div key={i} className={`col-slot ${highlight === i ? 'col-slot--now' : ''}`} data-tip={tip(i, v)}>
            <div className="col-bar" style={{ height: v ? `${Math.max(4, (v / max) * 100)}%` : '2px' }} />
          </div>
        ))}
      </div>
      <div className="col-axis">
        {labels.map((l, i) => <span key={i}>{i % tickEvery === 0 ? l : ''}</span>)}
      </div>
      {highlight !== undefined && <span className="stats-card-note">Pełny kolor = bieżąca godzina · najedź na słupek, żeby zobaczyć liczbę</span>}
    </div>
  );
}

export function StatsView() {
  const { tracks, playLog, focusLog, openArtist } = useLibraryStore();
  const setShare = useUiStore(s => s.setShare);
  const stats = useMemo(() => computeStats(tracks, playLog), [tracks, playLog]);
  const focusWeek = focusMinutes(focusLog, 7);

  if (!stats.plays) {
    return (
      <div className="view-content">
        <div className="view-header"><h1 className="view-title">Twój puls</h1></div>
        <div className="empty-state">
          <span className="empty-state-icon"><ActivityIcon /></span>
          <h2>Jeszcze nic nie zliczyliśmy</h2>
          <p>Posłuchaj dowolnego utworu przez 30 sekund — tu pojawią się Twoje statystyki, topki i rytm dnia.</p>
        </div>
      </div>
    );
  }

  const p = persona(stats);
  const nowHour = new Date().getHours();

  return (
    <div className="view-content">
      <div className="view-header">
        <div>
          <h1 className="view-title">Twój puls</h1>
          <p className="view-subtitle">Liczone lokalnie, na tym urządzeniu — nic nie wychodzi poza przeglądarkę</p>
        </div>
        <button className="btn btn--primary" onClick={() => setShare({ kind: 'month' })}>
          <ShareIcon /> Udostępnij mój miesiąc
        </button>
      </div>

      <div className="persona-card">
        <span className="persona-kicker">Twój typ słuchacza</span>
        <span className="persona-title">{p.time}</span>
        <span className="persona-sub">Najczęściej grasz około {stats.peakHour}:00 — {p.style}.</span>
      </div>

      <div className="stat-tiles">
        <div className="stat-tile"><span className="stat-tile-value">{stats.plays}</span><span className="stat-tile-label">odtworzeń</span></div>
        <div className="stat-tile"><span className="stat-tile-value">~{stats.minutes}</span><span className="stat-tile-label">minut muzyki</span></div>
        <div className="stat-tile"><span className="stat-tile-value">{stats.unique}</span><span className="stat-tile-label">różnych utworów</span></div>
        <div className="stat-tile"><span className="stat-tile-value">{stats.streak}</span><span className="stat-tile-label">{stats.streak === 1 ? 'dzień z rzędu' : 'dni z rzędu'}</span></div>
        {focusWeek > 0 && (
          <div className="stat-tile"><span className="stat-tile-value">{focusWeek}</span><span className="stat-tile-label">minut Focus w 7 dni</span></div>
        )}
      </div>

      <div className="stats-grid">
        <RankList
          title="Top utwory"
          rows={stats.topTracks.map(({ track, count }) => ({ key: track.id, label: track.title, sub: track.artist, cover: track.coverUrl, count }))}
        />
        <RankList
          title="Top artyści"
          rows={stats.topArtists.map(a => ({ key: a.name, label: <span className="player-link" onClick={() => openArtist(a.name)}>{a.name}</span>, cover: a.cover, count: a.count, round: true }))}
        />
        <ColumnChart
          title="Rytm dnia"
          values={stats.hours}
          labels={stats.hours.map((_, h) => `${h}`)}
          tickEvery={6}
          highlight={nowHour}
          tip={(h, v) => `${h}:00–${h + 1}:00 · ${formatPlural(v, 'odtworzenie', 'odtworzenia', 'odtworzeń')}`}
        />
        <ColumnChart
          title="Dni tygodnia"
          values={WEEK_ORDER.map(d => stats.weekdays[d])}
          labels={WEEK_ORDER.map(d => DAY_NAMES[d])}
          tip={(i, v) => `${DAY_NAMES[WEEK_ORDER[i]]} · ${formatPlural(v, 'odtworzenie', 'odtworzenia', 'odtworzeń')}`}
        />
      </div>
    </div>
  );
}
