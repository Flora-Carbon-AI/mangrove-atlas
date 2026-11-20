import type { LayerSpecification, Map as MLMap, StyleSpecification } from "maplibre-gl";
import type { Basemap } from "@/lib/datasets";
import type { LayersResponse } from "@/lib/types";

/** Esri World Imagery, slightly muted so mangrove overlays stay legible. */
const SATELLITE: StyleSpecification = {
  version: 8,
  // Fonts for map labels we draw ourselves (e.g. project counts). Same font server as the vector basemaps.
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    imagery: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
    labels: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 18,
    },
  },
  layers: [
    {
      id: "imagery",
      type: "raster",
      source: "imagery",
      paint: { "raster-saturation": -0.55, "raster-brightness-max": 0.72, "raster-contrast": 0.08 },
    },
    { id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.85 } },
  ],
};

/**
 * Standard and dark maps are OpenFreeMap vector styles: open OpenStreetMap
 * data, free to use, no API key. https://openfreemap.org
 */
export function basemapStyle(b: Basemap): StyleSpecification | string {
  if (b === "standard") return "https://tiles.openfreemap.org/styles/positron";
  if (b === "dark") return "https://tiles.openfreemap.org/styles/dark";
  return SATELLITE;
}

const PREFIX = "mg-";
/** Blue carbon project layers (see projectsLayer.ts). */
export const PROJECTS_PREFIX = "bc-";
/** The daily satellite image (see applyDaily). */
const DAILY_ID = "dl-imagery";
let generation = 0;
const latest = new WeakMap<MLMap, string>();

/** Overlays sit under labels: the raster "labels" layer, or a vector style's first symbol layer. */
function labelLayerIndex(layers: LayerSpecification[]): number {
  const i = layers.findIndex((l) => l.id === "labels" || l.type === "symbol");
  return i === -1 ? layers.length : i;
}

function overlayBeforeId(map: MLMap): string | undefined {
  const layers = (map.getStyle()?.layers ?? []).filter((l) => !l.id.startsWith(PREFIX));
  return layers[labelLayerIndex(layers)]?.id;
}

/**
 * Switches the basemap but carries the mangrove overlay across, so changing
 * the background never blanks the data.
 */
export function switchBasemap(map: MLMap, b: Basemap) {
  map.setStyle(basemapStyle(b), {
    diff: false,
    transformStyle: (prev, next) => {
      if (!prev) return next;
      const carried = (id: string) => id.startsWith(PREFIX) || id.startsWith(PROJECTS_PREFIX) || id === DAILY_ID;
      const sources = Object.fromEntries(Object.entries(prev.sources).filter(([id]) => carried(id)));
      // The daily image covers the background; the mangrove overlay draws on top of it.
      const daily = prev.layers.filter((l) => l.id === DAILY_ID);
      const overlays = prev.layers.filter((l) => l.id.startsWith(PREFIX));
      // Project markers always sit on top of everything, labels included.
      const projects = prev.layers.filter((l) => l.id.startsWith(PROJECTS_PREFIX));
      const at = labelLayerIndex(next.layers);
      return {
        ...next,
        sources: { ...next.sources, ...sources },
        layers: [...next.layers.slice(0, at), ...daily, ...overlays, ...next.layers.slice(at), ...projects],
      };
    },
  });
}

/** Removes overlay layers and sources from every generation except `keep`. */
function removeOverlays(map: MLMap, keep: string | null) {
  const style = map.getStyle();
  for (const layer of style.layers ?? []) {
    if (layer.id.startsWith(PREFIX) && (keep === null || !layer.id.startsWith(keep))) map.removeLayer(layer.id);
  }
  for (const id of Object.keys(style.sources ?? {})) {
    if (id.startsWith(PREFIX) && (keep === null || !id.startsWith(keep))) map.removeSource(id);
  }
}

/**
 * Replaces the mangrove overlay on a map with the sources in `data`.
 * The new layers go in on top first and the old ones are removed once the
 * new tiles have drawn, so stepping through years doesn't flash empty.
 */
export function applyOverlay(map: MLMap, data: LayersResponse | null, opacity: number) {
  if (!data) {
    latest.delete(map);
    removeOverlays(map, null);
    return;
  }
  const gen = `${PREFIX}${++generation}-`;
  latest.set(map, gen);
  const swap = () => {
    // Only the newest generation cleans up; older swaps would delete it.
    if (latest.get(map) === gen && map.getStyle()) removeOverlays(map, gen);
  };
  map.once("idle", swap);
  setTimeout(swap, 5000); // in case tiles never settle (e.g. the user keeps panning)
  const before = overlayBeforeId(map);
  data.sources.forEach((src, i) => {
    const id = `${gen}${i}`;
    map.addSource(id, {
      type: "raster",
      tiles: src.tiles,
      tileSize: src.tileSize ?? 256,
      ...(src.bounds ? { bounds: src.bounds } : {}),
      ...(src.minzoom !== undefined ? { minzoom: src.minzoom } : {}),
      ...(src.maxzoom !== undefined ? { maxzoom: src.maxzoom } : {}),
      attribution: i === 0 ? data.attribution : undefined,
    });
    map.addLayer(
      {
        id,
        type: "raster",
        source: id,
        paint: { "raster-opacity": opacity, "raster-fade-duration": 120, "raster-resampling": "nearest" },
      },
      before,
    );
  });
}

export function setOverlayOpacity(map: MLMap, opacity: number) {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.id.startsWith(PREFIX)) map.setPaintProperty(layer.id, "raster-opacity", opacity);
  }
}

/**
 * Shows one day's satellite image (or none) over the background map, under the
 * mangrove overlay and labels. GIBS images stop at zoom 9; MapLibre enlarges them beyond.
 */
export function applyDaily(map: MLMap, layer: { tiles: string; attribution: string } | null) {
  if (map.getLayer(DAILY_ID)) map.removeLayer(DAILY_ID);
  if (map.getSource(DAILY_ID)) map.removeSource(DAILY_ID);
  if (!layer) return;
  map.addSource(DAILY_ID, {
    type: "raster",
    tiles: [layer.tiles],
    tileSize: 256,
    maxzoom: 9,
    attribution: layer.attribution,
  });
  const before = map
    .getStyle()
    .layers.find((l) => l.id.startsWith(PREFIX) || l.id === "labels" || l.type === "symbol")?.id;
  map.addLayer({ id: DAILY_ID, type: "raster", source: DAILY_ID, paint: { "raster-fade-duration": 150 } }, before);
}
