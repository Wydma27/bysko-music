import React, { useState } from 'react';
import { useAuthStore } from '../store';
import { passwordStrength } from '../auth';
import {
  LogoIcon,
  ShieldCheckIcon,
  XIcon,
  EyeIcon,
  EyeOffIcon,
  ChevronLeftIcon,
  CheckIcon
} from './Icons';

function PasswordField({ value, onChange, placeholder, autoComplete, autoFocus }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field-wrap">
      <input
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required
      />
      <button
        type="button"
        className="password-toggle-btn"
        onClick={() => setVisible(v => !v)}
        tabIndex={-1}
        aria-label={visible ? 'Ukryj hasło' : 'Pokaż hasło'}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function StrengthMeter({ password }) {
  if (!password) return null;
  const { label, score } = passwordStrength(password);
  return (
    <div className="password-strength">
      <div className="password-strength-bar">
        {[0, 1, 2, 3].map(i => (
          <span key={i} className={`password-strength-seg ${i < score ? `password-strength-seg--${score}` : ''}`} />
        ))}
      </div>
      <span className="password-strength-label">{label}</span>
    </div>
  );
}

export function AuthModal({ onClose }) {
  const { login, register, loginAdmin, users } = useAuthStore();
  const noAdminYet = !users.some(u => u.role === 'admin');

  // Modes: 'login' | 'register' | 'admin'
  const [mode, setMode] = useState('login');

  // User form state
  const [userIdentifier, setUserIdentifier] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userDisplayName, setUserDisplayName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Admin form state
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const switchMode = (m) => { setMode(m); setError(''); };

  const handleUserLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const res = await login(userIdentifier, userPassword);
    setLoading(false);
    if (res.success) onClose();
    else setError(res.error || 'Błąd logowania');
  };

  const handleUserRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (userPassword !== confirmPassword) {
      setError('Podane hasła nie są identyczne.');
      return;
    }
    setLoading(true);
    const res = await register(userIdentifier, userPassword, userDisplayName);
    setLoading(false);
    if (res.success) onClose();
    else setError(res.error || 'Błąd rejestracji');
  };

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const res = await loginAdmin(adminUsername, adminPassword);
    setLoading(false);
    if (res.success) onClose();
    else setError(res.error || 'Błąd logowania do panelu administratora');
  };

  const passwordsMismatch = confirmPassword.length > 0 && confirmPassword !== userPassword;

  return (
    <div className="upload-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <div className="auth-modal-header">
          <div className="auth-modal-logo">
            <LogoIcon size={28} />
            <h2>BySko Music</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Zamknij"><XIcon /></button>
        </div>

        {/* ── Separate ADMIN LOGIN Screen ── */}
        {mode === 'admin' ? (
          <div className="admin-login-view">
            <div className="admin-login-badge">
              <ShieldCheckIcon />
              <span>Dedykowana Strefa Administratora</span>
            </div>

            <p className="admin-login-desc">
              Logowanie z uprawnieniami do uploadu muzyki, przypisywania okładek i zarządzania kontami.
            </p>

            {error && <div className="auth-error">{error}</div>}

            <form onSubmit={handleAdminLogin} className="auth-form" style={{ marginTop: 16 }}>
              <label className="edit-field">
                <span>Login administratora</span>
                <input
                  type="text"
                  autoFocus
                  placeholder="admin"
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </label>

              <label className="edit-field">
                <span>Hasło administratora</span>
                <PasswordField
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Wpisz hasło"
                  autoComplete="current-password"
                />
              </label>

              <button type="submit" className="auth-submit-btn auth-submit-btn--admin" disabled={loading}>
                {loading ? 'Logowanie...' : 'Zaloguj jako Administrator'}
              </button>
            </form>

            <div className="auth-footer-nav">
              <button
                type="button"
                className="auth-back-btn"
                onClick={() => switchMode('login')}
              >
                <ChevronLeftIcon /> Powrót do logowania użytkownika
              </button>
            </div>
          </div>
        ) : (
          /* ── STANDARD USER LOGIN / REGISTER Screen ── */
          <div className="user-login-view">
            {/* Mode Switcher Tabs */}
            <div className="auth-tabs">
              <button
                type="button"
                className={`auth-tab ${mode === 'login' ? 'auth-tab--active' : ''}`}
                onClick={() => switchMode('login')}
              >
                Logowanie
              </button>
              <button
                type="button"
                className={`auth-tab ${mode === 'register' ? 'auth-tab--active' : ''}`}
                onClick={() => switchMode('register')}
              >
                Rejestracja
              </button>
            </div>

            {error && <div className="auth-error">{error}</div>}
            {noAdminYet && (
              <div className="auth-notice">
                Na tym urządzeniu nie ma jeszcze administratora — <strong>pierwsze założone konto</strong> dostanie uprawnienia do wgrywania muzyki.
              </div>
            )}

            {mode === 'login' ? (
              <form onSubmit={handleUserLogin} className="auth-form">
                <label className="edit-field">
                  <span>Adres e-mail lub nazwa użytkownika</span>
                  <input
                    type="text"
                    autoFocus
                    placeholder="twoj.email@example.com lub login"
                    value={userIdentifier}
                    onChange={(e) => setUserIdentifier(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </label>

                <label className="edit-field">
                  <span>Hasło</span>
                  <PasswordField
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    placeholder="Wpisz hasło"
                    autoComplete="current-password"
                  />
                </label>

                <button type="submit" className="auth-submit-btn" disabled={loading}>
                  {loading ? 'Logowanie...' : 'Zaloguj się'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleUserRegister} className="auth-form">
                <label className="edit-field">
                  <span>Adres e-mail</span>
                  <input
                    type="email"
                    autoFocus
                    placeholder="twoj.email@example.com"
                    value={userIdentifier}
                    onChange={(e) => setUserIdentifier(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </label>

                <label className="edit-field">
                  <span>Nazwa wyświetlana / Pseudonim</span>
                  <input
                    type="text"
                    placeholder="np. Jan Kowalski"
                    value={userDisplayName}
                    onChange={(e) => setUserDisplayName(e.target.value)}
                    autoComplete="nickname"
                  />
                </label>

                <label className="edit-field">
                  <span>Hasło (min. 4 znaki)</span>
                  <PasswordField
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    placeholder="Utwórz hasło"
                    autoComplete="new-password"
                  />
                  <StrengthMeter password={userPassword} />
                </label>

                <label className="edit-field">
                  <span>Powtórz hasło</span>
                  <PasswordField
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Powtórz hasło"
                    autoComplete="new-password"
                  />
                  {confirmPassword && (
                    <span className={`password-match ${passwordsMismatch ? 'password-match--bad' : 'password-match--ok'}`}>
                      {passwordsMismatch ? <XIcon /> : <CheckIcon />}
                      {passwordsMismatch ? 'Hasła się różnią' : 'Hasła się zgadzają'}
                    </span>
                  )}
                </label>

                <button type="submit" className="auth-submit-btn" disabled={loading || passwordsMismatch}>
                  {loading ? 'Rejestracja...' : 'Zarejestruj konto'}
                </button>
              </form>
            )}

            {/* Dedicated discrete Admin Login trigger */}
            <div className="admin-access-section">
              <button
                type="button"
                className="admin-access-btn"
                onClick={() => switchMode('admin')}
              >
                <ShieldCheckIcon />
                <span>Logowanie Administratora</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
