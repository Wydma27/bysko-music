import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayerStore, useLibraryStore, useAuthStore, getOutputLatency } from '../store';
import { parseLyrics, activeLineIndex } from '../lyrics';
import { showToast } from '../App';
import { LyricsIcon, UploadIcon } from './Icons';

const LEAD = 0.15;      // light a line up a touch early so its 250ms highlight lands with the voice
const NUDGE = 0.25;     // one press of « / »
const REACTION = 0.2;   // in "Dopasuj" mode people click a little after they hear the line
const MAX_OFFSET = 60;

/** Where the listener actually is in the song: the element's clock minus what is still buffered on the way out. */
const heardTime = () => usePlayerStore.getState().audio.currentTime - getOutputLatency();

const formatOffset = (s) => `${s > 0 ? '+' : s < 0 ? '−' : ''}${Math.abs(s).toFixed(2).replace('.', ',')} s`;

/**
 * Karaoke-style lyrics for the now-playing track. LRC lyrics follow the music
 * (the current line is highlighted and kept centred; clicking a line seeks);
 * plain text is shown as-is. A per-track offset (track.lyricsOffset, seconds,
 * positive = lyrics later) fixes LRC files that are ahead of or behind the recording.
 */
export function LyricsPanel({ track }) {
  const parsed = useMemo(() => parseLyrics(track.lyrics), [track.lyrics]);
  const { updateTrack } = useLibraryStore();
  const offset = track.lyricsOffset || 0;
  const [active, setActive] = useState(-1);
  // "Dopasuj" mode belongs to one track, so skipping to the next one leaves it.
  const [calibratingId, setCalibratingId] = useState(null);
  const calibrating = calibratingId === track.id;
  const setCalibrating = (on) => setCalibratingId(on ? track.id : null);
  const listRef = useRef(null);
  const pausedUntil = useRef(0);

  useEffect(() => {
    if (!parsed?.synced) return;
    let frame;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const idx = activeLineIndex(parsed.lines, heardTime() - offset + LEAD);
      setActive(prev => (prev === idx ? prev : idx));
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [parsed, offset]);

  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector(`[data-line="${active}"]`);
    if (!el || calibrating || Date.now() < pausedUntil.current) return;
    list.scrollTo({ top: el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
  }, [active, calibrating]);

  // Let the user scroll around freely for a few seconds before auto-follow resumes.
  const holdAutoScroll = () => { pausedUntil.current = Date.now() + 4000; };

  const saveOffset = (value) => {
    const next = Math.round(Math.min(MAX_OFFSET, Math.max(-MAX_OFFSET, value)) * 100) / 100;
    if (next !== offset) updateTrack(track.id, { lyricsOffset: next });
  };

  const onLineClick = (line) => {
    if (calibrating) {
      // This line is being sung right now → shift the whole text so it starts here.
      saveOffset(heardTime() - REACTION - line.time);
      setCalibrating(false);
      showToast('Tekst dopasowany — dostrój strzałkami, jeśli trzeba', 'success');
      return;
    }
    pausedUntil.current = 0;
    usePlayerStore.getState().seek(Math.max(0, line.time + offset));
  };

  if (!parsed) return <LyricsEmpty track={track} />;

  return (
    <div className="lyrics">
      <div
        className={`lyrics-scroll ${calibrating ? 'lyrics-scroll--calibrating' : ''}`}
        ref={listRef}
        onWheel={holdAutoScroll}
        onTouchMove={holdAutoScroll}
      >
        {parsed.lines.map((line, i) => (
          parsed.synced ? (
            <button
              key={i}
              data-line={i}
              className={`lyrics-line ${i === active ? 'lyrics-line--active' : ''} ${i < active ? 'lyrics-line--past' : ''}`}
              onClick={() => onLineClick(line)}
            >
              {line.text || '♪'}
            </button>
          ) : (
            <p key={i} className="lyrics-line lyrics-line--plain">{line.text || ' '}</p>
          )
        ))}
      </div>
      {parsed.synced ? (
        <div className="lyrics-sync">
          {calibrating ? (
            <>
              <span className="lyrics-sync-hint">Kliknij linię w chwili, gdy ją słychać</span>
              <button className="lyrics-sync-btn" onClick={() => setCalibrating(false)}>Anuluj</button>
            </>
          ) : (
            <>
              <button
                className="lyrics-sync-btn lyrics-sync-step"
                onClick={() => saveOffset(offset - NUDGE)}
                title="Tekst się spóźnia — pokazuj go wcześniej"
                aria-label="Pokazuj tekst wcześniej"
              >«</button>
              <span className={`lyrics-sync-value ${offset ? 'lyrics-sync-value--set' : ''}`} title="Przesunięcie tekstu względem muzyki">
                {offset ? `Tekst ${formatOffset(offset)}` : 'Synchronizacja'}
              </span>
              <button
                className="lyrics-sync-btn lyrics-sync-step"
                onClick={() => saveOffset(offset + NUDGE)}
                title="Tekst się spieszy — pokazuj go później"
                aria-label="Pokazuj tekst później"
              >»</button>
              {offset !== 0 && (
                <button className="lyrics-sync-btn" onClick={() => saveOffset(0)} title="Wróć do oryginalnych znaczników czasu">Zeruj</button>
              )}
              <button
                className="lyrics-sync-btn lyrics-sync-btn--accent"
                onClick={() => setCalibrating(true)}
                title="Kliknij potem linię, którą właśnie słychać — reszta tekstu dopasuje się sama"
              >Dopasuj</button>
            </>
          )}
        </div>
      ) : (
        <p className="lyrics-note">Tekst bez znaczników czasu — wgraj plik .lrc, żeby śledził muzykę.</p>
      )}
    </div>
  );
}

function LyricsEmpty({ track }) {
  const { isAdmin } = useAuthStore();
  const { updateTrack } = useLibraryStore();
  const inputRef = useRef(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await file.text();
    if (!parseLyrics(text)) { showToast('Ten plik nie zawiera tekstu', 'error'); return; }
    await updateTrack(track.id, { lyrics: text, lyricsOffset: 0, enrich: { ...track.enrich, lyricsLocked: true } });
    showToast(`Dodano tekst do „${track.title}”`, 'success');
  };

  return (
    <div className="lyrics lyrics--empty">
      <span className="lyrics-empty-icon"><LyricsIcon /></span>
      <p className="lyrics-empty-title">Brak tekstu dla tego utworu</p>
      <p className="lyrics-empty-sub">
        Obsługiwane są pliki .lrc (tekst zsynchronizowany z muzyką) i zwykłe .txt. Teksty wbudowane w tagi mp3 wczytują się same przy wgrywaniu.
      </p>
      {isAdmin() && (
        <>
          <button className="btn btn--primary btn--sm" onClick={() => inputRef.current?.click()}><UploadIcon /> Dodaj plik z tekstem</button>
          <input ref={inputRef} type="file" accept=".lrc,.txt,text/plain" hidden onChange={onFile} />
        </>
      )}
    </div>
  );
}
