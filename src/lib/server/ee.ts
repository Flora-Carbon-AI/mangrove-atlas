import "server-only";
// The Earth Engine client is CommonJS and ships no types.
import ee from "@google/earthengine";
import type { BBox, DatasetId } from "../datasets";
import { COLORS } from "../datasets";
import { HttpError } from "./http";

/**
 * Global Mangrove Watch v3 extent rasters, mirrored into Earth Engine by the
 * awesome-gee-community-catalog (https://gee-community-catalog.org/projects/mangrove/).
 */
export const GMW_V3_EXTENT =
  "projects/earthengine-legacy/assets/projects/sat-io/open-datasets/GMW/extent/GMW_V3";

/**
 * Continuous Global Mangrove Dynamics, annual extent 1984–2023 (The Mangrove Lab).
 * A FeatureCollection of mangrove polygons with `year`, `gridcode`, `area_km2`.
 * https://developers.google.com/earth-engine/datasets/catalog/projects_mangrovedatahub2_assets_CGMD-Extent30
 */
export const CGMD_EXTENT = "projects/mangrovedatahub2/assets/CGMD-Extent30";

type GeeDataset = Extract<DatasetId, "gmw-v3" | "cgmd-30">;

export function isGeeDataset(id: DatasetId): id is GeeDataset {
  return id === "gmw-v3" || id === "cgmd-30";
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/**
 * Reads the service account from the environment. Never sent to the client.
 *
 * Prefer GEE_CLIENT_EMAIL + GEE_PRIVATE_KEY: serverless hosts (Netlify,
 * AWS Lambda) cap all environment variables at ~4 KB combined, and a whole
 * key file is close to that on its own.
 */
function readKey(): ServiceAccountKey | null {
  let key: ServiceAccountKey | null = null;
  if (process.env.GEE_CLIENT_EMAIL && process.env.GEE_PRIVATE_KEY) {
    key = { client_email: process.env.GEE_CLIENT_EMAIL, private_key: process.env.GEE_PRIVATE_KEY };
  } else {
    const raw =
      process.env.GEE_SERVICE_ACCOUNT_JSON ??
      (process.env.GEE_SERVICE_ACCOUNT_JSON_BASE64
        ? Buffer.from(process.env.GEE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8")
        : undefined);
    if (raw) key = JSON.parse(raw) as ServiceAccountKey;
  }
  if (!key) return null;
  // Keys pasted into env settings often arrive with literal "\n" sequences.
  key.private_key = key.private_key.replace(/\\n/g, "\n");
  return key;
}

export function geeConfigured(): boolean {
  return Boolean(
    (process.env.GEE_CLIENT_EMAIL && process.env.GEE_PRIVATE_KEY) ||
      process.env.GEE_SERVICE_ACCOUNT_JSON ||
      process.env.GEE_SERVICE_ACCOUNT_JSON_BASE64,
  );
}

let ready: Promise<void> | null = null;

/** Authenticates and initialises Earth Engine once per server process. */
export function initEE(): Promise<void> {
  if (ready) return ready;
  ready = new Promise<void>((resolve, reject) => {
    let key: ServiceAccountKey | null;
    try {
      key = readKey();
    } catch {
      reject(new HttpError(503, "Earth Engine credentials are not valid JSON. Check the GEE_* settings."));
      return;
    }
    if (!key) {
      reject(new HttpError(503, "Earth Engine is not configured on this server. See the README to add credentials."));
      return;
    }
    const project = process.env.GEE_PROJECT || key.project_id || null;
    const fail = (e: unknown) => {
      // Log the detail for the operator; never echo provider errors to visitors.
      console.error("[ee] sign-in failed:", e instanceof Error ? e.message : e);
      reject(new HttpError(503, "Earth Engine sign-in failed. Check the server's GEE_* settings and logs."));
    };
    ee.data.authenticateViaPrivateKey(key, () => ee.initialize(null, null, () => resolve(), fail, null, project), fail);
  }).catch((err) => {
    ready = null; // allow a retry on the next request
    throw err;
  });
  return ready;
}

function eeFailure(what: string, detail: unknown): HttpError {
  console.error(`[ee] ${what} failed:`, detail);
  return new HttpError(502, "Earth Engine could not complete this request. Try again in a moment.");
}

/** Promise wrapper around ComputedObject.evaluate. */
function evaluate<T>(obj: { evaluate: (cb: (r: T, e?: string) => void) => void }, what: string): Promise<T> {
  return new Promise((resolve, reject) =>
    obj.evaluate((result, error) => (error ? reject(eeFailure(what, error)) : resolve(result))),
  );
}

function getMapUrl(image: unknown, vis: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) =>
    (image as { getMap: (v: unknown, cb: (m: { urlFormat: string } | undefined, e?: string) => void) => void }).getMap(
      vis,
      (map, error) => (error || !map ? reject(eeFailure("getMap", error)) : resolve(map.urlFormat)),
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
function gmwMask(year: number) {
  const col = ee.ImageCollection(GMW_V3_EXTENT);
  const byIndex = col.filter(ee.Filter.stringContains("system:index", String(year)));
  const byDate = col.filterDate(`${year}-01-01`, `${year + 1}-01-01`);
  const chosen = ee.ImageCollection(ee.Algorithms.If(byIndex.size().gt(0), byIndex, byDate));
  return chosen.mosaic().select([0]).gt(0).unmask(0).rename("mangrove");
}

function cgmdYear(year: number) {
  return ee.FeatureCollection(CGMD_EXTENT).filter(ee.Filter.eq("year", year));
}

/** Rasterised CGMD polygons for a year: 1 = mangrove, 0 = not. */
function cgmdMask(year: number) {
  return ee.Image(0).byte().paint(cgmdYear(year), 1).rename("mangrove");
}

function mask(id: GeeDataset, year: number) {
  return id === "gmw-v3" ? gmwMask(year) : cgmdMask(year);
}

/**
 * Display-only thickening: grows the mask by one output pixel at every zoom,
 * so narrow fringes don't vanish when zoomed out. Never used for area stats.
 */
function forDisplay<T extends { focalMax: (o: unknown) => T }>(img: T): T {
  return img.focalMax({ radius: 1, kernelType: "square", units: "pixels" });
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

export async function extentTiles(id: GeeDataset, year: number): Promise<string> {
  await initEE();
  return cachedTiles(`${id}:extent:${year}`, () => {
    if (id === "cgmd-30") {
      // Vector data: draw polygons with a 1 px outline so they stay visible zoomed out.
      const styled = cgmdYear(year).style({
        color: hex(COLORS.mangrove),
        fillColor: `${hex(COLORS.mangrove)}E6`,
        width: 1,
      });
      return getMapUrl(styled, {});
    }
    return getMapUrl(forDisplay(gmwMask(year)).selfMask(), { min: 1, max: 1, palette: [hex(COLORS.mangrove)] });
  });
}

/** Gain (1, blue) and loss (2, coral) between two years. */
export async function changeTiles(id: GeeDataset, base: number, year: number): Promise<string> {
  await initEE();
  return cachedTiles(`${id}:change:${base}:${year}`, () => {
    const a = mask(id, base);
    const b = mask(id, year);
    const gain = forDisplay(b.and(a.not()));
    const loss = forDisplay(a.and(b.not()));
    // Loss wins where the thickened edges overlap.
    const change = gain.where(loss, 2).selfMask();
    return getMapUrl(change, { min: 1, max: 2, palette: [hex(COLORS.gain), hex(COLORS.loss)] });
  });
}

/** Mangrove area (km²) inside a bbox for every requested year, in one round trip. */
export async function areaByYear(
  id: GeeDataset,
  bbox: BBox,
  years: number[],
  regionKm2: number,
): Promise<Record<string, number>> {
  await initEE();
  const region = ee.Geometry.Rectangle(bbox, null, false);
  // Native 25–30 m, coarsened for large regions so a request stays interactive.
  const scale = Math.max(30, Math.round(Math.sqrt((regionKm2 * 1e6) / 4e6)));
  const dict = ee.Dictionary.fromLists(
    years.map(String),
    years.map((y) =>
      mask(id, y)
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
  const m2 = await evaluate<Record<string, number | null>>(dict, "area");
  return Object.fromEntries(Object.entries(m2).map(([y, v]) => [y, (v ?? 0) / 1e6]));
}

/** Whether a point was mangrove in each year (1 / 0). */
export async function pointHistory(
  id: GeeDataset,
  lon: number,
  lat: number,
  years: number[],
): Promise<Record<string, number | null>> {
  await initEE();
  const point = ee.Geometry.Point([lon, lat]);
  if (id === "cgmd-30") {
    // Cheap for vectors: which years have a polygon covering the point?
    const present = await evaluate<number[]>(
      ee.FeatureCollection(CGMD_EXTENT).filterBounds(point).aggregate_array("year").distinct(),
      "point",
    );
    const set = new Set(present);
    return Object.fromEntries(years.map((y) => [String(y), set.has(y) ? 1 : 0]));
  }
  const stack = ee.Image.cat(years.map((y) => gmwMask(y).rename(`y${y}`)));
  const values = await evaluate<Record<string, number | null>>(
    stack.reduceRegion({ reducer: ee.Reducer.first(), geometry: point, scale: 25 }),
    "point",
  );
  return Object.fromEntries(years.map((y) => [String(y), values[`y${y}`] ?? null]));
}

/** Describes the GEE assets so a maintainer can check year mapping and fields. */
export async function diagnostics() {
  await initEE();
  const col = ee.ImageCollection(GMW_V3_EXTENT);
  const cgmd = ee.FeatureCollection(CGMD_EXTENT);
  return evaluate<Record<string, unknown>>(
    ee.Dictionary({
      gmwSize: col.size(),
      gmwIds: col.aggregate_array("system:index").slice(0, 30),
      gmwStarts: col.aggregate_array("system:time_start").slice(0, 30),
      gmwBands: ee.Image(col.first()).bandNames(),
      cgmdFirst: ee.Feature(cgmd.first()).toDictionary(),
      cgmdYears2020s: cgmd.filter(ee.Filter.gte("year", 2020)).aggregate_array("year").distinct(),
    }),
    "diagnose",
  );
}
