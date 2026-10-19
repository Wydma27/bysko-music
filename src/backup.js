/**
 * backup.js — export/import the whole local library (tracks + playlists) as a
 * single portable .byskobackup (JSON) file, so browser data loss doesn't mean
 * losing the music. Audio/cover blobs are embedded as base64.
 */

const BACKUP_VERSION = 1;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64, type) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function exportLibrary(tracks, playlists, onProgress) {
  const total = tracks.length || 1;
  const packedTracks = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const { audioBlob, coverBlob, coverUrl, ...rest } = t;
    packedTracks.push({
      ...rest,
      audioData: audioBlob ? await blobToBase64(audioBlob) : null,
      audioType: audioBlob?.type || 'audio/mpeg',
      coverData: coverBlob ? await blobToBase64(coverBlob) : null,
      coverType: coverBlob?.type || 'image/jpeg',
    });
    onProgress?.(i + 1, total);
  }

  const payload = {
    format: 'bysko-music-backup',
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    tracks: packedTracks,
    playlists,
  };

  const json = JSON.stringify(payload);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `bysko-music-backup-${date}.byskobackup`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  return { trackCount: packedTracks.length, playlistCount: playlists.length };
}

export async function parseBackupFile(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  if (payload.format !== 'bysko-music-backup' || !Array.isArray(payload.tracks)) {
    throw new Error('To nie jest plik kopii zapasowej BySko Music.');
  }
  return payload;
}

export async function unpackTrack(packedTrack) {
  const { audioData, audioType, coverData, coverType, ...rest } = packedTrack;
  const audioBlob = audioData ? base64ToBlob(audioData, audioType) : null;
  const coverBlob = coverData ? base64ToBlob(coverData, coverType) : null;
  return {
    ...rest,
    audioBlob,
    coverBlob,
    coverUrl: coverBlob ? URL.createObjectURL(coverBlob) : null,
  };
}
