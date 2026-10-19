import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLibraryStore, useAuthStore } from '../store';
import { getStorageStats } from '../db';
import { parseLyrics } from '../lyrics';
import { needsEnrich } from '../enrich';
import { formatPlural } from '../metadata';
import { UploadZone } from './Library';
import { Switch } from './Studio';
import { ConfirmModal } from './ConfirmModal';
import { showToast } from '../App';
import {
  ShieldIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersIcon,
  MusicIcon,
  LibraryIcon,
  DatabaseIcon,
  ClockIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
  UploadIcon,
  DownloadIcon,
  SparklesIcon
} from './Icons';

function CardHead({ icon, title, desc, children }) {
  return (
    <header className="admin-card-head">
      <div className="admin-card-icon">{icon}</div>
      <div className="admin-card-heading">
        <h2 className="admin-card-title">{title}</h2>
        {desc && <p className="admin-card-desc">{desc}</p>}
      </div>
      {children}
    </header>
  );
}

function Meter({ label, value, total }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="admin-meter">
      <div className="admin-meter-top">
        <span>{label}</span>
        <strong>{value}/{total}</strong>
      </div>
      <div className="admin-meter-bar"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** Online covers & lyrics: the auto-lookup switch, how much of the library is covered, and a "fill in the rest" button. */
function EnrichSection() {
  const { tracks, autoEnrich, setAutoEnrich, enrichProgress, enrichPaused, queueMissingForEnrich } = useLibraryStore();
  const stats = useMemo(() => {
    let covers = 0, lyrics = 0, synced = 0, uncertain = 0, missing = 0;
    for (const t of tracks) {
      const parsed = parseLyrics(t.lyrics);
      if (t.coverUrl) covers++;
      if (parsed) lyrics++;
      if (parsed?.synced) synced++;
      if (t.enrich?.match === 'uncertain') uncertain++;
      if (needsEnrich(t)) missing++;
    }
    return { covers, lyrics, synced, uncertain, missing };
  }, [tracks]);

  const fillIn = async () => {
    const n = await queueMissingForEnrich();
    showToast(n ? `Szukam okładek i tekstów dla ${formatPlural(n, 'utworu', 'utworów', 'utworów')}…` : 'Wszystkie utwory są już w kolejce', 'info');
  };

  return (
    <section className="admin-card">
      <CardHead
        icon={<SparklesIcon />}
        title="Okładki i teksty z internetu"
        desc="Brakującą okładkę, album i rok bierzemy z katalogu iTunes, a tekst z LRCLIB (zsynchronizowany do karaoke, gdy jest). Wysyłane są tylko tytuł, wykonawca i długość utworu. Dane z tagów pliku nigdy nie są nadpisywane."
      />
      <Switch
        checked={autoEnrich}
        onChange={setAutoEnrich}
        label="Uzupełniaj automatycznie przy wgrywaniu"
        hint="Nowe utwory od razu dostają okładkę i tekst, jeśli plik ich nie ma"
      />
      <div className="admin-meters">
        <Meter label="Okładki" value={stats.covers} total={tracks.length} />
        <Meter label="Teksty" value={stats.lyrics} total={tracks.length} />
        <Meter label="Karaoke" value={stats.synced} total={tracks.length} />
      </div>
      {stats.uncertain > 0 && (
        <p className="admin-card-note">Niepewne dopasowania: <strong>{stats.uncertain}</strong></p>
      )}
      <div className="admin-card-actions">
        <button className="btn btn--secondary" onClick={fillIn} disabled={!!enrichProgress || enrichPaused || !stats.missing}>
          <SparklesIcon />
          {enrichPaused ? 'Czeka na internet…'
            : enrichProgress ? `Szukam… ${enrichProgress.done}/${enrichProgress.total}`
            : stats.missing ? `Uzupełnij brakujące (${stats.missing})` : 'Wszystko uzupełnione'}
        </button>
      </div>
    </section>
  );
}

export function AdminDashboard() {
  const { tracks, playlists, exportLibrary, importLibrary } = useLibraryStore();
  const { currentUser, users, updateUserRole, deleteUserAccount, createUserByAdmin } = useAuthStore();
  const [showUpload, setShowUpload] = useState(false);
  const [storage, setStorage] = useState({ totalMB: '0.00', trackCount: 0 });
  const [showNewUserModal, setShowNewUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [userError, setUserError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const importInputRef = useRef();

  useEffect(() => {
    getStorageStats().then(setStorage).catch(() => {});
  }, [tracks]);

  const totalDuration = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  const totalHours = Math.floor(totalDuration / 3600);
  const totalMinutes = Math.floor((totalDuration % 3600) / 60);
  const uniqueArtists = new Set(tracks.map(t => t.artist)).size;
  const uniqueAlbums = new Set(tracks.map(t => t.album)).size;
  const statTiles = [
    { icon: <MusicIcon />, value: tracks.length, label: 'Utwory' },
    { icon: <UserIcon />, value: uniqueArtists, label: 'Artyści' },
    { icon: <LibraryIcon />, value: uniqueAlbums, label: 'Albumy' },
    { icon: <ClockIcon />, value: totalHours > 0 ? `${totalHours}h ${totalMinutes}m` : `${totalMinutes}m`, label: 'Łączny czas' },
    { icon: <DatabaseIcon />, value: <>{storage.totalMB}<small>MB</small></>, label: 'Pamięć IndexedDB' },
    { icon: <UsersIcon />, value: users.length, label: 'Konta' },
  ];
  // Your own account first, everyone else in their stored order.
  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => (b.id === currentUser?.id) - (a.id === currentUser?.id)),
    [users, currentUser]
  );

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setUserError('');
    if (!newUsername.trim() || !newPassword.trim()) {
      setUserError('Login i hasło są wymagane');
      return;
    }
    const res = await createUserByAdmin(newUsername, newPassword, newDisplayName, newRole);
    if (res.success) {
      setShowNewUserModal(false);
      setNewUsername('');
      setNewPassword('');
      setNewDisplayName('');
      setNewRole('user');
    } else {
      setUserError(res.error || 'Błąd tworzenia konta');
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setExportProgress(0);
    try {
      const res = await exportLibrary((done, total) => setExportProgress(Math.round((done / total) * 100)));
      showToast(`Wyeksportowano ${res.trackCount} utworów i ${res.playlistCount} playlist`, 'success');
    } catch (err) {
      showToast('Błąd eksportu: ' + err.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportProgress(0);
    try {
      const res = await importLibrary(file, (done, total) => setImportProgress(Math.round((done / total) * 100)));
      showToast(`Zaimportowano ${res.imported} utworów (pominięto ${res.skipped} duplikatów) i ${res.playlistsImported} playlist`, 'success');
    } catch (err) {
      showToast('Błąd importu: ' + err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="view-content admin-dashboard">
      <div className="home-hero admin-hero">
        <div>
          <div className="home-hero-kicker admin-kicker">
            <ShieldCheckIcon /> Panel zarządzania
          </div>
          <h1 className="home-hero-title">Centrum administratora</h1>
          <p className="home-hero-sub">
            Zalogowano jako <strong>{currentUser?.displayName || currentUser?.username}</strong> · Administrator
          </p>
        </div>
        <div className="home-hero-actions">
          <button className="btn btn--primary" onClick={() => setShowUpload(true)}>
            <UploadIcon /> Wgraj muzykę
          </button>
        </div>
      </div>

      <div className="admin-stats">
        {statTiles.map(s => (
          <div key={s.label} className="admin-stat">
            <span className="admin-stat-icon">{s.icon}</span>
            <span className="admin-stat-value">{s.value}</span>
            <span className="admin-stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="admin-grid">
        <EnrichSection />

        <section className="admin-card">
          <CardHead
            icon={<DatabaseIcon />}
            title="Kopia zapasowa biblioteki"
            desc="Eksportuj utwory i playlisty do pliku albo przywróć je z wcześniejszego backupu — biblioteka żyje tylko w tej przeglądarce."
          />
          <dl className="admin-facts">
            <div><dt>Utwory do eksportu</dt><dd>{tracks.length}</dd></div>
            <div><dt>Playlisty do eksportu</dt><dd>{playlists.length}</dd></div>
            <div><dt>Dane w przeglądarce</dt><dd>{storage.totalMB} MB</dd></div>
          </dl>
          <div className="admin-card-actions">
            <button className="btn btn--secondary" onClick={handleExport} disabled={exporting || tracks.length === 0}>
              <DownloadIcon /> {exporting ? `Eksportowanie... ${exportProgress}%` : 'Eksportuj bibliotekę'}
            </button>
            <button className="btn btn--secondary" onClick={() => importInputRef.current?.click()} disabled={importing}>
              <UploadIcon /> {importing ? `Importowanie... ${importProgress}%` : 'Importuj z pliku'}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".byskobackup,application/json"
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
          </div>
        </section>

        <section className="admin-card admin-card--wide">
          <CardHead
            icon={<UsersIcon />}
            title="Konta użytkowników"
            desc="Kontroluj dostęp, role i uprawnienia do wgrywania plików."
          >
            <button className="btn btn--secondary admin-card-head-action" onClick={() => setShowNewUserModal(true)}>
              <PlusIcon /> Dodaj użytkownika
            </button>
          </CardHead>

          <div className="admin-users">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Użytkownik</th>
                  <th>Rola</th>
                  <th>Utworzono</th>
                  <th className="admin-th-actions">Akcje</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map((u) => {
                  const isCurrent = currentUser?.id === u.id;
                  const isAdmin = u.role === 'admin';
                  return (
                    <tr key={u.id} className={isCurrent ? 'admin-tr-current' : ''}>
                      <td className="admin-td-user">
                        <div className="admin-user-cell">
                          <div className={`admin-user-avatar ${isAdmin ? 'admin-avatar-admin' : ''}`}>
                            {isAdmin ? <ShieldIcon /> : <UserIcon />}
                          </div>
                          <div className="admin-user-text">
                            <span className="admin-user-name">
                              <span>{u.displayName || u.username}</span>
                              {isCurrent && <span className="admin-badge-you">Ty</span>}
                            </span>
                            <span className="admin-user-login">@{u.username}</span>
                          </div>
                        </div>
                      </td>
                      <td className="admin-td-role">
                        <span className={`admin-role-badge ${isAdmin ? 'badge-admin' : 'badge-user'}`}>
                          {isAdmin ? 'Administrator' : 'Słuchacz'}
                        </span>
                      </td>
                      <td className="admin-td-date">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString('pl-PL') : 'Początkowe'}
                      </td>
                      <td className="admin-td-actions">
                        <div className="admin-actions-cell">
                          {!isCurrent && (
                            <>
                              <button
                                className="btn btn--ghost btn--sm"
                                onClick={() => updateUserRole(u.id, isAdmin ? 'user' : 'admin')}
                                title={isAdmin ? 'Zmień na Słuchacza' : 'Mianuj Administratorem'}
                              >
                                {isAdmin ? 'Odbierz uprawnienia' : 'Nadaj uprawnienia'}
                              </button>
                              <button
                                className="icon-btn danger"
                                onClick={() => setDeleteTarget(u)}
                                title="Usuń konto"
                              >
                                <TrashIcon />
                              </button>
                            </>
                          )}
                          {isCurrent && <span className="admin-current-label">Aktywna sesja</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* New User Modal */}
      {showNewUserModal && (
        <div className="upload-overlay" onClick={() => setShowNewUserModal(false)}>
          <div className="mini-modal" onClick={(e) => e.stopPropagation()}>
            <div className="upload-modal-header">
              <h3>Dodaj nowe konto</h3>
              <button className="icon-btn" onClick={() => setShowNewUserModal(false)}><XIcon /></button>
            </div>
            {userError && <div className="auth-error">{userError}</div>}
            <form onSubmit={handleCreateUser} className="auth-form" style={{ marginTop: 12 }}>
              <label className="edit-field">
                <span>Login (nazwa użytkownika)</span>
                <input
                  type="text"
                  autoFocus
                  placeholder="np. marta"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  required
                />
              </label>
              <label className="edit-field">
                <span>Nazwa wyświetlana</span>
                <input
                  type="text"
                  placeholder="np. Marta Nowak"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                />
              </label>
              <label className="edit-field">
                <span>Hasło</span>
                <input
                  type="password"
                  placeholder="Wpisz hasło"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </label>
              <label className="edit-field">
                <span>Rola w systemie</span>
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="sort-select" style={{ width: '100%', height: 42 }}>
                  <option value="user">Słuchacz — odsłuch i playlisty</option>
                  <option value="admin">Administrator — pełny dostęp</option>
                </select>
              </label>
              <div className="mini-modal-footer" style={{ marginTop: 16 }}>
                <button type="button" className="btn btn--ghost" onClick={() => setShowNewUserModal(false)}>Anuluj</button>
                <button type="submit" className="btn btn--primary">Utwórz konto</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Zone */}
      {showUpload && <UploadZone onClose={() => setShowUpload(false)} />}

      {deleteTarget && (
        <ConfirmModal
          title="Usunąć konto?"
          message={`Czy na pewno chcesz usunąć konto @${deleteTarget.username}? Tej operacji nie można cofnąć.`}
          confirmLabel="Usuń konto"
          danger
          onConfirm={() => { deleteUserAccount(deleteTarget.id); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
