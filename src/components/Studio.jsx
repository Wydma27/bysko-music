import React, { useEffect, useRef } from 'react';
import { usePlayerStore, FX_PRESETS } from '../store';
import { useUiStore, ACCENTS } from '../ui';
import { WandIcon, PaletteIcon, XIcon, CheckIcon, SunIcon, MoonIcon, HeadphonesIcon } from './Icons';

// ── Small shared controls ─────────────────────────────────────
export function Switch({ checked, onChange, label, hint }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`switch-row ${checked ? 'switch-row--on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {hint && <span className="switch-hint">{hint}</span>}
      </span>
      <span className="switch-track"><span className="switch-thumb" /></span>
    </button>
  );
}

function FxSlider({ label, value, min, max, step, format, onChange }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="fx-slider">
      <span className="fx-slider-head">
        <span>{label}</span>
        <span className="fx-slider-value">{format(value)}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        style={{ '--fill': `${pct}%` }}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={`segmented-btn ${value === o.value ? 'segmented-btn--active' : ''}`} onClick={() => onChange(o.value)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

// ── Vibe Studio (live audio FX) ───────────────────────────────
export function VibeStudioModal({ onClose }) {
  const { fx, fxPreset, setFx, applyFxPreset, analyser } = usePlayerStore();

  return (
    <div className="upload-overlay" onClick={onClose}>
      <div className="studio-modal" onClick={e => e.stopPropagation()}>
        <div className="studio-header">
          <span className="studio-icon"><WandIcon /></span>
          <div className="studio-heading">
            <h3>Vibe Studio</h3>
            <p>Zmieniaj brzmienie na żywo — działa na każdym utworze z biblioteki</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Zamknij"><XIcon /></button>
        </div>

        <div className="fx-presets">
          {FX_PRESETS.map(p => (
            <button key={p.id} className={`fx-preset ${fxPreset === p.id ? 'fx-preset--active' : ''}`} onClick={() => applyFxPreset(p.id)}>
              <span className="fx-preset-name">{p.name}{p.id === '8d' && <HeadphonesIcon />}</span>
              <span className="fx-preset-desc">{p.desc}</span>
            </button>
          ))}
        </div>

        <div className="studio-section-title">Ręczne ustawienia {fxPreset === 'custom' && <span className="studio-chip">własne</span>}</div>
        <div className="fx-controls">
          <FxSlider label="Tempo" value={fx.speed} min={0.5} max={1.5} step={0.05} format={v => `${v.toFixed(2)}×`} onChange={v => setFx({ speed: v })} />
          <FxSlider label="Pogłos" value={fx.reverb} min={0} max={1} step={0.05} format={v => `${Math.round(v * 100)}%`} onChange={v => setFx({ reverb: v })} />
          <FxSlider label="Wzmocnienie basu" value={fx.bass} min={0} max={12} step={1} format={v => (v ? `+${v} dB` : '0 dB')} onChange={v => setFx({ bass: v })} />
        </div>
        <div className="switch-list">
          <Switch checked={fx.eightD} onChange={v => setFx({ eightD: v })} label="Audio 8D" hint="Dźwięk płynnie krąży między lewym a prawym uchem" />
          <Switch checked={fx.lofi} onChange={v => setFx({ lofi: v })} label="Filtr lo-fi" hint="Ucina górę pasma — ciepło jak z kasety" />
          <Switch checked={!fx.preservePitch} onChange={v => setFx({ preservePitch: !v })} label="Tryb winylu" hint="Zmiana tempa zmienia też wysokość dźwięku" />
        </div>

        {!analyser && <p className="studio-note">Pogłos, bas, 8D i lo-fi zadziałają od pierwszego odtworzonego utworu (przeglądarka wymaga kliknięcia Play).</p>}
      </div>
    </div>
  );
}

// ── Appearance (palette / mode / ambient) ─────────────────────
export function AppearanceModal({ onClose }) {
  const {
    mode, accentId, ambient, reactiveGlow, visualizerStyle,
    setAccent, setMode, toggleAmbient, toggleReactiveGlow, setVisualizerStyle,
  } = useUiStore();

  return (
    <div className="upload-overlay" onClick={onClose}>
      <div className="studio-modal" onClick={e => e.stopPropagation()}>
        <div className="studio-header">
          <span className="studio-icon"><PaletteIcon /></span>
          <div className="studio-heading">
            <h3>Wygląd</h3>
            <p>Paleta, tryb i efekty tła — zapisują się na tym urządzeniu</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Zamknij"><XIcon /></button>
        </div>

        <div className="studio-section-title">Tryb</div>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'dark', label: 'Ciemny', icon: <MoonIcon /> },
            { value: 'light', label: 'Jasny', icon: <SunIcon /> },
          ]}
        />

        <div className="studio-section-title">Paleta</div>
        <div className="swatch-grid">
          {ACCENTS.map(a => {
            const [c1, c2] = a[mode] || a.dark;
            const bg = a.dynamic
              ? 'conic-gradient(from 200deg, #ff8a4c, #ffc857, #5eead4, #4cc9f0, #a78bfa, #ff6ba6, #ff8a4c)'
              : `linear-gradient(135deg, ${c1}, ${c2})`;
            return (
              <button key={a.id} className={`swatch ${accentId === a.id ? 'swatch--active' : ''}`} onClick={() => setAccent(a.id)}>
                <span className="swatch-color" style={{ background: bg }}>{accentId === a.id && <CheckIcon />}</span>
                <span className="swatch-name">{a.name}</span>
                <span className="swatch-desc">{a.desc}</span>
              </button>
            );
          })}
        </div>

        <div className="studio-section-title">Tło i wizualizacja</div>
        <div className="switch-list">
          <Switch checked={ambient} onChange={toggleAmbient} label="Poświata w tle" hint="Miękkie światło w kolorze akcentu za interfejsem" />
          <Switch checked={reactiveGlow} onChange={toggleReactiveGlow} label="Pulsuje z basem" hint="Poświata oddycha w rytm muzyki" />
        </div>
        <Segmented
          value={visualizerStyle}
          onChange={setVisualizerStyle}
          options={[
            { value: 'bars', label: 'Słupki' },
            { value: 'wave', label: 'Fala' },
            { value: 'mirror', label: 'Lustro' },
          ]}
        />
      </div>
    </div>
  );
}

// ── Ambient glow behind the whole UI (optionally bass-reactive) ──
export function AmbientBackground() {
  const { ambient, reactiveGlow } = useUiStore();
  const { analyser, isPlaying } = usePlayerStore();
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!reactiveGlow || !analyser || !isPlaying) { el.style.setProperty('--beat', '0'); return; }
    const bins = new Uint8Array(analyser.frequencyBinCount);
    let frame;
    let smooth = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      analyser.getByteFrequencyData(bins);
      const bass = (bins[0] + bins[1] + bins[2]) / (3 * 255);
      smooth += (bass - smooth) * 0.2;
      el.style.setProperty('--beat', smooth.toFixed(3));
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [analyser, isPlaying, reactiveGlow, ambient]);

  if (!ambient) return null;
  return (
    <div ref={ref} className="ambient" aria-hidden="true">
      <div className="ambient-blob ambient-blob--a" />
      <div className="ambient-blob ambient-blob--b" />
    </div>
  );
}
