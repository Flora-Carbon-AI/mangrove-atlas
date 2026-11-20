"use client";

import { useState } from "react";
import { formatArea } from "@/lib/geo";
import type { YearArea } from "@/lib/types";

interface Props {
  data: YearArea[];
  selected: number;
  onSelect: (year: number) => void;
}

const W = 320;
const H = 132;
const PAD = { top: 10, right: 6, bottom: 20, left: 6 };

/** Mangrove area per year, bars placed on a true time axis. */
export default function AreaChart({ data, selected, onSelect }: Props) {
  const [hover, setHover] = useState<YearArea | null>(null);
  const first = data[0].year;
  const last = data[data.length - 1].year;
  const span = Math.max(1, last - first);
  const max = Math.max(...data.map((d) => d.areaKm2), 1e-9);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / (span + 1);
  const barW = Math.max(3, Math.min(18, slot - 2));
  const x = (y: number) => PAD.left + ((y - first) / (span + 1)) * innerW + (slot - barW) / 2;
  const h = (v: number) => (v / max) * innerH;
  const shown = hover ?? data.find((d) => d.year === selected) ?? data[data.length - 1];

  return (
    <figure className="chart">
      <div className="chart-readout" aria-live="polite">
        <strong>{formatArea(shown.areaKm2)}</strong>
        <span>in {shown.year}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mangrove area by year in the current view">
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="chart-axis" />
        {data.map((d) => {
          const bh = h(d.areaKm2);
          const bx = x(d.year);
          const by = H - PAD.bottom - bh;
          const r = Math.min(4, barW / 2, bh);
          // Rounded data-end, square baseline.
          const path =
            bh <= 0
              ? ""
              : `M${bx},${H - PAD.bottom} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + barW - r} Q${bx + barW},${by} ${bx + barW},${by + r} V${H - PAD.bottom} Z`;
          return (
            <g
              key={d.year}
              onMouseEnter={() => setHover(d)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(d.year)}
              className="chart-bar"
              data-active={d.year === selected || undefined}
            >
              {/* Hit target wider and taller than the mark. */}
              <rect x={bx - (slot - barW) / 2} y={PAD.top} width={slot} height={innerH} fill="transparent" />
              {path && <path d={path} />}
              <title>{`${d.year}: ${formatArea(d.areaKm2)}`}</title>
            </g>
          );
        })}
        <text x={PAD.left} y={H - 5} className="chart-tick">{first}</text>
        <text x={W - PAD.right} y={H - 5} className="chart-tick" textAnchor="end">{last}</text>
      </svg>
      <table className="sr-only">
        <caption>Mangrove area by year</caption>
        <thead><tr><th>Year</th><th>Area</th></tr></thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.year}><td>{d.year}</td><td>{formatArea(d.areaKm2)}</td></tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
