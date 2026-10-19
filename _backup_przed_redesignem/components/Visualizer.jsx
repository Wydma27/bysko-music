import React, { useRef, useEffect, useCallback } from 'react';
import { usePlayerStore } from '../store';

/**
 * Audio Visualizer — canvas-based frequency bars using Web Audio API AnalyserNode.
 * Props:
 *   size: 'small' (player bar) | 'large' (now playing)
 *   color: CSS color string, defaults to accent green
 */
export function Visualizer({ size = 'small', color = '#1DB954' }) {
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const { analyser, isPlaying } = usePlayerStore();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      animFrameRef.current = requestAnimationFrame(render);
      analyser.getByteFrequencyData(dataArray);

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const barCount = size === 'large' ? 60 : 28;
      const barWidth = (w / barCount) * 0.7;
      const gap = (w / barCount) * 0.3;

      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i / barCount) * bufferLength * 0.75);
        let value = dataArray[dataIndex] / 255;

        // When paused, don't render bars
        if (!isPlaying) {
          ctx.clearRect(0, 0, w, h);
          return;
        }

        const barHeight = Math.max(3, value * h);
        const x = i * (barWidth + gap);
        const y = h - barHeight;

        // Gradient: brighter at top
        const gradient = ctx.createLinearGradient(0, y, 0, h);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, color + '44');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
    };

    render();
  }, [analyser, isPlaying, size, color]);

  useEffect(() => {
    if (analyser) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      draw();
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [analyser, draw]);

  const dims = size === 'large'
    ? { width: 420, height: 80, style: { width: '100%', height: 80 } }
    : { width: 120, height: 32, style: { width: 120, height: 32 } };

  if (!analyser) return null;

  return (
    <canvas
      ref={canvasRef}
      width={dims.width}
      height={dims.height}
      style={{ ...dims.style, display: 'block', borderRadius: 4, opacity: 0.9 }}
    />
  );
}
