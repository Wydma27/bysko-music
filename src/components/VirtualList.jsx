import React, { useEffect, useRef, useState } from 'react';

const ROW_HEIGHT = 60;
const OVERSCAN = 8;
const VIRTUALIZE_THRESHOLD = 60; // short lists just render fully — not worth the bookkeeping

/**
 * Windowed track list: renders only the rows near the viewport instead of the
 * whole library at once, so scrolling a library of thousands of tracks stays smooth.
 * Falls back to a plain render for short lists.
 */
export function VirtualTrackList({ items, header, renderItem }) {
  const containerRef = useRef(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(items.length, 60) });

  useEffect(() => {
    if (items.length <= VIRTUALIZE_THRESHOLD) return;
    const el = containerRef.current;
    if (!el) return;
    const scrollParent = el.closest('.content-area') || window;
    let frame = null;

    const update = () => {
      frame = null;
      const containerTop = el.getBoundingClientRect().top;
      const viewportHeight = window.innerHeight;
      const scrolledPast = Math.max(0, -containerTop);
      const start = Math.max(0, Math.floor(scrolledPast / ROW_HEIGHT) - OVERSCAN);
      const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN * 2;
      const end = Math.min(items.length, start + visibleCount);
      setRange({ start, end });
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };

    update();
    scrollParent.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      scrollParent.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [items.length]);

  if (items.length <= VIRTUALIZE_THRESHOLD) {
    return (
      <div className="tracks-list">
        {header}
        {items.map((item, i) => renderItem(item, i))}
      </div>
    );
  }

  const { start, end } = range;
  const topPad = start * ROW_HEIGHT;
  const bottomPad = (items.length - end) * ROW_HEIGHT;

  return (
    <div className="tracks-list" ref={containerRef}>
      {header}
      {topPad > 0 && <div style={{ height: topPad }} />}
      {items.slice(start, end).map((item, i) => renderItem(item, start + i))}
      {bottomPad > 0 && <div style={{ height: bottomPad }} />}
    </div>
  );
}
