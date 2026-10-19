import { openDB } from 'idb';

const DB_NAME = 'bysko-music-db';
const DB_VERSION = 2;

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        if (!db.objectStoreNames.contains('tracks')) {
          const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
          trackStore.createIndex('artist', 'artist');
          trackStore.createIndex('album', 'album');
          trackStore.createIndex('favorite', 'favorite');
          trackStore.createIndex('dateAdded', 'dateAdded');
        }
        if (!db.objectStoreNames.contains('playlists')) {
          db.createObjectStore('playlists', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('users')) {
          // No seeded accounts: the first account registered on a device becomes its admin
          // (see useAuthStore.register), so there is no well-known default password.
          const userStore = db.createObjectStore('users', { keyPath: 'id' });
          userStore.createIndex('username', 'username', { unique: true });
          userStore.createIndex('role', 'role');
        }
      },
    });
  }
  return dbPromise;
}

// ── Tracks ────────────────────────────────────────────────────
export async function getAllTracks() {
  const db = await getDB();
  const tracks = await db.getAll('tracks');
  // The stored coverUrl is a blob: URL from a previous page load and is dead
  // after a reload — rebuild it from the persisted cover blob.
  return tracks.map(t => (t.coverBlob ? { ...t, coverUrl: URL.createObjectURL(t.coverBlob) } : t));
}

export async function getTrack(id) {
  const db = await getDB();
  return db.get('tracks', id);
}

export async function saveTrack(track) {
  const db = await getDB();
  return db.put('tracks', track);
}

export async function deleteTrack(id) {
  const db = await getDB();
  return db.delete('tracks', id);
}

export async function updateTrack(id, changes) {
  const db = await getDB();
  // One transaction, so background jobs updating the same track (analysis, enrichment) can't overwrite each other.
  const tx = db.transaction('tracks', 'readwrite');
  const track = await tx.store.get(id);
  if (!track) throw new Error('Track not found: ' + id);
  const updated = { ...track, ...changes };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

// ── Playlists ──────────────────────────────────────────────────
export async function getAllPlaylists() {
  const db = await getDB();
  return db.getAll('playlists');
}

export async function getPlaylist(id) {
  const db = await getDB();
  return db.get('playlists', id);
}

export async function savePlaylist(playlist) {
  const db = await getDB();
  return db.put('playlists', playlist);
}

export async function deletePlaylist(id) {
  const db = await getDB();
  return db.delete('playlists', id);
}

// ── Settings ───────────────────────────────────────────────────
export async function getSetting(key) {
  const db = await getDB();
  const row = await db.get('settings', key);
  return row ? row.value : undefined;
}

export async function setSetting(key, value) {
  const db = await getDB();
  return db.put('settings', { key, value });
}

// ── Users & Auth ───────────────────────────────────────────────
export async function getAllUsers() {
  const db = await getDB();
  const users = await db.getAll('users');

  // Update existing admin password to admin123 if still default 'admin'
  const adminUser = users.find(u => u.username === 'admin');
  if (adminUser && adminUser.password === 'admin') {
    adminUser.password = 'admin123';
    if (!adminUser.email) adminUser.email = 'admin@bysko.pl';
    await db.put('users', adminUser);
  }

  return users;
}

export async function getUser(id) {
  const db = await getDB();
  return db.get('users', id);
}

export async function getUserByUsername(username) {
  const db = await getDB();
  const tx = db.transaction('users', 'readonly');
  const index = tx.store.index('username');
  return index.get(username.toLowerCase().trim());
}

export async function getUserByIdentifier(identifier) {
  const clean = identifier.toLowerCase().trim();
  const db = await getDB();
  const allUsers = await db.getAll('users');
  return allUsers.find(u => 
    u.username.toLowerCase() === clean || 
    (u.email && u.email.toLowerCase() === clean)
  );
}

export async function saveUser(user) {
  const db = await getDB();
  const sanitized = {
    ...user,
    username: user.username.toLowerCase().trim(),
    email: user.email ? user.email.toLowerCase().trim() : undefined,
  };
  return db.put('users', sanitized);
}

export async function deleteUser(id) {
  const db = await getDB();
  return db.delete('users', id);
}

// ── Storage Stats ──────────────────────────────────────────────
export async function getStorageStats() {
  const db = await getDB();
  const tracks = await db.getAll('tracks');
  let audioBytes = 0;
  let coverBytes = 0;

  for (const t of tracks) {
    if (t.audioBlob) audioBytes += t.audioBlob.size || 0;
    if (t.coverBlob) coverBytes += t.coverBlob.size || 0;
  }

  const totalBytes = audioBytes + coverBytes;
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);

  return {
    trackCount: tracks.length,
    audioBytes,
    coverBytes,
    totalBytes,
    totalMB,
  };
}
