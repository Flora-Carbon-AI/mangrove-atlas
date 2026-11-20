import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import type { Project } from "@/lib/projects";
import { PROJECTS_PREFIX } from "./mapStyle";

/**
 * Blue carbon projects on the map:
 *  - exact sites and boundaries: solid amber dots, outlines when zoomed in
 *  - approximate places/states: hollow amber rings
 *  - country-only projects: one dark bubble per country with a count
 */

const AMBER = "#E3B23C";
const INK = "#10292D";

const SRC_POINTS = `${PROJECTS_PREFIX}points`;
const SRC_COUNTRIES = `${PROJECTS_PREFIX}countries`;
const SRC_BOUNDS = `${PROJECTS_PREFIX}bounds`;

/** Layers that respond to clicks. */
export const PROJECT_CLICK_LAYERS = [`${PROJECTS_PREFIX}points`, `${PROJECTS_PREFIX}countries`, `${PROJECTS_PREFIX}bounds-fill`];

type FC = GeoJSON.FeatureCollection;

export interface ProjectFeatures {
  points: FC;
  countries: FC;
  bounds: FC;
}

export function projectFeatures(projects: Project[]): ProjectFeatures {
  const points: GeoJSON.Feature[] = [];
  const bounds: GeoJSON.Feature[] = [];
  const byCountry = new Map<string, { lon: number; lat: number; ids: string[] }>();
  for (const p of projects) {
    const { precision, lon, lat } = p.location;
    if (precision === "country") {
      const c = byCountry.get(p.country) ?? { lon, lat, ids: [] };
      c.ids.push(p.id);
      byCountry.set(p.country, c);
      continue;
    }
    points.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { id: p.id, name: p.name, exact: precision === "boundary" || precision === "site" },
    });
    if (p.boundary) bounds.push({ type: "Feature", geometry: p.boundary, properties: { id: p.id } });
  }
  const countries: GeoJSON.Feature[] = [...byCountry].map(([country, c]) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    properties: { country, count: c.ids.length },
  }));
  return {
    points: { type: "FeatureCollection", features: points },
    countries: { type: "FeatureCollection", features: countries },
    bounds: { type: "FeatureCollection", features: bounds },
  };
}

const EMPTY: FC = { type: "FeatureCollection", features: [] };

/** Adds the project layers once, or updates their data. `null` hides them. */
export function applyProjects(map: MLMap, data: ProjectFeatures | null) {
  const d = data ?? { points: EMPTY, countries: EMPTY, bounds: EMPTY };
  const existing = map.getSource(SRC_POINTS) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(d.points);
    (map.getSource(SRC_COUNTRIES) as GeoJSONSource).setData(d.countries);
    (map.getSource(SRC_BOUNDS) as GeoJSONSource).setData(d.bounds);
    return;
  }
  map.addSource(SRC_BOUNDS, { type: "geojson", data: d.bounds });
  map.addSource(SRC_COUNTRIES, { type: "geojson", data: d.countries });
  map.addSource(SRC_POINTS, { type: "geojson", data: d.points });

  map.addLayer({
    id: `${PROJECTS_PREFIX}bounds-fill`,
    type: "fill",
    source: SRC_BOUNDS,
    minzoom: 6,
    paint: { "fill-color": AMBER, "fill-opacity": 0.1 },
  });
  map.addLayer({
    id: `${PROJECTS_PREFIX}bounds-line`,
    type: "line",
    source: SRC_BOUNDS,
    minzoom: 6,
    paint: { "line-color": AMBER, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 12, 2.5] },
  });
  map.addLayer({
    id: `${PROJECTS_PREFIX}countries`,
    type: "circle",
    source: SRC_COUNTRIES,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 11, 10, 17],
      "circle-color": INK,
      "circle-opacity": 0.88,
      "circle-stroke-color": AMBER,
      "circle-stroke-width": 1.5,
      "circle-stroke-opacity": 0.9,
    },
  });
  map.addLayer({
    id: `${PROJECTS_PREFIX}countries-count`,
    type: "symbol",
    source: SRC_COUNTRIES,
    layout: {
      "text-field": ["to-string", ["get", "count"]],
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: { "text-color": "#F4E7C5" },
  });
  map.addLayer({
    id: `${PROJECTS_PREFIX}points`,
    type: "circle",
    source: SRC_POINTS,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 4.5, 8, 7.5],
      "circle-color": ["case", ["get", "exact"], AMBER, INK],
      "circle-opacity": ["case", ["get", "exact"], 1, 0.55],
      "circle-stroke-color": ["case", ["get", "exact"], "#FFFFFF", AMBER],
      "circle-stroke-width": ["case", ["get", "exact"], 1.5, 2.5],
    },
  });
}
