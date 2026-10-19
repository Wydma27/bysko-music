import React, { useState } from 'react';
import { useAuthStore } from '../store';
import { useUiStore } from '../ui';
import { passwordStrength } from '../auth';
import { showToast } from '../App';
import { KeyIcon, XIcon, AlertTriangleIcon } from './Icons';

export function ChangePasswordModal({ onClose }) {
  const { changePassword, weakDefaultPassword } = useAuthStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(next);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next !== repeat) { setError('Nowe hasła nie są takie same.'); return; }
    setBusy(true);
    const res = await changePassword(current, next);
    setBusy(false);
    if (!res.success) { setError(res.error); return; }
    showToast('Hasło zmienione', 'success');
    onClose();
  };

  return (
    <div className="upload-overlay" onClick={onClose}>
      <div className="mini-modal" onClick={e => e.stopPropagation()}>
        <div className="upload-modal-header">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><KeyIcon /> Zmień hasło</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Zamknij"><XIcon /></button>
        </div>
        {weakDefaultPassword && <p className="confirm-modal-message">To konto używa domyślnego hasła, które zna każdy, kto widział kod aplikacji.</p>}
        {error && <div className="auth-error">{error}</div>}
        <form className="auth-form" onSubmit={submit} style={{ marginTop: 12 }}>
          <label className="edit-field"><span>Obecne hasło</span>
            <input type="password" autoFocus autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} required />
          </label>
          <label className="edit-field"><span>Nowe hasło (min. 6 znaków)</span>
            <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} required />
          </label>
          {next && (
            <div className="password-strength">
              <div className="password-strength-bar">
                {[1, 2, 3, 4].map(i => <div key={i} className={`password-strength-seg ${strength.score >= i ? `password-strength-seg--${strength.score}` : ''}`} />)}
              </div>
              <span className="password-strength-label">{strength.label}</span>
            </div>
          )}
          <label className="edit-field"><span>Powtórz nowe hasło</span>
            <input type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} required />
          </label>
          <div className="mini-modal-footer" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn--ghost" onClick={onClose}>Anuluj</button>
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Zapisuję…' : 'Zmień hasło'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Shown to anyone logged into an account that still uses a publicly known seeded password. */
export function DefaultPasswordBanner() {
  const { weakDefaultPassword, currentUser } = useAuthStore();
  const setShowPassword = useUiStore(s => s.setShowPassword);
  if (!weakDefaultPassword || !currentUser) return null;
  return (
    <div className="security-banner" role="alert">
      <AlertTriangleIcon />
      <span>
        Konto <strong>@{currentUser.username}</strong> ma domyślne hasło z kodu aplikacji — każdy, kto je zna, może się na nie zalogować.
      </span>
      <button className="btn btn--sm btn--primary" onClick={() => setShowPassword(true)}>Zmień hasło</button>
    </div>
  );
}
