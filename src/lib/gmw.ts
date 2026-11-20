/**
 * Global Mangrove Watch v4.1 in the browser, with no server and no API keys.
 *
 * The data is one static PMTiles archive built by pipeline/build_tiles.py.
 * Each 512 px tile stores, per pixel, 41 bits: bit i = mangrove in 1985 + i.
 * Tiles also carry the exact mangrove area (km²) per year, summed from the
 * native-resolution pixels. Format "MGA1":
 *   bytes 0..3     "MGA1"
 *   bytes 4..167   float32 LE x 41, km² per year inside the tile
 *   bytes 168..    uint8 512*512*6, packed year bits per pixel (little-endian)
 *
 * We download a tile once, then draw any year (or the gain/loss between two)
 * from memory, so moving through time needs no network requests.
 */
import { PMTiles } from "pmtiles";
import { COLORS } from "./datasets";
import type { BBox } from "./datasets";

export const GMW_FIRST_YEAR = 1985;
export const GMW_YEARS = 41;
export const GMW_TILE = 512;
export const GMW_MAX_ZOOM = 11;
const BYTES = 6;
const HEADER = 4 + GMW_YEARS * 4;

export const GMW_URL = process.env.NEXT_PUBLIC_GMW_PMTILES_URL ?? "/data/gmw-v4112.pmtiles";

interface Tile {
  areas: Float32Array;
  bits: Uint8Array;
}

let archive: PMTiles | null = null;
function pm(): PMTiles {
  archive ??= new PMTiles(GMW_URL);
  return archive;
}

// Small LRU of decoded tiles (~1.6 MB each).
const CACHE_MAX = 32;
const cache = new Map<string, Promise<Tile | null>>();

export function getTile(z: number, x: number, y: number): Promise<Tile | null> {
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const p = pm()
    .getZxy(z, x, y)
    .then((res) => {
      if (!res) return null;
      const buf = res.data;
      const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
      if (magic !== "MGA1") throw new Error("Unexpected mangrove tile format");
      return { areas: new Float32Array(buf, 4, GMW_YEARS), bits: new Uint8Array(buf, HEADER) };
    })
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  cache.set(key, p);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return p;
}

const has = (bits: Uint8Array, px: number, yi: number) => (bits[px * BYTES + (yi >> 3)] >> (yi & 7)) & 1;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour one tile for a year, or for gain/loss between `base` and `year`. */
function paint(tile: Tile, mode: "extent" | "change", year: number, base: number): ImageData {
  const out = new ImageData(GMW_TILE, GMW_TILE);
  const px = out.data;
  const yi = year - GMW_FIRST_YEAR;
  const bi = base - GMW_FIRST_YEAR;
  const [mr, mg, mb] = rgb(COLORS.mangrove);
  const [gr, gg, gb] = rgb(COLORS.gain);
  const [lr, lg, lb] = rgb(COLORS.loss);
  const { bits } = tile;
  for (let i = 0; i < GMW_TILE * GMW_TILE; i++) {
    const o = i * 4;
    if (mode === "extent") {
      if (has(bits, i, yi)) {
        px[o] = mr;
        px[o + 1] = mg;
        px[o + 2] = mb;
        px[o + 3] = 255;
      }
    } else {
      const now = has(bits, i, yi);
      const then = has(bits, i, bi);
      if (now && !then) {
        px[o] = gr;
        px[o + 1] = gg;
        px[o + 2] = gb;
        px[o + 3] = 255;
      } else if (then && !now) {
        px[o] = lr;
        px[o + 1] = lg;
        px[o + 2] = lb;
        px[o + 3] = 255;
      }
    }
  }
  return out;
}

/**
 * MapLibre protocol handler for URLs like
 *   gmw://extent/2020/0/{z}/{x}/{y}  or  gmw://change/2020/1996/{z}/{x}/{y}
 */
export async function gmwProtocol(params: { url: string }) {
  const m = /^gmw:\/\/(extent|change)\/(\d{4})\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(params.url);
  if (!m) throw new Error(`Bad gmw URL: ${params.url}`);
  const [, mode, year, base, z, x, y] = m;
  const tile = await getTile(+z, +x, +y);
  // An empty buffer tells MapLibre the tile is blank (no mangroves here).
  if (!tile) return { data: new ArrayBuffer(0) };
  const image = paint(tile, mode as "extent" | "change", +year, +base);
  return { data: await createImageBitmap(image) };
}

export function gmwTileUrl(mode: "extent" | "change", year: number, base = 0) {
  return `gmw://${mode}/${year}/${base}/{z}/{x}/{y}`;
}

// ---------- tile maths ----------

const lonToX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const latToY = (lat: number, z: number) => {
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z;
};

/** Mangrove presence for every year at one point, read from the native-resolution tile. */
export async function pointYears(lon: number, lat: number): Promise<boolean[] | null> {
  const z = GMW_MAX_ZOOM;
  const fx = lonToX(lon, z);
  const fy = latToY(lat, z);
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  const tile = await getTile(z, tx, ty);
  if (!tile) return Array.from({ length: GMW_YEARS }, () => false);
  const col = Math.min(GMW_TILE - 1, Math.floor((fx - tx) * GMW_TILE));
  const row = Math.min(GMW_TILE - 1, Math.floor((fy - ty) * GMW_TILE));
  const i = row * GMW_TILE + col;
  return Array.from({ length: GMW_YEARS }, (_, yi) => has(tile.bits, i, yi) === 1);
}

/**
 * Mangrove km² per year inside a bbox. Sums each tile's stored areas, weighted
 * by how much of the tile lies inside the view, at the finest zoom that keeps
 * the request to a few dozen tiles. Approximate at the view's edges.
 */
export async function areaByYear(bbox: BBox, viewZoom: number): Promise<number[]> {
  const [w, s, e, n] = bbox;
  let z = Math.max(0, Math.min(GMW_MAX_ZOOM, Math.floor(viewZoom)));
  const span = (zz: number) => {
    const x0 = Math.floor(lonToX(w, zz));
    const x1 = Math.floor(lonToX(e, zz) - 1e-9);
    const y0 = Math.floor(latToY(n, zz));
    const y1 = Math.floor(latToY(s, zz) - 1e-9);
    return { x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
  };
  while (z > 0 && span(z).count > 48) z--;
  const { x0, x1, y0, y1 } = span(z);
  const fx0 = lonToX(w, z);
  const fx1 = lonToX(e, z);
  const fy0 = latToY(n, z);
  const fy1 = latToY(s, z);
  const jobs: Promise<number[] | null>[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const ox = Math.max(0, Math.min(x + 1, fx1) - Math.max(x, fx0));
      const oy = Math.max(0, Math.min(y + 1, fy1) - Math.max(y, fy0));
      const frac = ox * oy;
      if (frac <= 0) continue;
      jobs.push(getTile(z, x, y).then((t) => (t ? Array.from(t.areas, (a) => a * frac) : null)));
    }
  }
  const totals = new Array<number>(GMW_YEARS).fill(0);
  for (const r of await Promise.all(jobs)) {
    if (r) r.forEach((v, i) => (totals[i] += v));
  }
  return totals;
}
