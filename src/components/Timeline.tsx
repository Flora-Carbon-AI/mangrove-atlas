"use client";

import { useEffect } from "react";

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
 * The year ribbon. Years sit on a true time axis so the gaps in the record
 * (e.g. GMW has nothing between 1996 and 2007) read as gaps, not as neighbours.
 */
export default function Timeline({ years, year, base, playing, loading, onYear, onTogglePlay }: Props) {
  const first = years[0];
  const last = years[years.length - 1];
  const span = Math.max(1, last - first);
  const pos = (y: number) => ((y - first) / span) * 100;

  // Hatched spans for stretches with no observations.
  const gaps: [number, number][] = [];
  for (let i = 1; i < years.length; i++) {
    if (years[i] - years[i - 1] > 1) gaps.push([years[i - 1], years[i]]);
  }

  const idx = years.indexOf(year);
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

  return (
    <div className="timeline" aria-label="Year">
      <div className="timeline-year" aria-live="polite">
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

      <div className="track">
        <div className="track-line" />
        {gaps.map(([a, b]) => (
          <div
            key={a}
            className="track-gap"
            style={{ left: `${pos(a)}%`, width: `${pos(b) - pos(a)}%` }}
            title={`No observations ${a + 1}–${b - 1}`}
          />
        ))}
        {base !== null && <div className="track-base" style={{ left: `${pos(base)}%` }} aria-hidden="true" />}
        {years.map((y) => {
          const showLabel = y === first || y === last || y === year || years.length <= 12 || y % 5 === 0;
          return (
            <button
              key={y}
              type="button"
              className="notch"
              data-active={y === year || undefined}
              style={{ left: `${pos(y)}%` }}
              onClick={() => onYear(y)}
              aria-label={`Show ${y}`}
              aria-pressed={y === year}
            >
              <i />
              {showLabel && <span>{y}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
