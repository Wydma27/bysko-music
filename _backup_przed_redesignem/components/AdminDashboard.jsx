import React, { useState, useEffect, useRef } from 'react';
import { useLibraryStore, useAuthStore } from '../store';
import { getStorageStats } from '../db';
import { UploadZone } from './Library';
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
  DownloadIcon
} from './Icons';

export function AdminDashboard() {
  const { tracks, exportLibrary, importLibrary } = useLibraryStore();
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
      {/* Header */}
      <div className="admin-header">
        <div>
          <div className="admin-tag">
            <ShieldCheckIcon />
            <span>PANEL ZARZĄDZANIA</span>
          </div>
          <h1 className="view-title" style={{ marginTop: 6 }}>Centrum Administratora</h1>
          <p className="view-subtitle">
            Zalogowano jako: <strong>{currentUser?.displayName || currentUser?.username}</strong> (Administrator)
          </p>
        </div>
        <button className="btn btn--primary btn--lg" onClick={() => setShowUpload(true)}>
          <UploadIcon /> Wgraj nową muzykę z okładką
        </button>
      </div>

      {/* Stats Cards Grid */}
      <div className="admin-stats-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: 'rgba(29,185,84,0.15)', color: '#1db954' }}>
            <MusicIcon />
          </div>
          <div className="admin-stat-details">
            <span className="admin-stat-value">{tracks.length}</span>
            <span className="admin-stat-name">Wgranych utworów</span>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: 'rgba(61,145,244,0.15)', color: '#3d91f4' }}>
            <UserIcon />
          </div>
          <div className="admin-stat-details">
            <span className="admin-stat-value">{uniqueArtists}</span>
            <span className="admin-stat-name">Artystów w bazie</span>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>
            <LibraryIcon />
          </div>
          <div className="admin-stat-details">
            <span className="admin-stat-value">{uniqueAlbums}</span>
            <span className="admin-stat-name">Zarejestrowanych albumów</span>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
            <DatabaseIcon />
          </div>
          <div className="admin-stat-details">
            <span className="admin-stat-value">{storage.totalMB} MB</span>
            <span className="admin-stat-name">Pamięć IndexedDB</span>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: 'rgba(236,72,153,0.15)', color: '#ec4899' }}>
            <ClockIcon />
          </div>
          <div className="admin-stat-details">
            <span className="admin-stat-value">{totalHours > 0 ? `${totalHours}h ${totalMinutes}m` : `${totalMinutes}m`}</span>
            <span className="admin-stat-name">Łączny czas muzyki</span>
          </div>
        </div>

        <div className="admin-stat-card">
          <div className="admin-stat-icon" style={{ background: 'rgba(34,211,238,0.15)', color: '#22d3ee' }}>
            <UsersIcon />
          </div>
          <div className="admin-stat-details">
            <span className="admin-stat-value">{users.length}</span>
            <span className="admin-stat-name">Konta użytkowników</span>
          </div>
        </div>
      </div>

      {/* Backup Section */}
      <div className="admin-section">
        <div className="admin-section-header">
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>Kopia zapasowa biblioteki</h2>
            <p className="admin-section-desc">Eksportuj utwory i playlisty do pliku albo przywróć je z wcześniejszego backupu — biblioteka żyje tylko w tej przeglądarce</p>
          </div>
        </div>
        <div className="admin-backup-actions">
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
      </div>

      {/* Users Management Section */}
      <div className="admin-section">
        <div className="admin-section-header">
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>Zarządzanie kontami użytkowników</h2>
            <p className="admin-section-desc">Kontroluj dostęp, role i uprawnienia do wgrywania plików</p>
          </div>
          <button className="btn btn--secondary" onClick={() => setShowNewUserModal(true)}>
            <PlusIcon /> Dodaj użytkownika
          </button>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Użytkownik</th>
                <th>Login</th>
                <th>Rola</th>
                <th>Data utworzenia</th>
                <th style={{ textAlign: 'right' }}>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isCurrent = currentUser?.id === u.id;
                const isAdmin = u.role === 'admin';
                return (
                  <tr key={u.id} className={isCurrent ? 'admin-tr-current' : ''}>
                    <td>
                      <div className="admin-user-cell">
                        <div className={`admin-user-avatar ${isAdmin ? 'admin-avatar-admin' : ''}`}>
                          {isAdmin ? <ShieldIcon /> : <UserIcon />}
                        </div>
                        <div>
                          <strong className="admin-user-name">{u.displayName || u.username}</strong>
                          {isCurrent && <span className="admin-badge-you">(Ty)</span>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <code className="admin-code">@{u.username}</code>
                    </td>
                    <td>
                      <span className={`admin-role-badge ${isAdmin ? 'badge-admin' : 'badge-user'}`}>
                        {isAdmin ? 'Administrator' : 'Słuchacz'}
                      </span>
                    </td>
                    <td className="admin-date">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString('pl-PL') : 'Początkowe'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
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
                  <option value="user">Słuchacz (tylko odsłuch i własne playlisty)</option>
                  <option value="admin">Administrator (pełny dostęp, upload utworów, statystyki)</option>
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
