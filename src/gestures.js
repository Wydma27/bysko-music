import { useRef } from 'react';

/**
 * Touch swipe handlers for an element: quick horizontal flicks call onLeft/onRight,
 * a downward flick calls onDown. Spread the result onto the element.
 */
export function useSwipe({ onLeft, onRight, onDown }) {
  const start = useRef(null);
  return {
    onTouchStart: (e) => {
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY, at: Date.now() };
    },
    onTouchEnd: (e) => {
      const s = start.current;
      start.current = null;
      if (!s || Date.now() - s.at > 700) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? onLeft : onRight)?.();
      else if (dy > 90 && dy > Math.abs(dx) * 1.5) onDown?.();
    },
  };
}
