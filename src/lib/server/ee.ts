import "server-only";
// The Earth Engine client is CommonJS and ships no types.
import ee from "@google/earthengine";
import type { BBox } from "../datasets";
import { COLORS } from "../datasets";

/**
 * Global Mangrove Watch v3 extent rasters, mirrored into Earth Engine by the
 * awesome-gee-community-catalog (https://gee-community-catalog.org/projects/mangrove/).
 */
export const GMW_V3_EXTENT =
  "projects/earthengine-legacy/assets/projects/sat-io/open-datasets/GMW/extent/GMW_V3";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/** Reads the service account key from the environment. Never sent to the client. */
function readKey(): ServiceAccountKey | null {
  const raw =
    process.env.GEE_SERVICE_ACCOUNT_JSON ??
    (process.env.GEE_SERVICE_ACCOUNT_JSON_BASE64
      ? Buffer.from(process.env.GEE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8")
      : undefined);
  if (!raw) return null;
  const key = JSON.parse(raw) as ServiceAccountKey;
  // Keys pasted into .env files often arrive with literal "\n" sequences.
  key.private_key = key.private_key.replace(/\\n/g, "\n");
  return key;
}

export function geeConfigured(): boolean {
  return Boolean(process.env.GEE_SERVICE_ACCOUNT_JSON || process.env.GEE_SERVICE_ACCOUNT_JSON_BASE64);
}

let ready: Promise<void> | null = null;

/** Authenticates and initialises Earth Engine once per server process. */
export function initEE(): Promise<void> {
  if (ready) return ready;
  ready = new Promise<void>((resolve, reject) => {
    let key: ServiceAccountKey | null;
    try {
      key = readKey();
    } catch (err) {
      reject(new Error(`GEE_SERVICE_ACCOUNT_JSON is not valid JSON: ${(err as Error).message}`));
      return;
    }
    if (!key) {
      reject(new Error("Earth Engine is not configured. Set GEE_SERVICE_ACCOUNT_JSON (see README)."));
      return;
    }
    const project = process.env.GEE_PROJECT || key.project_id || null;
    ee.data.authenticateViaPrivateKey(
      key,
      () => ee.initialize(null, null, () => resolve(), (e: unknown) => reject(toError(e)), null, project),
      (e: unknown) => reject(toError(e)),
    );
  }).catch((err) => {
    ready = null; // allow a retry on the next request
    throw err;
  });
  return ready;
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/** Promise wrapper around ComputedObject.evaluate. */
export function evaluate<T>(obj: { evaluate: (cb: (r: T, e?: string) => void) => void }): Promise<T> {
  return new Promise((resolve, reject) =>
    obj.evaluate((result, error) => (error ? reject(new Error(error)) : resolve(result))),
  );
}

function getMapUrl(image: unknown, vis: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) =>
    (image as { getMap: (v: unknown, cb: (m: { urlFormat: string } | undefined, e?: string) => void) => void }).getMap(
      vis,
      (map, error) => (error || !map ? reject(new Error(error ?? "getMap failed")) : resolve(map.urlFormat)),
    ),
  );
}

/**
 * Binary GMW v3 mangrove mask for a year: 1 = mangrove, 0 = not.
 *
 * The catalog page does not document how images map to years, so we select
 * images whose system:index contains the year and fall back to a date filter.
 * /api/status?diagnose=1 prints what the collection actually contains.
 */
export function gmwMask(year: number) {
  const col = ee.ImageCollection(GMW_V3_EXTENT);
  const byIndex = col.filter(ee.Filter.stringContains("system:index", String(year)));
  const byDate = col.filterDate(`${year}-01-01`, `${year + 1}-01-01`);
  const chosen = ee.ImageCollection(ee.Algorithms.If(byIndex.size().gt(0), byIndex, byDate));
  return chosen.mosaic().select([0]).gt(0).unmask(0).rename("mangrove");
}

const hex = (c: string) => c.replace("#", "");

// Map IDs expire after a few hours; cache them for one.
const tileCache = new Map<string, { url: string; at: number }>();
const TILE_TTL_MS = 60 * 60 * 1000;

async function cachedTiles(key: string, build: () => Promise<string>): Promise<string> {
  const hit = tileCache.get(key);
  if (hit && Date.now() - hit.at < TILE_TTL_MS) return hit.url;
  const url = await build();
  tileCache.set(key, { url, at: Date.now() });
  return url;
}

export async function gmwExtentTiles(year: number): Promise<string> {
  await initEE();
  return cachedTiles(`extent:${year}`, () =>
    getMapUrl(gmwMask(year).selfMask(), { min: 1, max: 1, palette: [hex(COLORS.mangrove)] }),
  );
}

/** Gain (1, blue) and loss (2, coral) between two years. */
export async function gmwChangeTiles(base: number, year: number): Promise<string> {
  await initEE();
  return cachedTiles(`change:${base}:${year}`, () => {
    const a = gmwMask(base);
    const b = gmwMask(year);
    const gain = b.and(a.not());
    const loss = a.and(b.not());
    const change = gain.add(loss.multiply(2)).selfMask();
    return getMapUrl(change, { min: 1, max: 2, palette: [hex(COLORS.gain), hex(COLORS.loss)] });
  });
}

/** Mangrove area (km²) inside a bbox for every requested year, in one round trip. */
export async function gmwAreaByYear(bbox: BBox, years: number[], regionKm2: number): Promise<Record<string, number>> {
  await initEE();
  const region = ee.Geometry.Rectangle(bbox, null, false);
  // Native 25 m, coarsened for large regions so a request stays interactive.
  const scale = Math.max(25, Math.round(Math.sqrt((regionKm2 * 1e6) / 4e6)));
  const dict = ee.Dictionary.fromLists(
    years.map(String),
    years.map((y) =>
      gmwMask(y)
        .multiply(ee.Image.pixelArea())
        .reduceRegion({
          reducer: ee.Reducer.sum(),
          geometry: region,
          scale,
          maxPixels: 1e10,
          bestEffort: true,
          tileScale: 4,
        })
        .get("mangrove"),
    ),
  );
  const m2 = await evaluate<Record<string, number | null>>(dict);
  return Object.fromEntries(Object.entries(m2).map(([y, v]) => [y, (v ?? 0) / 1e6]));
}

/** Whether a point was mangrove in each year. */
export async function gmwPointHistory(lon: number, lat: number, years: number[]): Promise<Record<string, number | null>> {
  await initEE();
  const stack = ee.Image.cat(years.map((y) => gmwMask(y).rename(`y${y}`)));
  const values = await evaluate<Record<string, number | null>>(
    stack.reduceRegion({ reducer: ee.Reducer.first(), geometry: ee.Geometry.Point([lon, lat]), scale: 25 }),
  );
  return Object.fromEntries(years.map((y) => [String(y), values[`y${y}`] ?? null]));
}

/** Describes the GMW collection so a maintainer can check the year mapping. */
export async function gmwDiagnostics() {
  await initEE();
  const col = ee.ImageCollection(GMW_V3_EXTENT);
  return evaluate<Record<string, unknown>>(
    ee.Dictionary({
      size: col.size(),
      ids: col.aggregate_array("system:index").slice(0, 30),
      starts: col.aggregate_array("system:time_start").slice(0, 30),
      bands: ee.Image(col.first()).bandNames(),
    }),
  );
}
