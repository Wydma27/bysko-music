import React, { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../store';
import { useUiStore } from '../ui';
import { formatDuration } from '../metadata';
import { usePartyStore, startHosting, joinParty, leaveParty, suggestTrack, setGuestVolume, partyLink } from '../party';
import { showToast } from '../App';
import { RadioIcon, XIcon, CopyIcon, UsersIcon, SearchIcon, PlusIcon, MusicIcon, CheckIcon } from './Icons';

// ── Host / join dialog ────────────────────────────────────────
export function PartyModal() {
  const { showParty, partyPrefill, setShowParty } = useUiStore();
  if (!showParty) return null;
  return <PartyDialog prefill={partyPrefill} onClose={() => setShowParty(false)} />;
}

function PartyDialog({ prefill, onClose }) {
  const { role, status, code, error, guests } = usePartyStore();
  const { currentUser } = useAuthStore();
  const [tab, setTab] = useState(prefill ? 'join' : 'host');
  const [joinCode, setJoinCode] = useState(prefill || '');
  const [name, setName] = useState(currentUser?.displayName || '');
  const hosting = role === 'host';

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(partyLink(code)); showToast('Skopiowano link do pokoju', 'success'); }
    catch { showToast(partyLink(code), 'info', { duration: 8000 }); }
  };

  const join = async () => {
    await joinParty(joinCode, name);
    if (usePartyStore.getState().role === 'guest') onClose(); // otherwise keep the dialog open to show the error
  };

  return (
    <div className="upload-overlay" onClick={onClose}>
      <div className="studio-modal" onClick={e => e.stopPropagation()}>
        <div className="studio-header">
          <span className="studio-icon"><RadioIcon /></span>
          <div className="studio-heading">
            <h3>Wspólne słuchanie</h3>
            <p>Znajomi słyszą na żywo to, co grasz — z efektami — i mogą dorzucać utwory do kolejki</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Zamknij"><XIcon /></button>
        </div>

        {hosting ? (
          <div className="party-host">
            <span className="party-code-label">{status === 'live' ? 'Kod pokoju' : 'Otwieram pokój…'}</span>
            <span className="party-code">{code}</span>
            <div className="share-actions">
              <button className="btn btn--primary" onClick={copyLink} disabled={status !== 'live'}><CopyIcon /> Kopiuj link zaproszenia</button>
              <button className="btn btn--ghost danger" onClick={() => { leaveParty(); onClose(); }}>Zakończ</button>
            </div>
            <div className="studio-section-title"><UsersIcon /> Słuchają ({guests.length})</div>
            {guests.length === 0
              ? <p className="studio-note">Nikogo jeszcze nie ma. Wyślij link albo podaj kod — gość otwiera BySko Music i wybiera „Dołącz”.</p>
              : <div className="party-guests">{guests.map(g => <span key={g.id} className="party-guest">{g.name}</span>)}</div>}
            <p className="studio-note">Goście słyszą Twój dźwięk po korektorze i efektach — jeśli wyciszysz odtwarzacz, u nich też będzie cisza.</p>
          </div>
        ) : (
          <>
            <div className="segmented">
              <button className={`segmented-btn ${tab === 'host' ? 'segmented-btn--active' : ''}`} onClick={() => setTab('host')}>Utwórz pokój</button>
              <button className={`segmented-btn ${tab === 'join' ? 'segmented-btn--active' : ''}`} onClick={() => setTab('join')}>Dołącz</button>
            </div>
            {tab === 'host' ? (
              <div className="party-form">
                <p className="studio-note">Dostaniesz 6-znakowy kod i link. Połączenie idzie bezpośrednio między przeglądarkami — pliki nigdzie nie są wysyłane.</p>
                <button className="btn btn--primary btn--lg" onClick={startHosting} disabled={status === 'connecting'}>
                  <RadioIcon /> {status === 'connecting' ? 'Łączę…' : 'Zacznij nadawać'}
                </button>
              </div>
            ) : (
              <div className="party-form">
                <label className="edit-field"><span>Kod pokoju</span>
                  <input className="party-code-input" value={joinCode} maxLength={8} placeholder="np. K7PX2M" onChange={e => setJoinCode(e.target.value.toUpperCase())} />
                </label>
                <label className="edit-field"><span>Twoje imię (widzi je gospodarz)</span>
                  <input value={name} maxLength={24} placeholder="Gość" onChange={e => setName(e.target.value)} />
                </label>
                <button className="btn btn--primary btn--lg" onClick={join} disabled={joinCode.trim().length < 6}>Dołącz i słuchaj</button>
              </div>
            )}
          </>
        )}
        {error && <div className="auth-error" style={{ marginTop: 14 }}>{error}</div>}
      </div>
    </div>
  );
}

