import React, { useEffect, useState } from 'react';
import { useLibraryStore, useAuthStore } from '../store';
import { useUiStore } from '../ui';
import { computeStats } from '../stats';
import { renderTrackCard, renderMonthCard } from '../shareCard';
import { showToast } from '../App';
import { ShareIcon, DownloadIcon, CopyIcon, XIcon } from './Icons';

/** Preview + download / share / copy of a generated story image. */
export function ShareModal() {
  const share = useUiStore(s => s.share);
  // Mounting a fresh dialog per open means a previous (already revoked) preview never flashes.
  return share ? <ShareDialog share={share} /> : null;
}

function ShareDialog({ share }) {
  const setShare = useUiStore(s => s.setShare);
  const { tracks, playLog } = useLibraryStore();
  const { currentUser } = useAuthStore();
  const [image, setImage] = useState(null); // { blob, url }

  useEffect(() => {
    let cancelled = false;
    let url = null;
    (async () => {
      let blob;
      if (share.kind === 'track') {
        const track = tracks.find(t => t.id === share.trackId);
        if (!track) return;
        blob = await renderTrackCard(track);
      } else {
        const stats = computeStats(tracks, playLog, { sinceDays: 30 });
        blob = await renderMonthCard(stats, currentUser?.displayName || currentUser?.username);
      }
      if (cancelled || !blob) return;
      url = URL.createObjectURL(blob);
      setImage({ blob, url });
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
    // Rendered once per open; later library changes shouldn't re-draw the card under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share]);

  const close = () => setShare(null);
  const fileName = share.kind === 'track' ? 'bysko-teraz-slucham.png' : 'bysko-moj-miesiac.png';
  const file = image ? new File([image.blob], fileName, { type: 'image/png' }) : null;
  const canShareFile = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

  const download = () => {
    const a = document.createElement('a');
    a.href = image.url;
    a.download = fileName;
    a.click();
  };
  const shareFile = async () => {
    try { await navigator.share({ files: [file], title: 'BySko Music' }); } catch {}
  };
  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': image.blob })]);
      showToast('Skopiowano obrazek — wklej go gdziekolwiek', 'success');
    } catch {
      showToast('Ta przeglądarka nie pozwala kopiować obrazków — użyj „Pobierz”', 'error');
    }
  };

  return (
    <div className="upload-overlay" onClick={close}>
      <div className="studio-modal share-modal" onClick={e => e.stopPropagation()}>
        <div className="studio-header">
          <span className="studio-icon"><ShareIcon /></span>
          <div className="studio-heading">
            <h3>{share.kind === 'track' ? 'Teraz słucham' : 'Mój miesiąc'}</h3>
            <p>Obrazek w formacie Story (1080×1920) — gotowy na Instagram, TikTok czy komunikator</p>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Zamknij"><XIcon /></button>
        </div>
        <div className="share-preview">
          {image ? <img src={image.url} alt="Podgląd karty do udostępnienia" /> : <span className="spinner-sm" />}
        </div>
        <div className="share-actions">
          {canShareFile && <button className="btn btn--primary" onClick={shareFile}><ShareIcon /> Udostępnij</button>}
          <button className={`btn ${canShareFile ? 'btn--ghost' : 'btn--primary'}`} onClick={download} disabled={!image}><DownloadIcon /> Pobierz PNG</button>
          <button className="btn btn--ghost" onClick={copy} disabled={!image}><CopyIcon /> Kopiuj</button>
        </div>
      </div>
    </div>
  );
}
