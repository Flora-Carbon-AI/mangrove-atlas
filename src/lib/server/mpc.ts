import "server-only";
import type { BBox, DatasetId } from "../datasets";
import { COLORS } from "../datasets";
import { bboxAreaKm2, bboxPolygon, intersectBBox } from "../geo";
import type { TileSource } from "../types";

/**
 * Microsoft Planetary Computer helpers. The STAC and data APIs are public,
 * so this path works with no credentials at all.
 */

const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1";
const DATA = "https://planetarycomputer.microsoft.com/api/data/v1";

interface MpcConfig {
  collection: string;
  asset: string;
  /** titiler band-math expression that yields 1 for mangrove, 0 otherwise. */
  expression: string;
  /** CCI is tiled per 45° item (its mosaic only serves zoom ≥ 12); WorldCover uses a mosaic. */
  tiling: "item" | "mosaic";
  minZoom: number;
  maxNativeZoom: number;
  attribution: string;
}

const CONFIG: Partial<Record<DatasetId, MpcConfig>> = {
  "esa-cci-lc": {
    collection: "esa-cci-lc",
    asset: "lccs_class",
    expression: "lccs_class==170",
    tiling: "item",
    minZoom: 0,
    maxNativeZoom: 10,
    attribution: "ESA Land Cover CCI / C3S via Microsoft Planetary Computer",
  },
  "esa-worldcover": {
    collection: "esa-worldcover",
    asset: "map",
    expression: "map==95",
    tiling: "mosaic",
    minZoom: 6,
    maxNativeZoom: 14,
    attribution: "ESA WorldCover via Microsoft Planetary Computer",
  },
};

export function mpcConfig(id: DatasetId): MpcConfig {
  const c = CONFIG[id];
  if (!c) throw new Error(`${id} is not a Planetary Computer dataset`);
  return c;
}

/** Mangroves sit between roughly 40°S and 35°N; skip items outside that band. */
const MANGROVE_BELT: BBox = [-180, -45, 180, 45];

interface StacItem {
  id: string;
  bbox: BBox;
}

const ONE_DAY = 24 * 60 * 60 * 1000;
const memo = new Map<string, { at: number; value: Promise<unknown> }>();

function remember<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
  const value = fn().catch((err) => {
    memo.delete(key);
    throw err;
  });
  memo.set(key, { at: Date.now(), value });
  return value;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Planetary Computer ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

/** STAC items for a collection and year that intersect a bbox. */
export function searchItems(collection: string, year: number, bbox: BBox): Promise<StacItem[]> {
  const key = `items:${collection}:${year}:${bbox.map((v) => v.toFixed(3)).join(",")}`;
  return remember(key, ONE_DAY, async () => {
    const items: StacItem[] = [];
    let body: Record<string, unknown> | null = {
      collections: [collection],
      datetime: `${year}-01-01T00:00:00Z/${year}-12-31T23:59:59Z`,
      bbox,
      limit: 250,
      fields: { include: ["id", "bbox"], exclude: ["assets", "properties", "links"] },
    };
    // Follow STAC pagination; WorldCover has thousands of 3° items.
    for (let page = 0; body && page < 20; page++) {
      const res: { features: StacItem[]; links?: { rel: string; body?: Record<string, unknown> }[] } =
        await postJson(`${STAC}/search`, body);
      items.push(...res.features.map((f) => ({ id: f.id, bbox: f.bbox })));
      const next = res.links?.find((l) => l.rel === "next");
      body = next?.body ?? null;
    }
    return items;
  });
}

/** Registers (once) a mosaic of one year's items and returns its search id. */
function mosaicId(collection: string, year: number): Promise<string> {
  return remember(`mosaic:${collection}:${year}`, ONE_DAY, async () => {
    const res = await postJson<{ searchid: string }>(`${DATA}/mosaic/register`, {
      collections: [collection],
      "filter-lang": "cql2-json",
      filter: {
        op: "anyinteracts",
        args: [{ property: "datetime" }, { interval: [`${year}-01-01T00:00:00Z`, `${year}-12-31T23:59:59Z`] }],
      },
    });
    return res.searchid;
  });
}

function rgba(hex: string): [number, number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function renderParams(c: MpcConfig): string {
  const p = new URLSearchParams({
    collection: c.collection,
    assets: c.asset,
    expression: c.expression,
    asset_as_band: "true",
    colormap: JSON.stringify({ "0": [0, 0, 0, 0], "1": rgba(COLORS.mangrove) }),
  });
  return p.toString();
}

export async function mpcExtentSources(id: DatasetId, year: number): Promise<TileSource[]> {
  const c = mpcConfig(id);
  if (c.tiling === "mosaic") {
    const sid = await mosaicId(c.collection, year);
    return [
      {
        tiles: [`${DATA}/mosaic/${sid}/tiles/WebMercatorQuad/{z}/{x}/{y}@2x.png?${renderParams(c)}`],
        minzoom: c.minZoom,
        maxzoom: c.maxNativeZoom,
      },
    ];
  }
  const items = await searchItems(c.collection, year, MANGROVE_BELT);
  return items.map((item) => ({
    tiles: [
      `${DATA}/item/tiles/WebMercatorQuad/{z}/{x}/{y}@2x.png?item=${encodeURIComponent(item.id)}&${renderParams(c)}`,
    ],
    bounds: item.bbox,
    minzoom: c.minZoom,
    maxzoom: c.maxNativeZoom,
  }));
}

interface StatsFeature {
  properties: { statistics: Record<string, { mean: number }> };
}

/** Run async tasks with bounded concurrency so we stay polite to the public API. */
async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

/** Mangrove fraction × geodesic area, summed over the items covering the bbox. */
export async function mpcAreaByYear(id: DatasetId, bbox: BBox, years: number[]): Promise<Record<string, number>> {
  const c = mpcConfig(id);
  const results = await pool(years, 6, async (year) => {
    const items = await searchItems(c.collection, year, bbox);
    let km2 = 0;
    for (const item of items) {
      const part = intersectBBox(bbox, item.bbox);
      if (!part) continue;
      const url = `${DATA}/item/statistics?item=${encodeURIComponent(item.id)}&collection=${c.collection}&assets=${c.asset}&expression=${encodeURIComponent(c.expression)}&asset_as_band=true`;
      const res = await postJson<StatsFeature>(url, { type: "Feature", properties: {}, geometry: bboxPolygon(part) });
      const mean = res.properties.statistics[c.expression]?.mean ?? 0;
      km2 += mean * bboxAreaKm2(part);
    }
    return [String(year), km2] as const;
  });
  return Object.fromEntries(results);
}

/** Whether a point was mapped as mangrove in each year. */
export async function mpcPointHistory(id: DatasetId, lon: number, lat: number, years: number[]) {
  const c = mpcConfig(id);
  const eps = 1e-6;
  const point: BBox = [lon - eps, lat - eps, lon + eps, lat + eps];
  const results = await pool(years, 6, async (year) => {
    const [item] = await searchItems(c.collection, year, point);
    if (!item) return [String(year), null] as const;
    const url = `${DATA}/item/point/${lon},${lat}?item=${encodeURIComponent(item.id)}&collection=${c.collection}&assets=${c.asset}&expression=${encodeURIComponent(c.expression)}&asset_as_band=true`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [String(year), null] as const;
    const body = (await res.json()) as { values?: (number | null)[] };
    const v = body.values?.[0];
    return [String(year), v === null || v === undefined ? null : v] as const;
  });
  return Object.fromEntries(results) as Record<string, number | null>;
}
