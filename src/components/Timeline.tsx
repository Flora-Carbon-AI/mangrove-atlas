"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  years: number[];
  year: number;
  /** Second marker for change / compare views. */
  base: number | null;
  playing: boolean;
  loading: boolean;
  onYear: (y: number) => void;
  onTogglePlay: () => void;
}

/**
 * The year ribbon: a slider you can drag, tap or drive with the keyboard.
 * Years sit on a true time axis so gaps in the record (e.g. GMW has nothing
 * between 1996 and 2007) read as gaps, not as neighbours. Dragging snaps to
 * the nearest year that has data.
 */
export default function Timeline({ years, year, base, playing, loading, onYear, onTogglePlay }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const first = years[0];
  const last = years[years.length - 1];
  const span = Math.max(1, last - first);
  const pos = (y: number) => ((y - first) / span) * 100;

  // Hatched spans for stretches with no observations.
  const gaps: [number, number][] = [];
  for (let i = 1; i < years.length; i++) {
    if (years[i] - years[i - 1] > 1) gaps.push([years[i - 1], years[i]]);
  }

  const nearestYear = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const target = first + frac * span;
    return years.reduce((best, y) => (Math.abs(y - target) < Math.abs(best - target) ? y : best), years[0]);
  };

  const pick = (clientX: number) => {
    const y = nearestYear(clientX);
    if (y !== year) onYear(y);
  };

  const idx = years.indexOf(year);
  const step = (delta: number) => {
    const next = years[Math.min(years.length - 1, Math.max(0, idx + delta))];
    if (next !== undefined && next !== year) onYear(next);
  };

  // Arrow keys anywhere on the page (outside form fields) also move the year.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, select, textarea, [role=slider]")) return;
      if (e.key === "ArrowRight" && idx < years.length - 1) onYear(years[idx + 1]);
      if (e.key === "ArrowLeft" && idx > 0) onYear(years[idx - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, years, onYear]);

  const labelEvery = years.length <= 12 ? 1 : years.length <= 30 ? 5 : 10;

  return (
    <div className="timeline">
      <div className="timeline-year" aria-hidden="true">
        <span className={loading ? "is-loading" : undefined}>{year}</span>
        {base !== null && <small>compared with {base}</small>}
      </div>

      <button
        type="button"
        className="play"
        onClick={onTogglePlay}
        aria-label={playing ? "Pause timelapse" : "Play timelapse"}
        title={playing ? "Pause" : "Play through every year"}
      >
        {playing ? (
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="4" width="3.5" height="12" rx="1" /><rect x="11.5" y="4" width="3.5" height="12" rx="1" /></svg>
        ) : (
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4.2v11.6a.8.8 0 0 0 1.2.7l9.4-5.8a.8.8 0 0 0 0-1.4L7.2 3.5A.8.8 0 0 0 6 4.2Z" /></svg>
        )}
      </button>

      <div
        ref={trackRef}
        className="track"
        data-dragging={dragging || undefined}
        role="slider"
        tabIndex={0}
        aria-label="Year"
        aria-valuemin={first}
        aria-valuemax={last}
        aria-valuenow={year}
        aria-valuetext={base !== null ? `${year}, compared with ${base}` : String(year)}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          pick(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e.clientX);
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e) => {
          const keys: Record<string, () => void> = {
            ArrowRight: () => step(1),
            ArrowUp: () => step(1),
            ArrowLeft: () => step(-1),
            ArrowDown: () => step(-1),
            PageUp: () => step(5),
            PageDown: () => step(-5),
            Home: () => onYear(first),
            End: () => onYear(last),
          };
          const fn = keys[e.key];
          if (fn) {
            e.preventDefault();
            fn();
          }
        }}
      >
        <div className="track-line" />
        {gaps.map(([a, b]) => (
          <div
            key={a}
            className="track-gap"
            style={{ left: `${pos(a)}%`, width: `${pos(b) - pos(a)}%` }}
            title={`No observations ${a + 1}–${b - 1}`}
          />
        ))}
        {base !== null && <div className="track-base" style={{ left: `${pos(base)}%` }} />}
        {years.map((y) => {
          // Always label the current year; drop axis labels that would collide with it.
          const showLabel =
            y === year || ((y === first || y === last || y % labelEvery === 0) && Math.abs(pos(y) - pos(year)) > 7);
          return (
            <div key={y} className="notch" data-active={y === year || undefined} style={{ left: `${pos(y)}%` }}>
              <i />
              {showLabel && <span>{y}</span>}
            </div>
          );
        })}
        <div className="thumb" style={{ left: `${pos(year)}%` }} />
      </div>
    </div>
  );
}