// ── Host status pill ──────────────────────────────────────────
export function PartyPill() {
  const { role, guests } = usePartyStore();
  const setShowParty = useUiStore(s => s.setShowParty);
  if (role !== 'host') return null;
  return (
    <button className="status-pill status-pill--live" onClick={() => setShowParty(true)} title="Wspólne słuchanie">
      <span className="live-dot" /> Na żywo · {guests.length}
    </button>
  );
}

// ── Guest view ────────────────────────────────────────────────
function useExtrapolatedTime(remote) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  if (!remote) return 0;
  const drift = remote.isPlaying ? ((now - remote.sentAt) / 1000) * (remote.rate || 1) : 0;
  return Math.min(remote.duration || 0, remote.currentTime + drift);
}

export function PartyGuestView() {
  const { role, status, code, remote, library, guestVolume, error } = usePartyStore();
  const [query, setQuery] = useState('');
  const [sent, setSent] = useState(() => new Set());
  const time = useExtrapolatedTime(remote);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return library.filter(t => `${t.title} ${t.artist}`.toLowerCase().includes(q)).slice(0, 8);
  }, [query, library]);

  if (role !== 'guest') return null;
  const track = remote?.track;
  const pct = remote?.duration ? (time / remote.duration) * 100 : 0;

  return (
    <div className="party-guest-overlay">
      <div className="party-guest-card">
        <div className="party-guest-top">
          <span className="status-pill status-pill--live"><span className="live-dot" /> {status === 'live' ? `Pokój ${code}` : 'Łączę…'}</span>
          <button className="btn btn--ghost btn--sm" onClick={leaveParty}>Opuść</button>
        </div>

        <div className="party-guest-cover">
          {track?.cover ? <img src={track.cover} alt="" /> : <MusicIcon />}
        </div>
        <h2 className="party-guest-title">{track?.title || (status === 'live' ? 'Gospodarz jeszcze nic nie gra' : 'Łączę z pokojem…')}</h2>
        <p className="party-guest-artist">{track?.artist || ' '}{remote?.fx && <span className="studio-chip">{remote.fx}</span>}</p>
        <div className="party-guest-progress">
          <span>{formatDuration(time)}</span>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
          <span>{formatDuration(remote?.duration || 0)}</span>
        </div>
        <label className="party-guest-volume">
          <span>Głośność</span>
          <input type="range" className="volume-slider" min="0" max="1" step="0.01" value={guestVolume} onChange={e => setGuestVolume(parseFloat(e.target.value))} />
        </label>

        {remote?.upNext?.length > 0 && (
          <>
            <div className="studio-section-title">Za chwilę</div>
            <ol className="party-upnext">{remote.upNext.map((t, i) => <li key={i}><strong>{t.title}</strong> · {t.artist}</li>)}</ol>
          </>
        )}

        <div className="studio-section-title">Dorzuć coś z biblioteki gospodarza</div>
        <div className="playlist-search-box">
          <SearchIcon />
          <input placeholder={`Szukaj wśród ${library.length} utworów…`} value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <div className="party-results">
          {results.map(t => (
            <div key={t.id} className="candidate-row">
              <div className="candidate-info">
                <div className="candidate-title">{t.title}</div>
                <div className="candidate-artist">{t.artist}</div>
              </div>
              <button
                className={`candidate-btn ${sent.has(t.id) ? 'candidate-btn--added' : ''}`}
                disabled={sent.has(t.id)}
                onClick={() => { suggestTrack(t.id); setSent(s => new Set(s).add(t.id)); }}
              >
                {sent.has(t.id) ? <><CheckIcon /> W kolejce</> : <><PlusIcon /> Dorzuć</>}
              </button>
            </div>
          ))}
        </div>
        {error && <div className="auth-error" style={{ marginTop: 12 }}>{error}</div>}
      </div>
    </div>
  );
}
