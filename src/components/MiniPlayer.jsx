import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { usePlayerStore } from '../store';
import { addThemeTarget } from '../ui';
import { showToast } from '../App';
import { MusicIcon } from './Icons';

// Floating always-on-top mini player built on the Document Picture-in-Picture API
// (Chrome / Edge 116+). The React tree stays in the main window; only its DOM
// is portaled into the PiP window, so it shares the same stores and audio.
const useMiniStore = create(() => ({ pipWindow: null }));

export const pipSupported = () => typeof window !== 'undefined' && 'documentPictureInPicture' in window;

function copyStyles(target) {
  for (const sheet of document.styleSheets) {
    try {
      const style = target.createElement('style');
      style.textContent = [...sheet.cssRules].map(r => r.cssText).join('\n');
      target.head.appendChild(style);
    } catch {
      // Cross-origin sheets (e.g. Google Fonts) can't be read — link them instead.
      if (!sheet.href) continue;
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      target.head.appendChild(link);
    }
  }
}

export async function openMiniPlayer() {
  if (!pipSupported()) {
    showToast('Mini-odtwarzacz wymaga Chrome lub Edge w wersji 116+', 'error');
    return;
  }
  const existing = window.documentPictureInPicture.window;
  if (existing) { existing.focus(); return; }
  try {
    const pip = await window.documentPictureInPicture.requestWindow({ width: 380, height: 132 });
    copyStyles(pip.document);
    pip.document.title = 'BySko mini';
    pip.document.body.className = 'pip-body';
    pip.addEventListener('pagehide', () => useMiniStore.setState({ pipWindow: null }));
    useMiniStore.setState({ pipWindow: pip });
  } catch {
    showToast('Nie udało się otworzyć mini-odtwarzacza', 'error');
  }
}

const I = {
  Play: () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><polygon points="6,3 20,12 6,21" /></svg>,
  Pause: () => <svg viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>,
  Prev: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em"><polygon points="19,20 9,12 19,4" /><line x1="5" y1="19" x2="5" y2="5" /></svg>,
  Next: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="1em" height="1em"><polygon points="5,4 15,12 5,20" /><line x1="19" y1="5" x2="19" y2="19" /></svg>,
};

function MiniPlayer() {
  const { currentTrack, isPlaying, currentTime, duration, togglePlay, next, prev } = usePlayerStore();
  const pct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="mini-player">
      <div className="mini-cover">
        {currentTrack?.coverUrl ? <img src={currentTrack.coverUrl} alt="" /> : <MusicIcon />}
      </div>
      <div className="mini-body">
        <div className="mini-title">{currentTrack?.title || 'Nic nie gra'}</div>
        <div className="mini-artist">{currentTrack?.artist || 'Wybierz utwór w głównym oknie'}</div>
        <div className="mini-controls">
          <button className="icon-btn" onClick={prev} aria-label="Poprzedni"><I.Prev /></button>
          <button className="mini-play" onClick={togglePlay} aria-label="Play / Pauza">{isPlaying ? <I.Pause /> : <I.Play />}</button>
          <button className="icon-btn" onClick={next} aria-label="Następny"><I.Next /></button>
        </div>
      </div>
      <div className="mini-progress"><div style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export function MiniPlayerHost() {
  const pipWindow = useMiniStore(s => s.pipWindow);
  useEffect(() => (pipWindow ? addThemeTarget(pipWindow.document) : undefined), [pipWindow]);
  if (!pipWindow) return null;
  return createPortal(<MiniPlayer />, pipWindow.document.body);
}
