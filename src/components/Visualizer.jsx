import React, { useRef, useEffect } from 'react';
import { usePlayerStore } from '../store';
import { useUiStore } from '../ui';

const readVar = (name, fallback) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * Audio Visualizer — canvas drawing of the Web Audio AnalyserNode.
 * Props:
 *   size: 'small' (player bar) | 'large' (now playing)
 *   color: optional CSS color; defaults to the live theme accent
 * Clicking cycles the style: bars → wave → mirror.
 */
export function Visualizer({ size = 'small', color }) {
  const canvasRef = useRef(null);
  const { analyser, isPlaying } = usePlayerStore();
  const { visualizerStyle, cycleVisualizer } = useUiStore();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const wave = new Uint8Array(analyser.fftSize);
    let frame;

    const render = () => {
      frame = requestAnimationFrame(render);
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      if (!isPlaying) return;

      // Read the colors every frame so palette / Kameleon changes apply live.
      const c1 = color || readVar('--accent', '#a78bfa');
      const c2 = readVar('--accent-2', c1);
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      ctx.fillStyle = grad;
      ctx.strokeStyle = grad;

      if (visualizerStyle === 'wave') {
        analyser.getByteTimeDomainData(wave);
        ctx.lineWidth = size === 'large' ? 3 : 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < wave.length; i++) {
          const x = (i / (wave.length - 1)) * w;
          const y = (wave[i] / 255) * h;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        return;
      }

      analyser.getByteFrequencyData(bins);
      const barCount = size === 'large' ? 56 : 28;
      const slot = w / barCount;
      const barWidth = slot * 0.62;
      const mirror = visualizerStyle === 'mirror';

      for (let i = 0; i < barCount; i++) {
        const value = bins[Math.floor((i / barCount) * bins.length * 0.75)] / 255;
        const x = i * slot + (slot - barWidth) / 2;
        ctx.globalAlpha = 0.45 + value * 0.55;
        ctx.beginPath();
        if (mirror) {
          const bh = Math.max(2, value * h * 0.9);
          ctx.roundRect(x, (h - bh) / 2, barWidth, bh, barWidth / 2);
        } else {
          const bh = Math.max(3, value * h);
          ctx.roundRect(x, h - bh, barWidth, bh, [barWidth / 2, barWidth / 2, 0, 0]);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    render();
    return () => cancelAnimationFrame(frame);
  }, [analyser, isPlaying, size, color, visualizerStyle]);

  if (!analyser) return null;

  const dims = size === 'large'
    ? { width: 840, height: 160, style: { width: '100%', height: 80 } }
    : { width: 240, height: 64, style: { width: 120, height: 32 } };

  return (
    <canvas
      ref={canvasRef}
      width={dims.width}
      height={dims.height}
      onClick={cycleVisualizer}
      title="Kliknij, aby zmienić styl wizualizacji"
      style={{ ...dims.style, display: 'block', cursor: 'pointer' }}
    />
  );
}
