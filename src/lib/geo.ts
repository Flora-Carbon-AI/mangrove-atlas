import type { BBox } from "./datasets";

const R = 6371008.8; // mean Earth radius, metres

/** Geodesic area of a lon/lat rectangle in km². */
export function bboxAreaKm2([w, s, e, n]: BBox): number {
  const rad = Math.PI / 180;
  const m2 = R * R * Math.abs((e - w) * rad) * Math.abs(Math.sin(n * rad) - Math.sin(s * rad));
  return m2 / 1e6;
}

export function intersectBBox(a: BBox, b: BBox): BBox | null {
  const w = Math.max(a[0], b[0]);
  const s = Math.max(a[1], b[1]);
  const e = Math.min(a[2], b[2]);
  const n = Math.min(a[3], b[3]);
  return w < e && s < n ? [w, s, e, n] : null;
}

export function parseBBox(v: string | null): BBox | null {
  if (!v) return null;
  const p = v.split(",").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isFinite(x))) return null;
  const [w, s, e, n] = p;
  if (w >= e || s >= n || s < -90 || n > 90 || w < -180 || e > 180) return null;
  return [w, s, e, n];
}

export function bboxPolygon([w, s, e, n]: BBox) {
  return {
    type: "Polygon" as const,
    coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
  };
}

export function formatArea(km2: number): string {
  if (km2 >= 1000) return `${Math.round(km2).toLocaleString("en-US")} km²`;
  if (km2 >= 10) return `${km2.toFixed(0)} km²`;
  if (km2 >= 1) return `${km2.toFixed(1)} km²`;
  return `${(km2 * 100).toFixed(0)} ha`;
}
