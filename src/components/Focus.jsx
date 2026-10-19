import React from 'react';
import { useFocusStore, FOCUS_PRESETS, formatClock } from '../focus';
import { useLibraryStore } from '../store';
import { useUiStore } from '../ui';
import { focusMinutes } from '../stats';
import { TargetIcon, XIcon } from './Icons';

function Ring({ progress, children }) {
  const r = 86;
  const c = 2 * Math.PI * r;
  return (
    <div className="focus-ring">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r={r} className="focus-ring-track" />
        <circle cx="100" cy="100" r={r} className="focus-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
      </svg>
      <div className="focus-ring-inner">{children}</div>
    </div>
  );
}

export function FocusModal({ onClose }) {
  const { phase, presetId, remaining, total, round, start, stop, skip } = useFocusStore();
  const focusLog = useLibraryStore(s => s.focusLog);
  const week = focusMinutes(focusLog, 7);
  const active = phase !== 'idle';

  return (
    <div className="upload-overlay" onClick={onClose}>
      <div className="studio-modal focus-modal" onClick={e => e.stopPropagation()}>
        <div className="studio-header">
          <span className="studio-icon"><TargetIcon /></span>
          <div className="studio-heading">
            <h3>Tryb Focus</h3>
            <p>Muzyka w czasie pracy, cisza w przerwach — przełącza się sama</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Zamknij"><XIcon /></button>
        </div>

        {active ? (
          <div className="focus-live">
            <Ring progress={total ? 1 - remaining / total : 0}>
              <span className={`focus-phase focus-phase--${phase}`}>{phase === 'focus' ? 'Skupienie' : 'Przerwa'}</span>
              <span className="focus-clock">{formatClock(remaining)}</span>
              <span className="focus-round">blok {round}</span>
            </Ring>
            <div className="focus-actions">
              <button className="btn btn--ghost" onClick={skip}>{phase === 'focus' ? 'Przerwa teraz' : 'Wracam wcześniej'}</button>
              <button className="btn btn--ghost danger" onClick={stop}>Zakończ</button>
            </div>
          </div>
        ) : (
          <>
            <div className="fx-presets">
              {FOCUS_PRESETS.map(p => (
                <button key={p.id} className={`fx-preset ${presetId === p.id ? 'fx-preset--active' : ''}`} onClick={() => useFocusStore.setState({ presetId: p.id })}>
                  <span className="fx-preset-name">{p.name}</span>
                  <span className="fx-preset-desc">{p.desc}</span>
                </button>
              ))}
            </div>
            <button className="btn btn--primary btn--lg focus-start" onClick={() => start(presetId)}>
              <TargetIcon /> Zaczynam
            </button>
            <p className="studio-note">
              Jeśli nic nie gra, Focus włączy spokojniejszą połowę biblioteki (po analizie brzmienia) albo losowy miks.
              Ukończone bloki trafiają do „Twój puls”.
            </p>
          </>
        )}
        {week > 0 && <p className="focus-week">W tym tygodniu: <strong>{week} min</strong> skupienia</p>}
      </div>
    </div>
  );
}

export function FocusPill() {
  const { phase, remaining } = useFocusStore();
  const setShowFocus = useUiStore(s => s.setShowFocus);
  if (phase === 'idle') return null;
  return (
    <button className={`status-pill status-pill--${phase}`} onClick={() => setShowFocus(true)} title="Tryb Focus">
      <TargetIcon />
      <span>{phase === 'focus' ? 'Focus' : 'Przerwa'} {formatClock(remaining)}</span>
    </button>
  );
}
